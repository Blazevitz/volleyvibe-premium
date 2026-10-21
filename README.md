# Afterhours Volleyball Club — Match Center

Responsive volleyball club match center with event settings, a scorebook, team cards, standings, and a server-authenticated admin dashboard. The existing deep charcoal, yellow, and silver UI is preserved.

## Requirements

- XAMPP with PHP 8.1+ and the PDO MySQL extension enabled
- MySQL/MariaDB running
- A PHP-enabled web server; VS Code Live Server alone cannot run the secured API

## Database setup

1. Start MySQL from the XAMPP Control Panel.
2. Import `schema.sql` once. From PowerShell:

   ```powershell
   cmd /c '"C:\xampp\mysql\bin\mysql.exe" -u root < "C:\xampp\htdocs\volleyvibe-premium\schema.sql"'
   ```

   The migration creates `afterhours_vbc` and inserts the requested defaults: Volleyvibe Spikers Club, October 24, 2026, 6:00–10:00 PM, CKSM Basketball Court, and PHP 140. It imports the existing four team IDs and all 14 current match results. Re-running the script does not overwrite edits to existing records.

3. If `afterhours_vbc` already exists from an earlier version, apply the one-time update from PowerShell to add homepage copy and payment QR fields without changing tournament records:

   ```powershell
   cmd /c '"C:\xampp\mysql\bin\mysql.exe" -u root afterhours_vbc < "C:\xampp\htdocs\volleyvibe-premium\migrations\002_hero_copy_and_payment_qr.sql"'
   ```

   Do not run this one-time `ALTER TABLE` migration more than once. Fresh installs already get these columns from `schema.sql`.

4. For anything beyond a local XAMPP installation, create a dedicated MySQL account with a strong password and only the necessary database permissions:

   ```sql
   CREATE USER 'avc_app'@'127.0.0.1' IDENTIFIED BY 'choose-a-long-unique-password';
   GRANT SELECT, INSERT, UPDATE, DELETE ON afterhours_vbc.* TO 'avc_app'@'127.0.0.1';
   ```

   Import the schema using a database administrator account; use the restricted account for the web app.

## Configure and run locally

Open PowerShell and set the server-only environment variables for that terminal session. The admin password is entered privately; only its password hash is passed to PHP:

```powershell
$env:AVC_DB_DSN = 'mysql:host=127.0.0.1;dbname=afterhours_vbc;charset=utf8mb4'
$env:AVC_DB_USER = 'avc_app'
$dbSecret = Read-Host 'MySQL application password' -AsSecureString
$env:AVC_DB_PASSWORD = [System.Net.NetworkCredential]::new('', $dbSecret).Password
$adminSecret = Read-Host 'Choose an admin password' -AsSecureString
$adminPlain = [System.Net.NetworkCredential]::new('', $adminSecret).Password
$adminHash = $adminPlain | & 'C:\xampp\php\php.exe' -r '$p=trim(stream_get_contents(STDIN)); echo password_hash($p, PASSWORD_DEFAULT);'
$env:AVC_ADMIN_PASSWORD_HASH = $adminHash.Trim()
& 'C:\xampp\php\php.exe' -S 127.0.0.1:8000 -t 'C:\xampp\htdocs\volleyvibe-premium'
```

Open `http://127.0.0.1:8000` and choose **Admin sign in**. Keep the PHP server terminal open while using the site. Stop the local server with Ctrl+C. These variables are not saved in the project; set them again when restarting the server.

In Apache/XAMPP deployments, configure the same `AVC_DB_DSN`, `AVC_DB_USER`, `AVC_DB_PASSWORD`, and `AVC_ADMIN_PASSWORD_HASH` variables in the Apache server environment (for example, protected `SetEnv` entries in a non-public virtual-host configuration), then restart Apache. Never put the database password or admin password/hash in browser JavaScript or a public repository. Use HTTPS outside localhost so admin session cookies are Secure.

## Admin features

- **Event settings:** update club name, date, start/end times, venue, court fee, and the homepage feature heading and description. Changes are validated on both client and server and immediately appear on the public page.
- **Payment QR:** select GCash, Maya, or Other and upload or remove a PNG, JPG, or WebP payment QR image (maximum 4 MB). The QR appears in the public court-fee dialog after saving. PHP validates the image content and dimensions; randomly named files are stored outside the website document root and only the currently configured image is served publicly.
- **Teams:** create, rename, recolor, and update taglines/player lists. Team IDs stay stable across renames. A team with match history cannot be deleted.
- **Matches:** create, edit, or confirm deletion; choose two different teams; add optional date/time and referee; edit scores and status.
- Standings recalculate from completed/official matches. Ranking preserves the existing rule: most wins, then most points for.
- Public data is read-only. It refreshes on page load and polls for saved updates every 45 seconds. Local storage is used only for per-browser theme and follow preferences.

## Security and deployment

The PHP API verifies the admin password against the server-side `AVC_ADMIN_PASSWORD_HASH`, regenerates the session on login, rate-limits repeated login failures, uses HttpOnly/SameSite cookies, checks CSRF tokens on writes, validates inputs and uploaded image contents, and uses prepared SQL statements. Database foreign keys protect match history and public API routes cannot write data. Keep PHP, MySQL, and the site on supported versions and use HTTPS in production.

By default, uploaded QR images are stored in an `afterhours-private\payment-qr` folder alongside (not inside) the web document root. Ensure the PHP process can create and write to that folder. To use a different private folder, set the server-only `AVC_PAYMENT_QR_DIR` environment variable to its absolute path before starting PHP/Apache. Never place uploads inside a publicly browsable folder.

The current project has no pre-existing backend. If the database/API is not configured, the public page displays a connection warning and does not claim that edits were saved. Admin sign-in and tournament changes require the PHP API and MySQL database to be available.

## Validation

```powershell
& 'C:\xampp\php\php.exe' -l 'C:\xampp\htdocs\volleyvibe-premium\api.php'
node --check 'C:\xampp\htdocs\volleyvibe-premium\app.js'
```
