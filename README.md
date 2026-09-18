# Sertifikat berish va tarqatish tizimi (SER tizim)

Davlat namunasidagi sertifikatlarni yaratish, boshqarish, ommaviy ro‘yxatdan o‘tkazish hamda fuqarolarga o‘z sertifikatlarini **PINFL (JSHSHIR)** orqali qidirib, rasmiy PDF formatida yuklab olish imkonini beruvchi zamonaviy veb-platforma (`cert.dtrm.uz` analogi).

---

## Asosiy imkoniyatlar

1. **Ochiq qidiruv portali:**
   - Fuqaro login yoki parolsiz faqat 14 xonali PINFL raqami orqali o‘z sertifikatini topadi.
   - Bitta so‘rov bilan PDF to‘g‘ridan-to‘g‘ri brauzerda ochiladi va yuklab olinadi.
   - Xavfsizlik: ochiq javoblarda PINFL to‘liq ko‘rsatilmaydi (`5010******0058`), ketma-ket terishdan himoyalovchi Rate Limiting mavjud (daqiqasiga 10 ta so‘rov).

2. **Haqiqiylikni tasdiqlovchi QR kod (`/t/:uid`):**
   - Har bir PDF sertifikatda dinamik QR kod mavjud.
   - Smartfon orqali skanerlanganda davlat reyestri tekshirish sahifasi ochiladi: «✓ Sertifikat haqiqiy va davlat reyestrida tasdiqlangan».

3. **To‘rtta tayyor dizayn shabloni:**
   - **`davlat`**: Davlat standarti — A4 vertikal, qo‘sh ramka, O‘zbekiston Respublikasi Davlat Gerbi, qizil bo‘rtma SERTIFIKAT sarlavhasi, gilyoş fon.
   - **`zamonaviy`**: Minimalistik sans-serif — A4 vertikal, toza oq fon, chap rang chizig‘i aktsenti.
   - **`korporativ`**: Korporativ biznes — A4 vertikal, chuqur gradient ko‘k sarlavha maydoni, maxsus nishonlar.
   - **`diplom`**: Klassik diplom — A4 gorizontal (albom), oltin hoshiyalar va burchak naqshlari.

4. **Jonli shablon tahriri (Live Preview):**
   - Admin panelda kurs yaratishda yoki tahrirlashda shablon, rang yoki matn o‘zgartirilsa, `iframe` ichida natija real vaqtda (300 ms) ko‘rinadi.

5. **Excel / CSV ommaviy import:**
   - Yuzlab tinglovchilarni `.xlsx` yoki `.csv` fayl orqali bitta tugma bilan yuklash.
   - Moslashuvchan ustunlar: `FIO`, `PINFL`, `Pasport`, `Sertifikat raqami`, `Ball`, `Sana`.
   - Butun import jarayoni SQLite tranzaksiyasida xavfsiz bajariladi; xatolar qator raqami bilan hisobot qilinadi.

6. **Server xotirasini tejovchi on-the-fly PDF:**
   - PDF fayllar diskda to‘planib joy egallamaydi — so‘rov paytida `playwright-core` Chromium dvigateli orqali generatsiya qilinadi.

---

## Papkalar tuzilishi

```
sertifikat-tizimi/
├── package.json
├── .env.example              # Muhit o'zgaruvchilari namunasi
├── .env                      # Amaldagi konfiguratsiya
├── README.md                 # O'rnatish va serverga qo'yish qo'llanmasi
├── data/                     # sertifikat.db (SQLite bazasi)
├── uploads/                  # Yuklangan logo va gerb rasmlari
├── templates/                # HTML/CSS sertifikat dizaynlari
│   ├── davlat.html           # Rasmiy davlat uslubi (vertikal)
│   ├── zamonaviy.html        # Minimal sans-serif (vertikal)
│   ├── korporativ.html       # Ko'k sarlavha maydonli (vertikal)
│   └── diplom.html           # Oltin naqshli klassik diplom (gorizontal)
├── src/
│   ├── db.js                 # SQLite sxemasi, migratsiya, admin yaratish
│   ├── render.js             # Shablon renderi, QR kod, Chromium orqali PDF
│   └── server.js             # Express server va barcha API marshrutlari
└── public/
    ├── index.html            # PINFL qidiruv sahifasi (ochiq portal)
    └── admin/
        ├── login.html        # Administrator kirish sahifasi
        └── index.html        # Administrator boshqaruv paneli (SPA)
```

---

## O‘rnatish va ishga tushirish

### 1. Talablar:
- Node.js 20+ (yoki 22+)
- Google Chrome yoki Microsoft Edge (PDF renderlash uchun)

### 2. O‘rnatish:
```bash
# Loyiha papkasiga kiring
cd sertifikat-tizimi

# Kutubxonalarni o'rnating
npm install

# Serverni ishga tushiring
npm start
```

Ishga tushgach:
- Ochiq qidiruv portali: `http://localhost:3000`
- Administrator paneli: `http://localhost:3000/admin`
- Standart login: `admin`
- Standart parol: `admin123`
*(Birinchi kirishda tizim xavfsizlik uchun parolni yangilashni talab qiladi).*

---

## Linux VPS (Ubuntu 22.04 / 24.04) da serverga qo‘yish

### 1. Tizim talablarini o‘rnatish:
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nodejs npm nginx chromium-browser
```

### 2. Loyihani yuklash va sozlash:
```bash
cd /var/www
git clone <sizning-repongiz> sertifikat-tizimi
cd sertifikat-tizimi

cp .env.example .env
nano .env
# .env ichida:
# PORT=3000
# BASE_URL=https://sertifikat.sizningdomen.uz
# CHROMIUM_PATH=/usr/bin/chromium-browser

npm install
```

### 3. `systemd` xizmat fayli (`/etc/systemd/system/sertifikat.service`):
```ini
[Unit]
Description=Sertifikat Berish va Tarqatish Tizimi
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/sertifikat-tizimi
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=sertifikat-app
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Xizmatni faollashtirish:
```bash
sudo systemctl daemon-reload
sudo systemctl enable sertifikat
sudo systemctl start sertifikat
sudo systemctl status sertifikat
```

### 4. Nginx konfiguratsiyasi (`/etc/nginx/sites-available/sertifikat`):
```nginx
server {
    listen 80;
    server_name sertifikat.sizningdomen.uz;

    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Nginx'ni yoqish va SSL o‘rnatish:
```bash
sudo ln -s /etc/nginx/sites-available/sertifikat /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# Bepul Let's Encrypt SSL:
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d sertifikat.sizningdomen.uz
```

---

## Excel Import namunasi

Excel faylda sarlavha birinchi qatorda bo‘lishi lozim:

| FIO | PINFL | Pasport | Sertifikat raqami | Qayd raqami | Ball | Sana |
|---|---|---|---|---|---|---|
| KARIMOV SARDOR BAXTIYOROVICH | 31502900000012 | AA1234567 | 000001 | 3153 | 88.5 | 2026-04-02 |
| ALIMOVA ZILOLA BOTIROVNA | 41203950000025 | AB9876543 | | | 92.0 | 2026-04-02 |

*Eslatma: Agar `Sertifikat raqami` bo‘sh qoldirilsa, tizim navbatdagi raqamni avtomatik beradi.*

---

## Litsenziya va Mualliflik

Ushbu dasturiy ta'minot O‘zbekiston Respublikasi raqamli ta'lim va sertifikatlash standartlariga muvofiq ishlab chiqilgan.
