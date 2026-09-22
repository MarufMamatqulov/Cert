#!/usr/bin/env bash
set -e

# ==========================================
# SER Tizim — Avtomatlashtirilgan Server O'rnatish Skripti
# Server: Ubuntu / Debian Linux
# ==========================================

echo "=========================================="
echo "🚀 SER Tizimni o'rnatish boshlanmoqda..."
echo "=========================================="

if [ "$EUID" -ne 0 ]; then
  echo "❌ Iltimos, ushbu skriptni root foydalanuvchisi sifatida ishga tushiring:"
  echo "   sudo bash deploy.sh"
  exit 1
fi

# Tizim paketlarini yangilash
echo "📦 1/7. Tizim paketlari yangilanmoqda..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl wget git build-essential nginx ufw ca-certificates gnupg

# Node.js 22 LTS o'rnatish
echo "🟢 2/7. Node.js 22 LTS o'rnatilmoqda..."
if ! command -v node &> /dev/null || [[ $(node -v | cut -d'.' -f1) != "v22" ]]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
fi
echo "Node versiyasi: $(node -v)"
echo "NPM versiyasi: $(npm -v)"

# PM2 o'rnatish
echo "⚙️ 3/7. PM2 jarayon boshqaruvchisi o'rnatilmoqda..."
npm install -g pm2

# Chromium / Chrome (PDF generatsiyasi uchun zarur kutubxonalar)
echo "🌐 4/7. PDF generatsiyasi uchun Chromium va kutubxonalar o'rnatilmoqda..."
apt-get install -y \
  libnss3 \
  libnspr4 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libcups2 \
  libdrm2 \
  libdbus-1-3 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxrandr2 \
  libgbm1 \
  libpango-1.0-0 \
  libcairo2 \
  libasound2 \
  chromium-browser || apt-get install -y chromium || true

# Loyiha papkasini sozlash
APP_DIR="/var/www/ser-tizim"
echo "📂 5/7. Loyiha papkasi sozlanmoqda: $APP_DIR..."

if [ ! -d "$APP_DIR" ]; then
    git clone https://github.com/MarufMamatqulov/Cert.git "$APP_DIR"
    cd "$APP_DIR"
else
    cd "$APP_DIR"
    git fetch origin
    git reset --hard origin/main
fi

mkdir -p uploads templates data

# Bog'liqliklarni o'rnatish
echo "📦 NPM paketlari o'rnatilmoqda..."
npm install

# Playwright brauzerini sozlash
npx playwright install-deps chromium || true
npx playwright install chromium || true

# .env sozlash
SERVER_IP=$(curl -s ifconfig.me || ip route get 1.1.1.1 | awk '{print $7}' || echo "169.58.11.14")
if [ ! -f .env ]; then
    RAND_SECRET=$(head /dev/urandom | tr -dc A-Za-z0-9 | head -c 32)
    cat << EOF > .env
PORT=3000
SESSION_SECRET=${RAND_SECRET}
ADMIN_USER=admin
ADMIN_PASS=admin123
BASE_URL=http://${SERVER_IP}
CHROMIUM_PATH=auto
SECURE_COOKIE=0
EOF
    echo "✅ .env fayli yaratildi (BASE_URL=http://${SERVER_IP})"
fi

# Nginx sozlash
echo "🌐 6/7. Nginx veb-serveri sozlanmoqda..."
cat << 'EOF' > /etc/nginx/sites-available/ser-tizim
server {
    listen 80;
    server_name _;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/ser-tizim /etc/nginx/sites-enabled/ser-tizim
nginx -t && systemctl reload nginx

# Xavfsizlik devori (UFW)
echo "🛡️ Xavfsizlik devori (UFW) sozlanmoqda..."
ufw allow 22/tcp || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
ufw --force enable || true

# PM2 orqali ilovani ishga tushirish
echo "🚀 7/7. Ilova PM2 orqali ishga tushirilmoqda..."
pm2 stop ser-tizim 2>/dev/null || true
pm2 delete ser-tizim 2>/dev/null || true
pm2 start src/server.js --name "ser-tizim"
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

echo "=========================================="
echo "🎉 O'RNATISH MUVAFFAQIYATLI YAKUNLANDI!"
echo "👉 Sayt manzili: http://${SERVER_IP}"
echo "👉 Admin paneli: http://${SERVER_IP}/admin/login"
echo "👉 Standart login: admin"
echo "👉 Standart parol: admin123"
echo "=========================================="
