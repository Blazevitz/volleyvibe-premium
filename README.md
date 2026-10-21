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

The admin sign-in is part of the same website. It uses the local PHP API and MySQL database to protect and save admin changes; it does not need a separate admin website or terminal environment variables.

1. Start **Apache** and **MySQL** from the XAMPP Control Panel.
2. Open `http://localhost/volleyvibe-premium/` (or `http://127.0.0.1/volleyvibe-premium/`). VS Code Live Server cannot execute the PHP API.
3. Sign in using the locally configured admin password.

The API reads database and admin settings from `C:\xampp\afterhours-private\config.php`, outside Apache's `htdocs` document root. This local config is not part of the repository. The current XAMPP config uses the default local `root` MySQL account with an empty password; use it only on a private development machine. For deployments beyond local testing, replace it with a restricted database user and keep the config folder protected.

To change the admin password, generate a replacement hash in PowerShell and update only the `admin_password_hash` value in the private config file:

```powershell
$adminSecret = Read-Host 'New admin password' -AsSecureString
$adminPlain = [System.Net.NetworkCredential]::new('', $adminSecret).Password
$adminHash = $adminPlain | & 'C:\xampp\php\php.exe' -r '$p=trim(stream_get_contents(STDIN)); echo password_hash($p, PASSWORD_DEFAULT);'
$adminHash.Trim()
```

Copy the generated hash into `C:\xampp\afterhours-private\config.php`. The plain-text password is not stored in the website or config file. Never move this config into `htdocs` or commit it to the repository. Use HTTPS outside localhost so admin session cookies are Secure.

## Admin features

- **Event settings:** update club name, date, start/end times, venue, court fee, and the homepage feature heading and description. Changes are validated on both client and server and immediately appear on the public page.
- **Payment QR:** select GCash, Maya, or Other and upload or remove a PNG, JPG, or WebP payment QR image (maximum 4 MB). The QR appears in the public court-fee dialog after saving. PHP validates the image content and dimensions; randomly named files are stored outside the website document root and only the currently configured image is served publicly.
- **Teams:** create, rename, recolor, and update taglines/player lists. Team IDs stay stable across renames. A team with match history cannot be deleted.
- **Matches:** create, edit, or confirm deletion; choose two different teams; add optional date/time and referee; edit scores and status.
- Standings recalculate from completed/official matches. Ranking preserves the existing rule: most wins, then most points for.
- Public data is read-only. It refreshes on page load and polls for saved updates every 45 seconds. Local storage is used only for per-browser theme and follow preferences.

## Security and deployment

The PHP API verifies the admin password against the hash in the private server-side config file, regenerates the session on login, rate-limits repeated login failures, uses HttpOnly/SameSite cookies, checks CSRF tokens on writes, validates inputs and uploaded image contents, and uses prepared SQL statements. Database foreign keys protect match history and public API routes cannot write data. Keep PHP, MySQL, and the site on supported versions and use HTTPS in production.

By default, uploaded QR images are stored in an `afterhours-private\payment-qr` folder alongside (not inside) the web document root. Ensure the PHP process can create and write to that folder. To use a different private folder, set the server-only `AVC_PAYMENT_QR_DIR` environment variable to its absolute path before starting PHP/Apache. Never place uploads inside a publicly browsable folder.

The current project has no pre-existing backend. If the database/API is not configured, the public page displays a connection warning and does not claim that edits were saved. Admin sign-in and tournament changes require the PHP API and MySQL database to be available.

## Validation

```powershell
& 'C:\xampp\php\php.exe' -l 'C:\xampp\htdocs\volleyvibe-premium\api.php'
node --check 'C:\xampp\htdocs\volleyvibe-premium\app.js'
```
