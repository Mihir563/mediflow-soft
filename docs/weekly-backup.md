# Weekly cloud backup to Google Drive

Every Sunday at 21:00 India time, GitHub Actions (`.github/workflows/weekly-cloud-backup.yml`):

1. dumps the Supabase database (all store data in the `public` schema),
2. checks the dump is readable and contains the key tables,
3. encrypts it with your passphrase (AES-256) and checks it decrypts,
4. uploads it to the Google Drive folder **MediFlow-Backups**,
5. keeps the newest **8** backups and deletes older ones.

> This backs up the **cloud** copy. It is only as complete as the shop laptop's sync — run
> **Settings → Cloud Backup → Backup to Cloud** on the laptop after installing a new version.
> The laptop's own daily backups (`%APPDATA%\com.mediflow.app\backups`) stay the first line of defence.

## One-time setup (about 15 minutes)

### 1. Database connection string → secret `SUPABASE_DB_URL`
Supabase dashboard → your project → **Connect** → **Session pooler** → copy the URI
(`postgresql://postgres.<ref>:<password>@aws-….pooler.supabase.com:5432/postgres`).
Put your database password in place of `[YOUR-PASSWORD]`. Use the *session pooler* one: GitHub's
servers can't reach the direct `db.<ref>.supabase.co` address.

### 2. Backup passphrase → secret `BACKUP_PASSPHRASE`
Make a long random password (20+ characters). **Write it down and keep it offline** — without it,
no backup can ever be opened, and nobody (including GitHub or Google) can recover it.

### 3. Google Drive sign-in → secret `RCLONE_CONFIG`
On your PC (one time):
1. Install rclone: `winget install Rclone.Rclone` (or download from rclone.org).
2. Run `rclone config` and answer:
   - `n` (new remote) → name: **gdrive**
   - storage: **drive** (Google Drive)
   - client_id / client_secret: leave empty (press Enter)
   - scope: **3** = `drive.file` (rclone can only see files it creates)
   - service_account_file: leave empty
   - advanced config: `n`
   - use web browser to authenticate: `y` → sign in with the Google account that should hold the backups → Allow
   - shared drive: `n` → `y` to keep the remote → `q` to quit
3. Run `rclone config show gdrive` and copy **everything** it prints (starts with `[gdrive]`).

### 4. Add the secrets on GitHub
github.com/Mihir563/mediflow-soft → **Settings → Secrets and variables → Actions → New repository secret**,
add `SUPABASE_DB_URL`, `BACKUP_PASSPHRASE`, `RCLONE_CONFIG`.

### 5. Test it now
**Actions → Weekly cloud backup → Run workflow.** After ~2 minutes it should be green and a file
`mediflow-cloud-<date>.dump.gpg` appears in Google Drive → MediFlow-Backups.
If it fails, the red step says why (missing secret, wrong password, sign-in expired).

## Restoring a backup

1. Download the `.dump.gpg` file from Google Drive.
2. Decrypt: `gpg --decrypt mediflow-cloud-<date>.dump.gpg > mediflow.dump` (enter the passphrase).
3. **Into a new/test database first**, never straight over the live one:
   `pg_restore --no-owner --no-privileges --dbname "<connection string>" mediflow.dump`
4. Check the data, then decide what to copy back.

Notes: user logins (Supabase Auth) are not in this backup — accounts are recreated in Supabase if a
project is ever lost. Free Supabase projects can be paused after a period of inactivity; if a backup
run fails to connect, check the project status in the Supabase dashboard.
