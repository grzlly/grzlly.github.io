#!/bin/bash
set -e

echo "=== MentorLink VPS Setup ==="

# 1. Update system
echo "[1/8] Updating system..."
apt update && apt upgrade -y

# 2. Install Node.js 20.x
echo "[2/8] Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 3. Install Nginx
echo "[3/8] Installing Nginx..."
apt install -y nginx

# 4. Install Certbot
echo "[4/8] Installing Certbot..."
apt install -y certbot python3-certbot-nginx

# 5. Install Coturn
echo "[5/8] Installing Coturn..."
apt install -y coturn
sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn

# 6. Install PM2
echo "[6/8] Installing PM2..."
npm install -g pm2

# 7. Setup app
echo "[7/8] Setting up MentorLink..."
mkdir -p /var/www/mentorlink
cp -r /tmp/mentorlink-deploy/* /var/www/mentorlink/
cd /var/www/mentorlink
npm install --production

# 8. Setup Nginx (HTTP only first for cert)
echo "[8/8] Configuring Nginx..."
cat > /etc/nginx/sites-available/mentorlink << 'EOF'
server {
    listen 80;
    server_name grzly.ru;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
EOF

ln -sf /etc/nginx/sites-available/mentorlink /etc/nginx/sites-enabled/mentorlink
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

# Start app with PM2
cd /var/www/mentorlink
pm2 start server.js --name mentorlink
pm2 save
pm2 startup systemd -u root --hp /root

echo ""
echo "=== Base setup complete ==="
echo "Now run: certbot --nginx -d grzly.ru --non-interactive --agree-tos --email admin@grzly.ru"
echo "Then run: bash /tmp/mentorlink-deploy/setup-ssl.sh"
