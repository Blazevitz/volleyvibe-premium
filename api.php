<?php
declare(strict_types=1);

ini_set('session.use_strict_mode', '1');
ini_set('session.cookie_httponly', '1');
ini_set('session.cookie_samesite', 'Strict');
session_set_cookie_params([
    'httponly' => true,
    'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    'samesite' => 'Strict',
    'path' => '/',
]);
session_start();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

function respond(int $status, array $payload): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function read_json(): array
{
    $input = file_get_contents('php://input');
    if ($input === false || $input === '') {
        respond(400, ['error' => 'A JSON request body is required.']);
    }
    try {
        $data = json_decode($input, true, 32, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        respond(400, ['error' => 'The request body is not valid JSON.']);
    }
    if (!is_array($data)) {
        respond(400, ['error' => 'The request body must be a JSON object.']);
    }
    return $data;
}

function private_config(): array
{
    static $config;
    if (isset($config)) {
        return $config;
    }
    $configuredPath = getenv('AVC_PRIVATE_CONFIG');
    if ($configuredPath !== false && trim($configuredPath) !== '') {
        $path = trim($configuredPath);
    } else {
        $path = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'afterhours-private' . DIRECTORY_SEPARATOR . 'config.php';
    }
    if (!is_file($path) || !is_readable($path)) {
        respond(503, ['error' => 'Private PHP configuration was not found. Create afterhours-private\\config.php next to the web root as described in README.md.']);
    }
    $loaded = require $path;
    if (!is_array($loaded)) {
        respond(503, ['error' => 'Private PHP configuration must return an array.']);
    }
    $config = $loaded;
    return $config;
}

function database(): PDO
{
    $config = private_config();
    $dsn = getenv('AVC_DB_DSN');
    $user = getenv('AVC_DB_USER');
    $password = getenv('AVC_DB_PASSWORD');
    $databaseConfig = $config['database'] ?? [];
    if (!is_array($databaseConfig)) {
        respond(503, ['error' => 'The database section of private PHP configuration is invalid.']);
    }
    $dsn = $dsn === false ? ($databaseConfig['dsn'] ?? null) : $dsn;
    $user = $user === false ? ($databaseConfig['user'] ?? null) : $user;
    $password = $password === false ? ($databaseConfig['password'] ?? null) : $password;
    if (!is_string($dsn) || $dsn === '' || !is_string($user) || !is_string($password)) {
        respond(503, ['error' => 'Database is not configured. Check the database section in afterhours-private\\config.php.']);
    }
    try {
        return new PDO($dsn, $user, $password, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    } catch (PDOException) {
        respond(503, ['error' => 'Could not connect to the tournament database. Check the server database configuration.']);
    }
}

function require_admin(): void
{
    if (empty($_SESSION['admin_authenticated'])) {
        respond(401, ['error' => 'Admin sign-in is required.']);
    }
}

function require_csrf(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '') {
        $originHost = parse_url($origin, PHP_URL_HOST);
        $requestHost = $_SERVER['HTTP_HOST'] ?? '';
        if (!is_string($originHost) || strcasecmp($originHost, preg_replace('/:\d+$/', '', $requestHost)) !== 0) {
            respond(403, ['error' => 'Cross-origin requests are not allowed.']);
        }
    }
    $provided = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!is_string($provided) || empty($_SESSION['csrf_token']) || !hash_equals($_SESSION['csrf_token'], $provided)) {
        respond(403, ['error' => 'The security token expired. Sign in again and retry.']);
    }
}

function required_text(array $data, string $key, int $max): string
{
    if (!isset($data[$key]) || !is_string($data[$key])) {
        respond(422, ['error' => ucfirst(str_replace('_', ' ', $key)) . ' must be text.']);
    }
    $value = trim($data[$key]);
    if ($value === '' || mb_strlen($value) > $max) {
        respond(422, ['error' => ucfirst(str_replace('_', ' ', $key)) . " is required and must be at most {$max} characters."]);
    }
    return $value;
}

function optional_text(array $data, string $key, int $max): string
{
    $raw = $data[$key] ?? '';
    if (!is_string($raw)) {
        respond(422, ['error' => ucfirst(str_replace('_', ' ', $key)) . ' must be text.']);
    }
    $value = trim($raw);
    if (mb_strlen($value) > $max) {
        respond(422, ['error' => ucfirst(str_replace('_', ' ', $key)) . " must be at most {$max} characters."]);
    }
    return $value;
}

function valid_date(string $value): bool
{
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);
    return $date !== false && $date->format('Y-m-d') === $value;
}

function valid_uuid(string $value): bool
{
    return (bool)preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $value);
}

function payment_qr_directory(): string
{
    $configured = getenv('AVC_PAYMENT_QR_DIR');
    if ($configured !== false && trim($configured) !== '') {
        return rtrim($configured, DIRECTORY_SEPARATOR);
    }
    $config = private_config();
    $configured = $config['payment_qr_dir'] ?? null;
    if (is_string($configured) && trim($configured) !== '') {
        return rtrim($configured, DIRECTORY_SEPARATOR);
    }
    $documentRoot = realpath((string)($_SERVER['DOCUMENT_ROOT'] ?? ''));
    $base = $documentRoot !== false ? dirname($documentRoot) : dirname(__DIR__);
    return $base . DIRECTORY_SEPARATOR . 'afterhours-private' . DIRECTORY_SEPARATOR . 'payment-qr';
}

function payment_qr_settings(PDO $db): array
{
    $statement = $db->query('SELECT payment_provider, payment_qr_file FROM event_settings WHERE id = 1');
    $settings = $statement->fetch() ?: [];
    $file = (string)($settings['payment_qr_file'] ?? '');
    return [
        'payment_provider' => (string)($settings['payment_provider'] ?? ''),
        'payment_qr_url' => $file !== '' && preg_match('/^[a-f0-9]{32}\.(?:png|jpg|webp)$/', $file)
            ? 'api.php?action=payment-qr&v=' . rawurlencode($file)
            : null,
    ];
}

function public_data(PDO $db): array
{
    $settings = $db->query('SELECT club_name, event_date, start_time, end_time, venue, court_fee, hero_eyebrow, hero_headline, hero_description, payment_provider, payment_qr_file FROM event_settings WHERE id = 1')->fetch();
    if ($settings) {
        $settings['payment_qr_url'] = payment_qr_settings($db)['payment_qr_url'];
        unset($settings['payment_qr_file']);
    }
    $teams = $db->query('SELECT id, name, color, tagline, players FROM teams ORDER BY created_at, name')->fetchAll();
    foreach ($teams as &$team) {
        $team['players'] = json_decode((string)$team['players'], true) ?: [];
    }
    unset($team);
    $matches = $db->query('SELECT id, match_number, team_a_id, team_b_id, match_date, match_time, referee, score_a, score_b, status FROM matches ORDER BY match_number, created_at')->fetchAll();
    foreach ($matches as &$match) {
        $match['match_number'] = (int)$match['match_number'];
        $match['score_a'] = $match['score_a'] === null ? null : (int)$match['score_a'];
        $match['score_b'] = $match['score_b'] === null ? null : (int)$match['score_b'];
    }
    unset($match);
    return ['settings' => $settings ?: null, 'teams' => $teams, 'matches' => $matches];
}

$action = (string)($_GET['action'] ?? '');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    if ($action === 'session' && $method === 'GET') {
        respond(200, [
            'authenticated' => !empty($_SESSION['admin_authenticated']),
            'csrfToken' => $_SESSION['csrf_token'] ?? null,
        ]);
    }

    if ($action === 'login' && $method === 'POST') {
        $passwordHash = getenv('AVC_ADMIN_PASSWORD_HASH');
        if ($passwordHash === false) {
            $passwordHash = private_config()['admin_password_hash'] ?? null;
        }
        if (!is_string($passwordHash) || $passwordHash === '') {
            respond(503, ['error' => 'Admin access is not configured. Set admin_password_hash in afterhours-private\\config.php.']);
        }
        $db = database();
        $ipKey = hash_hmac('sha256', (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'), $passwordHash);
        $rateCheck = $db->prepare('SELECT locked_until > CURRENT_TIMESTAMP FROM admin_login_attempts WHERE ip_key = ?');
        $rateCheck->execute([$ipKey]);
        if ((int)$rateCheck->fetchColumn() === 1) {
            respond(429, ['error' => 'Too many sign-in attempts. Wait 15 minutes and try again.']);
        }
        $body = read_json();
        $password = (string)($body['password'] ?? '');
        if (strlen($password) > 4096 || !password_verify($password, $passwordHash)) {
            $failedLogin = $db->prepare("INSERT INTO admin_login_attempts (ip_key, failures) VALUES (?, 1) ON DUPLICATE KEY UPDATE locked_until = IF(failures >= 4, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 15 MINUTE), locked_until), failures = failures + 1");
            $failedLogin->execute([$ipKey]);
            respond(401, ['error' => 'The admin password is incorrect.']);
        }
        $clearFailures = $db->prepare('DELETE FROM admin_login_attempts WHERE ip_key = ?');
        $clearFailures->execute([$ipKey]);
        session_regenerate_id(true);
        $_SESSION['admin_authenticated'] = true;
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        respond(200, ['authenticated' => true, 'csrfToken' => $_SESSION['csrf_token']]);
    }

    if ($action === 'public-data' && $method === 'GET') {
        respond(200, public_data(database()));
    }

    if ($action === 'payment-qr' && $method === 'GET') {
        $db = database();
        $settings = $db->query('SELECT payment_qr_file FROM event_settings WHERE id = 1')->fetch();
        $file = (string)($settings['payment_qr_file'] ?? '');
        $requested = (string)($_GET['v'] ?? '');
        if ($file === '' || !hash_equals($file, $requested) || !preg_match('/^[a-f0-9]{32}\.(?:png|jpg|webp)$/', $file)) {
            http_response_code(404);
            exit;
        }
        $path = payment_qr_directory() . DIRECTORY_SEPARATOR . $file;
        if (!is_file($path) || !is_readable($path)) {
            http_response_code(404);
            exit;
        }
        $mime = match (pathinfo($file, PATHINFO_EXTENSION)) {
            'png' => 'image/png',
            'jpg' => 'image/jpeg',
            'webp' => 'image/webp',
        };
        header_remove('Content-Type');
        header('Content-Type: ' . $mime);
        header('Cache-Control: public, max-age=300');
        header('Content-Length: ' . (string)filesize($path));
        readfile($path);
        exit;
    }

    if ($action === 'logout' && $method === 'POST') {
        require_admin();
        require_csrf();
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'] ?? '', $params['secure'], $params['httponly']);
        }
        session_destroy();
        respond(200, ['authenticated' => false]);
    }

    require_admin();
    require_csrf();
    $db = database();

    if ($action === 'settings' && $method === 'POST') {
        $body = read_json();
        if ((int)$db->query('SELECT COUNT(*) FROM event_settings WHERE id = 1')->fetchColumn() !== 1) {
            respond(503, ['error' => 'Event settings have not been initialized. Apply schema.sql before saving settings.']);
        }
        $clubName = required_text($body, 'club_name', 120);
        $heroEyebrow = required_text($body, 'hero_eyebrow', 80);
        $heroHeadline = required_text($body, 'hero_headline', 180);
        $heroDescription = required_text($body, 'hero_description', 500);
        if (mb_strlen($heroHeadline) > 180) {
            respond(422, ['error' => 'Main headline must be at most 180 characters.']);
        }
        $eventDate = (string)($body['event_date'] ?? '');
        $startTime = (string)($body['start_time'] ?? '');
        $endTime = (string)($body['end_time'] ?? '');
        $venue = required_text($body, 'venue', 180);
        $fee = filter_var($body['court_fee'] ?? null, FILTER_VALIDATE_INT);
        $timePattern = '/^(?:[01]\d|2[0-3]):[0-5]\d$/';
        if (!valid_date($eventDate) || !preg_match($timePattern, $startTime) || !preg_match($timePattern, $endTime) || $endTime <= $startTime) {
            respond(422, ['error' => 'Enter a valid date and times. The end time must be after the start time.']);
        }
        if ($fee === false || $fee < 0 || $fee > 1000000) {
            respond(422, ['error' => 'Court fee must be a whole number from 0 to 1,000,000.']);
        }
        $statement = $db->prepare('UPDATE event_settings SET club_name = ?, event_date = ?, start_time = ?, end_time = ?, venue = ?, court_fee = ?, hero_eyebrow = ?, hero_headline = ?, hero_description = ? WHERE id = 1');
        $statement->execute([$clubName, $eventDate, $startTime . ':00', $endTime . ':00', $venue, $fee, $heroEyebrow, $heroHeadline, $heroDescription]);
        respond(200, ['settings' => public_data($db)['settings']]);
    }

    if ($action === 'payment-qr' && $method === 'POST') {
        if (!isset($_POST['operation']) || !is_string($_POST['operation'])) {
            respond(400, ['error' => 'Choose whether to upload or remove the payment QR.']);
        }
        $operation = $_POST['operation'];
        $provider = isset($_POST['provider']) && is_string($_POST['provider']) ? trim($_POST['provider']) : '';
        if (!in_array($operation, ['upload', 'remove'], true)) {
            respond(422, ['error' => 'Invalid payment QR operation.']);
        }
        if (!in_array($provider, ['GCash', 'Maya', 'Other'], true)) {
            respond(422, ['error' => 'Choose GCash, Maya, or Other as the payment provider.']);
        }
        $current = $db->query('SELECT payment_qr_file FROM event_settings WHERE id = 1')->fetch();
        $oldFile = (string)($current['payment_qr_file'] ?? '');
        if ($operation === 'remove') {
            $remove = $db->prepare("UPDATE event_settings SET payment_qr_file = NULL, payment_provider = '' WHERE id = 1");
            $remove->execute();
            if ($oldFile !== '' && preg_match('/^[a-f0-9]{32}\.(?:png|jpg|webp)$/', $oldFile)) {
                $oldPath = payment_qr_directory() . DIRECTORY_SEPARATOR . $oldFile;
                if (is_file($oldPath) && !unlink($oldPath)) {
                    error_log('Afterhours API: could not remove replaced payment QR file.');
                }
            }
            respond(200, ['settings' => public_data($db)['settings']]);
        }
        if (!isset($_FILES['qr_image']) || !is_array($_FILES['qr_image'])) {
            respond(400, ['error' => 'Choose a QR image to upload.']);
        }
        $upload = $_FILES['qr_image'];
        if (($upload['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file((string)($upload['tmp_name'] ?? ''))) {
            $uploadError = (int)($upload['error'] ?? UPLOAD_ERR_NO_FILE);
            $message = match ($uploadError) {
                UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => 'The image exceeds the server upload size limit.',
                UPLOAD_ERR_PARTIAL => 'The image upload was incomplete. Try again.',
                UPLOAD_ERR_NO_FILE => 'Choose a QR image to upload.',
                default => 'The image could not be uploaded. Check the PHP upload configuration.',
            };
            respond(422, ['error' => $message]);
        }
        $size = (int)($upload['size'] ?? 0);
        if ($size < 1 || $size > 4 * 1024 * 1024) {
            respond(422, ['error' => 'QR images must be no larger than 4 MB.']);
        }
        $info = @getimagesize((string)$upload['tmp_name']);
        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $mime = $finfo->file((string)$upload['tmp_name']);
        $mimeExtensions = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp'];
        if ($info === false || !isset($mimeExtensions[$mime]) || ($info['mime'] ?? '') !== $mime || $info[0] > 6000 || $info[1] > 6000 || $info[0] * $info[1] > 20000000) {
            respond(422, ['error' => 'Upload a valid PNG, JPG, or WebP image with dimensions under 20 megapixels.']);
        }
        $directory = payment_qr_directory();
        if (!is_dir($directory) && !mkdir($directory, 0750, true) && !is_dir($directory)) {
            respond(500, ['error' => 'The private QR storage folder could not be created. Check AVC_PAYMENT_QR_DIR and PHP folder permissions.']);
        }
        if (!is_writable($directory)) {
            respond(500, ['error' => 'The private QR storage folder is not writable by PHP. Check AVC_PAYMENT_QR_DIR and folder permissions.']);
        }
        $newFile = bin2hex(random_bytes(16)) . '.' . $mimeExtensions[$mime];
        $newPath = $directory . DIRECTORY_SEPARATOR . $newFile;
        if (!move_uploaded_file((string)$upload['tmp_name'], $newPath)) {
            respond(500, ['error' => 'The QR image could not be stored. Check PHP folder permissions.']);
        }
        try {
            $save = $db->prepare('UPDATE event_settings SET payment_provider = ?, payment_qr_file = ? WHERE id = 1');
            $save->execute([$provider, $newFile]);
        } catch (Throwable $error) {
            if (is_file($newPath) && !unlink($newPath)) {
                error_log('Afterhours API: could not clean up failed payment QR upload.');
            }
            throw $error;
        }
        if ($oldFile !== '' && preg_match('/^[a-f0-9]{32}\.(?:png|jpg|webp)$/', $oldFile)) {
            $oldPath = $directory . DIRECTORY_SEPARATOR . $oldFile;
            if (is_file($oldPath) && !unlink($oldPath)) {
                error_log('Afterhours API: could not remove replaced payment QR file.');
            }
        }
        respond(200, ['settings' => public_data($db)['settings']]);
    }

    if ($action === 'team' && $method === 'POST') {
        $body = read_json();
        $operation = (string)($body['operation'] ?? 'save');
        $id = (string)($body['id'] ?? '');
        if (!valid_uuid($id)) {
            respond(422, ['error' => 'Team ID is invalid.']);
        }
        if ($operation === 'delete') {
            $count = $db->prepare('SELECT COUNT(*) FROM matches WHERE team_a_id = ? OR team_b_id = ?');
            $count->execute([$id, $id]);
            if ((int)$count->fetchColumn() > 0) {
                respond(409, ['error' => 'This team has match history. Rename or archive it instead; teams with match records cannot be deleted.']);
            }
            $delete = $db->prepare('DELETE FROM teams WHERE id = ?');
            $delete->execute([$id]);
            if ($delete->rowCount() === 0) {
                respond(404, ['error' => 'Team not found.']);
            }
            respond(200, public_data($db));
        }
        $name = required_text($body, 'name', 80);
        $color = strtolower((string)($body['color'] ?? ''));
        if (!preg_match('/^#[0-9a-f]{6}$/', $color)) {
            respond(422, ['error' => 'Choose a valid six-digit team color.']);
        }
        $tagline = optional_text($body, 'tagline', 120);
        $players = $body['players'] ?? [];
        if (!is_array($players) || count($players) > 40) {
            respond(422, ['error' => 'Players must be a list with no more than 40 names.']);
        }
        foreach ($players as $player) {
            if (!is_string($player)) {
                respond(422, ['error' => 'Every player name must be text.']);
            }
        }
        $players = array_values(array_unique(array_filter(array_map('trim', $players), static fn($player) => $player !== '')));
        foreach ($players as $player) {
            if (mb_strlen($player) > 80) {
                respond(422, ['error' => 'Player names must be no longer than 80 characters.']);
            }
        }
        try {
            $exists = $db->prepare('SELECT id FROM teams WHERE id = ?');
            $exists->execute([$id]);
            if ($exists->fetch()) {
                $statement = $db->prepare('UPDATE teams SET name = ?, color = ?, tagline = ?, players = ? WHERE id = ?');
                $statement->execute([$name, $color, $tagline, json_encode($players, JSON_THROW_ON_ERROR), $id]);
            } else {
                $statement = $db->prepare('INSERT INTO teams (id, name, color, tagline, players) VALUES (?, ?, ?, ?, ?)');
                $statement->execute([$id, $name, $color, $tagline, json_encode($players, JSON_THROW_ON_ERROR)]);
            }
        } catch (PDOException $error) {
            if ($error->getCode() === '23000') {
                respond(409, ['error' => 'A team already uses that name.']);
            }
            throw $error;
        }
        respond(200, public_data($db));
    }

    if ($action === 'match' && $method === 'POST') {
        $body = read_json();
        $operation = (string)($body['operation'] ?? 'save');
        $id = (string)($body['id'] ?? '');
        if (!valid_uuid($id)) {
            respond(422, ['error' => 'Match ID is invalid.']);
        }
        if ($operation === 'delete') {
            $delete = $db->prepare('DELETE FROM matches WHERE id = ?');
            $delete->execute([$id]);
            if ($delete->rowCount() === 0) {
                respond(404, ['error' => 'Match not found.']);
            }
            respond(200, public_data($db));
        }
        $teamA = (string)($body['team_a_id'] ?? '');
        $teamB = (string)($body['team_b_id'] ?? '');
        if (!valid_uuid($teamA) || !valid_uuid($teamB) || $teamA === $teamB) {
            respond(422, ['error' => 'Choose two different valid teams.']);
        }
        $teamCheck = $db->prepare('SELECT COUNT(*) FROM teams WHERE id IN (?, ?)');
        $teamCheck->execute([$teamA, $teamB]);
        if ((int)$teamCheck->fetchColumn() !== 2) {
            respond(422, ['error' => 'Both selected teams must exist.']);
        }
        $status = (string)($body['status'] ?? '');
        if (!in_array($status, ['scheduled', 'in_progress', 'completed', 'official'], true)) {
            respond(422, ['error' => 'Choose a valid match status.']);
        }
        $scoreA = ($body['score_a'] ?? '') === '' ? null : filter_var($body['score_a'], FILTER_VALIDATE_INT);
        $scoreB = ($body['score_b'] ?? '') === '' ? null : filter_var($body['score_b'], FILTER_VALIDATE_INT);
        if (($scoreA === null) !== ($scoreB === null) || ($scoreA !== null && ($scoreA === false || $scoreB === false || $scoreA < 0 || $scoreB < 0 || $scoreA > 999 || $scoreB > 999))) {
            respond(422, ['error' => 'Enter both scores as whole numbers from 0 to 999, or leave both blank.']);
        }
        if (in_array($status, ['completed', 'official'], true) && ($scoreA === null || $scoreA === $scoreB)) {
            respond(422, ['error' => 'Completed and official matches need two different scores.']);
        }
        $date = (string)($body['match_date'] ?? '');
        $time = (string)($body['match_time'] ?? '');
        if (($date !== '' && !valid_date($date)) || ($time !== '' && !preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/', $time))) {
            respond(422, ['error' => 'Enter a valid match date and time.']);
        }
        $referee = optional_text($body, 'referee', 120);
        $db->beginTransaction();
        try {
            $exists = $db->prepare('SELECT id FROM matches WHERE id = ?');
            $exists->execute([$id]);
            if ($exists->fetch()) {
                $save = $db->prepare('UPDATE matches SET team_a_id = ?, team_b_id = ?, match_date = ?, match_time = ?, referee = ?, score_a = ?, score_b = ?, status = ? WHERE id = ?');
                $save->execute([$teamA, $teamB, $date ?: null, $time !== '' ? $time . ':00' : null, $referee, $scoreA, $scoreB, $status, $id]);
            } else {
                $number = (int)$db->query('SELECT COALESCE(MAX(match_number), 0) + 1 FROM matches')->fetchColumn();
                $save = $db->prepare('INSERT INTO matches (id, match_number, team_a_id, team_b_id, match_date, match_time, referee, score_a, score_b, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
                $save->execute([$id, $number, $teamA, $teamB, $date ?: null, $time !== '' ? $time . ':00' : null, $referee, $scoreA, $scoreB, $status]);
            }
            $db->commit();
        } catch (Throwable $error) {
            if ($db->inTransaction()) {
                $db->rollBack();
            }
            throw $error;
        }
        respond(200, public_data($db));
    }

    respond(404, ['error' => 'Unknown API endpoint.']);
} catch (Throwable $error) {
    error_log('Afterhours API error: ' . $error->getMessage());
    respond(500, ['error' => 'The request could not be completed. Check the server error log for details.']);
}
