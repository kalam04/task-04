# Deploying to a server (Ubuntu + Apache)

These steps put the app on a Linux server (Ubuntu 24.04, e.g. a small VPS or an office machine)
so the whole team can use it at an address like `https://tasks.yourcompany.com`.

In production the backend serves the built React app, so **only one Node process on one port (4000)** is needed.
**Apache** sits in front of it as a reverse proxy and provides HTTPS. PM2 keeps the Node process running.

> Commands below use `sudo`. If you're logged in as `root`, you can leave `sudo` out.

**You need:** a server with Ubuntu 24.04 (2 GB RAM, 50 GB+ disk if you'll upload large files),
a domain or subdomain (e.g. `tasks.yourcompany.com`), and SSH access.

## 1. Point your domain at the server

At your domain provider, add a DNS **A record**: name `tasks` (or your subdomain) → your server's IP address.
It can take a few minutes to an hour to work.

## 2. Install the software

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y apache2 git ufw
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
sudo a2enmod proxy proxy_http headers rewrite ssl
```

Firewall: only SSH and web traffic from outside; port 4000 stays closed (Apache reaches it locally).

```bash
sudo ufw allow OpenSSH && sudo ufw allow 'Apache Full' && sudo ufw --force enable
```

## 3. Get the code onto the server

```bash
sudo mkdir -p /opt/task-management && sudo chown $USER /opt/task-management
```

**Option A — from a private GitHub repo (recommended; easy updates):**

```bash
git clone <your-private-repo-url> /opt/task-management
```

**Option B — copy from your computer** (run this on *your computer*, not the server). It skips databases,
uploads, settings and installed packages:

```bash
rsync -av --exclude node_modules --exclude '*.db' --exclude uploads --exclude backups --exclude .env --exclude dist \
  ./ user@YOUR_SERVER_IP:/opt/task-management/
```

Then on the server, install and build:

```bash
cd /opt/task-management
npm run install:all
npm run build
```

### If the code lives inside Apache's web root (e.g. `/var/www/html/task`)

Apache's default site would serve the folder as plain files — including `backend/.env` (secrets) and the
database. Block it (the app is reached through the proxy below, so nothing else changes):

```bash
sudo tee /etc/apache2/conf-available/block-task-app.conf > /dev/null <<'CONF'
<Directory /var/www/html/task>
    Require all denied
</Directory>
CONF
sudo a2enconf block-task-app && sudo systemctl reload apache2
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/task/backend/.env    # must print 403
```

Keeping the database and uploads outside the web root (`DB_PATH` / `UPLOAD_DIR` below) is safer still.

## 4. Configure

Folders for the database, attached files and backups — outside the code folder, so updates never touch them (the commands below use `/opt/task-management`; if your code is elsewhere, e.g. `/var/www/html/task`, use that path):

```bash
sudo mkdir -p /var/lib/task-management/uploads /var/backups/task-management
sudo chown -R $USER /var/lib/task-management /var/backups/task-management
```

Generate a secret key (copy the output):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Create the settings file:

```bash
cp backend/.env.example backend/.env
nano backend/.env
```

Set at least:

```
NODE_ENV=production
PORT=4000
JWT_SECRET=<the secret you just generated>
DEFAULT_USERNAME=admin
DEFAULT_PASSWORD=<a strong temporary password>
DB_PATH=/var/lib/task-management/data.db
UPLOAD_DIR=/var/lib/task-management/uploads
MAX_UPLOAD_MB=2048
BACKUP_DIR=/var/backups/task-management
TRUST_PROXY=true
TZ=Asia/Dhaka
```

(In nano: **Ctrl+O**, **Enter** to save, **Ctrl+X** to exit.)

**Moving existing data (optional):** stop the app on your computer, then copy its `backend/data.db` to
`/var/lib/task-management/data.db` and the `backend/uploads` folder to `/var/lib/task-management/uploads`.
Otherwise the app starts empty with just the admin account. Don't load demo data on a live server.

## 5. Start the app and keep it running

```bash
cd /opt/task-management
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup                  # prints a command — run that command too, so the app starts after a reboot
pm2 logs task-management     # should show "API running on http://localhost:4000 (serving the built app)"; Ctrl+C to exit
```

## 6. Apache site

Create `/etc/apache2/sites-available/task-management.conf` (`sudo nano …`), using your domain:

```apache
<VirtualHost *:80>
    ServerName tasks.yourcompany.com

    ProxyPreserveHost On
    ProxyRequests Off
    ProxyPass        / http://127.0.0.1:4000/
    ProxyPassReverse / http://127.0.0.1:4000/

    # Large uploads/downloads: no Apache size limit (the app enforces MAX_UPLOAD_MB) and long timeouts.
    # Recent Apache versions otherwise reject request bodies over 1 GB.
    LimitRequestBody 0
    ProxyTimeout 3600
    Timeout 3600

    # Tell the app whether the visitor used HTTPS
    RequestHeader set X-Forwarded-Proto expr=%{REQUEST_SCHEME}
</VirtualHost>
```

Enable it:

```bash
sudo a2ensite task-management
sudo apache2ctl configtest           # should print "Syntax OK"
sudo systemctl reload apache2
```

If Apache already serves other websites on this server, they keep working; this only adds a site for your task domain.

## 7. HTTPS (free certificate)

```bash
sudo apt install -y certbot python3-certbot-apache
sudo certbot --apache -d tasks.yourcompany.com
```

Certbot creates the HTTPS (`:443`) version of the site and renews the certificate automatically.
Open `https://tasks.yourcompany.com` — the login page should appear.

## 8. First login

1. Sign in as `admin` with the `DEFAULT_PASSWORD` from step 4.
2. **Your name (top right) → Change password.**
3. **Admins** page: create a second admin, so you're never locked out.
4. Add projects & clients, developers, and Marketing & Support members.

**Can't log in / forgot a password?** On the server:

```bash
cd /opt/task-management
npm run reset-password                  # lists the accounts
npm run reset-password -- admin         # sets a new random password for "admin" and prints it
```

The `DEFAULT_USERNAME` / `DEFAULT_PASSWORD` in `.env` are only used to create the first admin when the
database has none; changing them later doesn't change an existing password — use `reset-password`.

## Updating to a new version

**One command** (backs up, sets aside edits made on the server, pulls, installs, builds, restarts, checks):

```bash
cd /opt/task-management && npm run deploy
```

Or ask Claude Code on the server to do it: run `claude` in `/opt/task-management` and say *"update the live site
from GitHub"* — it follows the instructions in `CLAUDE.md`.

The manual steps, if you prefer:


With GitHub (option A) — make a backup first, then update:

```bash
cd /opt/task-management
npm run backup
git pull
npm run install:all
npm run build
pm2 restart task-management
```

With option B, run the `rsync` command from step 3 again on your computer, then the last three commands above on the server.

The database and files live in `/var/lib/task-management`, outside the code folder, so updates never touch them.
Database changes needed by a new version are applied automatically when the app starts.

## Backups

- The app writes a database backup **once a day** to `BACKUP_DIR` and keeps the newest 14 (`BACKUP_KEEP`).
- Make one by hand any time: `npm run backup`
- Attached files live in `UPLOAD_DIR`, **not** in the database backup. Back that folder up as well, e.g.
  `rsync -a /var/lib/task-management/uploads/ backup-host:/backups/task-uploads/` from a nightly cron job.
- **Copy backups off the server too** — or simply turn on your hosting provider's automatic snapshots.
  A backup on the same disk doesn't help if the server is lost.
- To restore: `pm2 stop task-management`, copy a backup file over `DB_PATH`, `pm2 start task-management`.

## Troubleshooting

| Problem | What to check |
|---|---|
| Site doesn't open at all | `pm2 status` (app online?) and `sudo systemctl status apache2` |
| "503 Service Unavailable" | The app isn't running — `pm2 logs task-management` shows why |
| "Invalid command 'ProxyPass'" | Modules not enabled — run the `a2enmod …` line from step 2, then reload Apache |
| Apache's default page shows instead of the app | `ServerName` must match your domain, and `a2ensite task-management` must have been run |
| Large file uploads fail | Make sure `LimitRequestBody 0` is in the site config (also in the `-le-ssl.conf` file Certbot created) |
| Can't sign in | `npm run reset-password -- admin` in `/opt/task-management` (see step 8) |
| App won't start: "JWT_SECRET is still the example value" | Put a real generated secret in `backend/.env` (step 4), then `pm2 restart task-management` |
| Certbot fails | DNS isn't pointing to the server yet — wait and try again |
| Apache error details | `sudo tail -50 /var/log/apache2/error.log` |
