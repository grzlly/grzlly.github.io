#!/bin/bash
set -e

echo "=== Setting up SSL & Coturn ==="

# Copy full nginx config with SSL
cp /tmp/mentorlink-deploy/mentorlink.nginx.conf /etc/nginx/sites-available/mentorlink
nginx -t && systemctl reload nginx

# Setup coturn with SSL
cp /tmp/mentorlink-deploy/turnserver.conf /etc/turnserver.conf
echo "cert=/etc/letsencrypt/live/grzly.ru/fullchain.pem" >> /etc/turnserver.conf
echo "pkey=/etc/letsencrypt/live/grzly.ru/privkey.pem" >> /etc/turnserver.conf
systemctl restart coturn

# Open firewall ports if ufw is active
if command -v ufw &> /dev/null && ufw status | grep -q active; then
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw allow 3478/udp
    ufw allow 3478/tcp
    ufw allow 5349/tcp
    ufw allow 49152:49252/udp
fi

echo ""
echo "=== ALL DONE ==="
echo "Test: curl -sI https://grzly.ru"
pm2 restart mentorlink
