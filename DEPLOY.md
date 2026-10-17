# Deploying to a server

These steps put the app on a Linux server (Ubuntu 24.04, e.g. a small VPS or an office machine)
so the whole team can use it at an address like `https://tasks.yourcompany.com`.

In production the backend serves the built React app, so **only one Node process on one port** is needed.
Nginx sits in front of it to provide HTTPS.

## 1. Install Node.js 24, Nginx and PM2

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs nginx git
sudo npm install -g pm2
```

## 2. Get the code and install

```bash
sudo mkdir -p /opt/task-management && sudo chown $USER /opt/task-management
git clone <your-private-repo-url> /opt/task-management
cd /opt/task-management
npm run install:all
npm run build
```

## 3. Configure

```bash
sudo mkdir -p /var/lib/task-management /var/backups/task-management
sudo chown $USER /var/lib/task-management /var/backups/task-management
cp backend/.env.example backend/.env
nano backend/.env
```

Set at least:

```
NODE_ENV=production
PORT=4000
JWT_SECRET=<output of: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
DEFAULT_USERNAME=admin
DEFAULT_PASSWORD=<a strong temporary password>
DB_PATH=/var/lib/task-management/data.db
UPLOAD_DIR=/var/lib/task-management/uploads
MAX_UPLOAD_MB=2048
BACKUP_DIR=/var/backups/task-management
TRUST_PROXY=true
TZ=Asia/Dhaka
```

**Moving your existing data:** copy your local `backend/data.db` to the server as
`/var/lib/task-management/data.db`, and the `backend/uploads` folder (attached files) to
`/var/lib/task-management/uploads` (stop the local app first). Otherwise the app starts empty
with just the admin account.

## 4. Start it and keep it running

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup        # run the command it prints, so the app starts after a reboot
pm2 logs task-management   # check for "API running on http://localhost:4000 (serving the built app)"
```

## 5. Nginx + HTTPS

Point your domain's DNS (an A record) at the server's IP, then create `/etc/nginx/sites-available/task-management`:

```nginx
server {
    server_name tasks.yourcompany.com;
    # Must be at least MAX_UPLOAD_MB, or large attachments fail with "413 Request Entity Too Large"
    client_max_body_size 2048m;

    location / {
        proxy_pass http://127.0.0.1:4000;
        # Stream big uploads/downloads straight through instead of buffering them on disk first
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/task-management /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tasks.yourcompany.com     # free HTTPS certificate, auto-renews
```

Only ports 80/443 (and SSH) need to be open; keep port 4000 closed to the outside:

```bash
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```

## 5b. Using Apache instead of Nginx

Skip section 5 and do this instead (Ubuntu's `apache2`).

```bash
sudo apt-get install -y apache2
sudo a2enmod proxy proxy_http headers rewrite ssl
sudo ufw allow 'Apache Full'
```

Create `/etc/apache2/sites-available/task-management.conf`:

```apache
<VirtualHost *:80>
    ServerName tasks.yourcompany.com

    ProxyPreserveHost On
    ProxyRequests Off
    ProxyPass        / http://127.0.0.1:4000/
    ProxyPassReverse / http://127.0.0.1:4000/
    # Large uploads/downloads: no Apache size limit (the app enforces MAX_UPLOAD_MB) and long timeouts
    LimitRequestBody 0
    ProxyTimeout 3600
    Timeout 3600
    RequestHeader set X-Forwarded-Proto expr=%{REQUEST_SCHEME}
</VirtualHost>
```

```bash
sudo a2ensite task-management
sudo apache2ctl configtest && sudo systemctl reload apache2
sudo apt-get install -y certbot python3-certbot-apache
sudo certbot --apache -d tasks.yourcompany.com     # free HTTPS, auto-renews; it creates the :443 site for you
```

If Apache already serves other websites on this server, they keep working; this only adds a new site for
your task domain.

## 6. After the first login

Sign in as `admin`, then use **your name (top right) → Change password**.

## Updating to a new version

```bash
cd /opt/task-management
git pull
npm run install:all
npm run build
pm2 restart task-management
```

The database lives in `/var/lib/task-management`, outside the code folder, so updates never touch it.
Database changes needed by a new version are applied automatically when the app starts.

## Backups

- The app writes a backup **once a day** to `BACKUP_DIR` and keeps the newest 14 (`BACKUP_KEEP`).
- Make one by hand any time: `npm run backup`
- Attached files live in `UPLOAD_DIR`, **not** in the database backup. Back that folder up as well, e.g.
  `rsync -a /var/lib/task-management/uploads/ backup-host:/backups/task-uploads/` from a nightly cron job.
- **Copy backups off the server too** (e.g. a nightly `rsync` or cloud storage). A backup on the same
  disk doesn't help if the server is lost.
- To restore: `pm2 stop task-management`, copy a backup file over `DB_PATH`, `pm2 start task-management`.
