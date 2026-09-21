const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const XLSX = require('xlsx');
require('dotenv').config();

const {
  db,
  initDb,
  getNextCertNo,
  getNextRegNo,
  generateUid,
  maskPinfl,
  getSetting,
  setSetting,
  getCustomTemplate,
  getAllCustomTemplates
} = require('./db');

const {
  renderHtml,
  renderCustomHtml,
  isTemplateLandscape,
  generatePdf,
  formatUzDate
} = require('./render');

const { generateMathCaptcha } = require('./captcha');

// Initialize database
initDb();

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Rate limiter helper for IP
const searchRateLimit = new Map();
const loginRateLimit = new Map();

function checkRateLimit(map, ip, maxRequests, windowMs) {
  const now = Date.now();
  const entry = map.get(ip) || { count: 0, resetTime: now + windowMs };

  if (now > entry.resetTime) {
    entry.count = 1;
    entry.resetTime = now + windowMs;
    map.set(ip, entry);
    return true;
  }

  if (entry.count >= maxRequests) {
    return false;
  }

  entry.count += 1;
  map.set(ip, entry);
  return true;
}

// Clean up stale rate limits every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of searchRateLimit.entries()) {
    if (now > entry.resetTime) searchRateLimit.delete(ip);
  }
  for (const [ip, entry] of loginRateLimit.entries()) {
    if (now > entry.resetTime) loginRateLimit.delete(ip);
  }
}, 300000);

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'sertifikat-maxfiy-kalit-2026-xavfsiz',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24, // 24 hours
    httpOnly: true,
    secure: process.env.SECURE_COOKIE === '1',
    sameSite: 'lax'
  }
}));

// Uploads configuration
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Admin authentication middleware
function needAuth(req, res, next) {
  if (req.session && req.session.adminId) {
    return next();
  }
  if (req.originalUrl.startsWith('/admin/api/')) {
    return res.status(401).json({ error: 'Avtorizatsiyadan o\'tilmagan. Iltimos, tizimga kiring.' });
  }
  return res.redirect('/admin/login');
}

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(uploadsDir));

// ==========================================
// 1. PUBLIC ROUTES (Ochiq qism)
// ==========================================

// Mathematical Captcha generator endpoint
app.get('/api/captcha', (req, res) => {
  const captcha = generateMathCaptcha();
  req.session.captcha = {
    answer: captcha.answer,
    expires: Date.now() + 5 * 60 * 1000 // 5 minutes validity
  };
  res.json({ svg: captcha.dataUrl });
});

// Config for public search dropdown
app.get('/api/config', (req, res) => {
  try {
    const title = getSetting('site_title') || "Digital Education Development Center";
    const org = getSetting('site_org') || "Digital Education Development Center";
    const logo = getSetting('logo_path') || 'RTRM logo eng.png';

    const courses = db.prepare(`
      SELECT id, code, title, series 
      FROM courses 
      WHERE active = 1 
      ORDER BY id ASC
    `).all();

    res.json({ title, org, logo, courses });
  } catch (err) {
    console.error('Config API error:', err);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

// PINFL Search with 10 req/min rate limit and math captcha verification
app.post('/api/search', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  if (!checkRateLimit(searchRateLimit, ip, 10, 60000)) {
    return res.status(429).json({
      error: 'So‘rovlar soni me‘yordan oshdi. Iltimos, bir daqiqadan so‘ng qayta urinib ko‘ring.'
    });
  }

  const { pinfl, course, captcha } = req.body;

  // Validate math captcha
  if (!req.session.captcha || Date.now() > req.session.captcha.expires) {
    return res.status(400).json({
      error: 'Xavfsizlik kodi muddati tugagan. Iltimos, yangilang.',
      reloadCaptcha: true
    });
  }

  const expectedAnswer = req.session.captcha.answer;
  delete req.session.captcha; // Prevent reuse of the same captcha

  if (captcha === undefined || captcha === null || String(captcha).trim() === '' || parseInt(String(captcha).trim(), 10) !== expectedAnswer) {
    return res.status(400).json({
      error: 'Xavfsizlik kodi (matematik hisob) noto‘g‘ri kiritildi. Qaytadan urinib ko‘ring.',
      reloadCaptcha: true
    });
  }

  if (!pinfl || String(pinfl).trim().length < 4) {
    return res.status(400).json({ error: 'JSHSHIR (PINFL) raqamini to‘liq kiriting (14 ta raqam).' });
  }

  const cleanPinfl = String(pinfl).replace(/\D/g, '').trim();
  if (cleanPinfl.length !== 14) {
    return res.status(400).json({ error: 'JSHSHIR (PINFL) 14 ta raqamdan iborat bo‘lishi kerak.' });
  }

  try {
    let query = `
      SELECT c.id, c.uid, c.fio, c.pinfl, c.cert_no, c.reg_no, c.score, c.issue_date,
             k.title as course_title, k.series, k.hours
      FROM certificates c
      JOIN courses k ON c.course_id = k.id
      WHERE c.pinfl = ? AND c.status = 'active'
    `;
    const params = [cleanPinfl];

    if (course && course !== 'all') {
      query += ' AND k.code = ?';
      params.push(course);
    }

    query += ' ORDER BY c.issue_date DESC, c.id DESC';

    const results = db.prepare(query).all(params);

    const maskedResults = results.map(row => ({
      uid: row.uid,
      fio: row.fio,
      pinfl: maskPinfl(row.pinfl),
      course_title: row.course_title,
      series: row.series,
      cert_no: row.cert_no,
      reg_no: row.reg_no,
      score: row.score,
      hours: row.hours,
      issue_date: row.issue_date,
      formatted_date: formatUzDate(row.issue_date),
      download_url: `/yuklash/${row.uid}`
    }));

    res.json({
      count: maskedResults.length,
      certificates: maskedResults
    });
  } catch (err) {
    console.error('Search API error:', err);
    res.status(500).json({ error: 'Qidiruvda xatolik yuz berdi' });
  }
});

// Download / View PDF on the fly
app.get('/yuklash/:uid', async (req, res) => {
  const { uid } = req.params;
  if (!uid || uid.length < 6) {
    return res.status(400).send('Noto‘g‘ri sertifikat identifikatori.');
  }

  try {
    const cert = db.prepare(`
      SELECT c.*, k.title, k.org_line1, k.org_line2, COALESCE(c.series, k.series) as series, k.hours, 
             k.start_date, k.end_date, k.body_text, k.director, k.show_score, 
             k.accent, k.template as course_template
      FROM certificates c
      JOIN courses k ON c.course_id = k.id
      WHERE c.uid = ? AND c.status = 'active'
    `).get(uid);

    if (!cert) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html lang="uz">
        <head>
          <meta charset="UTF-8">
          <title>Sertifikat topilmadi</title>
          <style>
            body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc; color: #1e293b; }
            .card { background: white; padding: 32px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); text-align: center; max-width: 440px; }
            h2 { color: #dc2626; margin-bottom: 12px; }
            p { color: #64748b; margin-bottom: 24px; line-height: 1.5; }
            a { display: inline-block; background: #1e3a8a; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Sertifikat topilmadi</h2>
            <p>Ushbu kodli sertifikat mavjud emas yoki u bekor qilingan bo'lishi mumkin.</p>
            <a href="/">Bosh sahifaga qaytish</a>
          </div>
        </body>
        </html>
      `);
    }

    // Log download asynchronously
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    try {
      db.prepare('INSERT INTO downloads (certificate_id, ip) VALUES (?, ?)').run(cert.id, ip);
    } catch (_) {}

    const templateName = cert.template || cert.course_template || 'davlat';
    const configuredBaseUrl = getSetting('base_url');
    const reqHost = req.get('host');
    const dynamicBaseUrl = reqHost ? `${req.protocol}://${reqHost}` : BASE_URL;
    const baseUrl = (configuredBaseUrl && !configuredBaseUrl.includes('localhost')) ? configuredBaseUrl : dynamicBaseUrl;
    const html = await renderHtml(templateName, cert, baseUrl);

    const isLandscape = isTemplateLandscape(templateName);
    const pdfBuffer = await generatePdf(html, isLandscape);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="sertifikat_${cert.series}_${cert.cert_no}.pdf"`);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(pdfBuffer);
  } catch (err) {
    console.error('PDF Generation error:', err);
    res.status(500).send('PDF generatsiyasida xatolik yuz berdi: ' + err.message);
  }
});

// Verification page (QR Code destination)
app.get('/t/:uid', (req, res) => {
  const { uid } = req.params;

  const cert = db.prepare(`
    SELECT c.*, k.title as course_title, k.org_line1, k.org_line2, k.series, k.hours
    FROM certificates c
    JOIN courses k ON c.course_id = k.id
    WHERE c.uid = ?
  `).get(uid);

  const siteTitle = getSetting('site_title') || "Digital Education Development Center";
  const siteOrg = getSetting('site_org') || "Digital Education Development Center";

  if (!cert) {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html lang="uz">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Sertifikat tekshirish</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f1f5f9; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; }
          .card { background: white; padding: 32px 24px; border-radius: 16px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1); border-top: 6px solid #ef4444; }
          .icon { font-size: 52px; color: #ef4444; margin-bottom: 16px; }
          h1 { font-size: 20px; color: #1e293b; margin-bottom: 8px; }
          p { color: #64748b; font-size: 14px; line-height: 1.6; margin-bottom: 24px; }
          .btn { display: inline-block; background: #0f172a; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">✕</div>
          <h1>Sertifikat topilmadi</h1>
          <p>Ushbu kodga tegishli sertifikat davlat reyestrida mavjud emas. Iltimos, QR kodni qaytadan to‘g‘ri skanerlaganingizga ishonch hosil qiling.</p>
          <a href="/" class="btn">Reyestr bosh sahifasi</a>
        </div>
      </body>
      </html>
    `);
  }

  const isRevoked = cert.status === 'revoked';
  const maskedPinfl = maskPinfl(cert.pinfl);
  const formattedDate = formatUzDate(cert.issue_date);

  res.send(`
    <!DOCTYPE html>
    <html lang="uz">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Sertifikat haqiqiyligini tekshirish — ${cert.series} № ${cert.cert_no}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #f8fafc;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 24px 16px;
          color: #0f172a;
        }
        .container {
          max-width: 540px;
          width: 100%;
          background: #ffffff;
          border-radius: 20px;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.06), 0 8px 10px -6px rgba(0, 0, 0, 0.04);
          overflow: hidden;
          border: 1px solid #e2e8f0;
        }
        .header-status {
          background: ${isRevoked ? '#fef2f2' : '#f0fdf4'};
          border-bottom: 2px solid ${isRevoked ? '#fecaca' : '#bbf7d0'};
          padding: 24px 20px;
          text-align: center;
        }
        .status-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 18px;
          border-radius: 9999px;
          background: ${isRevoked ? '#dc2626' : '#16a34a'};
          color: #ffffff;
          font-weight: 700;
          font-size: 15px;
          letter-spacing: 0.5px;
          box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
        }
        .status-desc {
          margin-top: 10px;
          font-size: 13.5px;
          color: ${isRevoked ? '#991b1b' : '#166534'};
          font-weight: 500;
        }
        .content {
          padding: 28px 24px;
        }
        .info-group {
          margin-bottom: 18px;
        }
        .info-label {
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: #64748b;
          font-weight: 600;
          margin-bottom: 4px;
        }
        .info-value {
          font-size: 16px;
          font-weight: 700;
          color: #0f172a;
          line-height: 1.4;
        }
        .info-value.fio {
          font-size: 19px;
          color: #1e3a8a;
        }
        .info-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
          background: #f8fafc;
          padding: 16px;
          border-radius: 12px;
          border: 1px solid #e2e8f0;
          margin-bottom: 20px;
        }
        .btn-download {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          width: 100%;
          background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%);
          color: white;
          text-decoration: none;
          padding: 14px 20px;
          border-radius: 12px;
          font-weight: 700;
          font-size: 15px;
          box-shadow: 0 10px 15px -3px rgba(37, 99, 235, 0.25);
          transition: transform 0.15s ease;
        }
        .btn-download:hover {
          transform: translateY(-1px);
        }
        .footer-note {
          margin-top: 20px;
          text-align: center;
          font-size: 12px;
          color: #94a3b8;
          line-height: 1.5;
        }
      </style>
    </head>
    <body>
      <div style="text-align: center; margin-bottom: 24px;">
        <a href="/">
          <img src="/RTRM%20logo%20eng.png" alt="Digital Education Development Center" style="max-height: 46px; width: auto; object-fit: contain;">
        </a>
      </div>
      <div class="container">
        <div class="header-status">
          <div class="status-badge">
            <span>${isRevoked ? '✕' : '✓'}</span>
            <span>${isRevoked ? 'SERTIFIKAT BEKOR QILINGAN' : 'SERTIFIKAT HAQIQIY'}</span>
          </div>
          <div class="status-desc">
            ${isRevoked ? 'Mazkur sertifikat ma‘muriyat tomonidan bekor qilingan.' : 'Ushbu sertifikat davlat reyestridan rasman ro‘yxatdan o‘tgan.'}
          </div>
        </div>

        <div class="content">
          <div class="info-group">
            <div class="info-label">Tinglovchi (F.I.Sh.)</div>
            <div class="info-value fio">${cert.fio}</div>
          </div>

          <div class="info-group">
            <div class="info-label">Kurs nomi</div>
            <div class="info-value">${cert.course_title}</div>
          </div>

          <div class="info-grid">
            <div>
              <div class="info-label">Seriya va raqam</div>
              <div class="info-value">${cert.series} № ${cert.cert_no}</div>
            </div>
            <div>
              <div class="info-label">JSHSHIR (PINFL)</div>
              <div class="info-value" style="font-family: monospace;">${maskedPinfl}</div>
            </div>
            <div>
              <div class="info-label">Berilgan sana</div>
              <div class="info-value">${formattedDate}</div>
            </div>
            <div>
              <div class="info-label">Qayd raqami</div>
              <div class="info-value">№ ${cert.reg_no}</div>
            </div>
          </div>

          ${!isRevoked ? `
            <a href="/yuklash/${cert.uid}" class="btn-download" target="_blank">
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
              </svg>
              Asl PDF sertifikatni yuklab olish
            </a>
          ` : ''}

          <div class="footer-note">
            ${siteOrg}<br>
            Tekshiruv kodi: <strong>${cert.uid}</strong>
          </div>
        </div>
      </div>
    </body>
    </html>
  `);
});

// Admin login page redirect
app.get('/admin/login', (req, res) => {
  if (req.session && req.session.adminId) {
    return res.redirect('/admin');
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'login.html'));
});

// Admin panel SPA
app.get('/admin', needAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'index.html'));
});

// ==========================================
// 2. ADMIN AUTH ROUTES
// ==========================================

app.post('/admin/api/login', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const isLocal = ip.includes('127.0.0.1') || ip.includes('::1') || ip === 'unknown';
  if (!isLocal && !checkRateLimit(loginRateLimit, ip, 30, 2 * 60000)) {
    return res.status(429).json({ error: 'Kirish urinishlari ko‘payib ketdi. 2 daqiqadan so‘ng qayta urinib ko‘ring.' });
  }

  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Login va parolni kiriting.' });
  }

  const admin = db.prepare('SELECT * FROM admins WHERE username = ? AND active = 1').get(username.trim());
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Login yoki parol noto‘g‘ri.' });
  }

  // Clear rate limit on successful authentication
  loginRateLimit.delete(ip);

  req.session.adminId = admin.id;
  req.session.username = admin.username;
  req.session.role = admin.role;
  req.session.fullName = admin.full_name;
  req.session.mustChangePassword = Boolean(admin.must_change_password);

  res.json({
    success: true,
    must_change_password: Boolean(admin.must_change_password),
    user: {
      id: admin.id,
      username: admin.username,
      full_name: admin.full_name,
      role: admin.role
    }
  });
});

app.post('/admin/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.get('/admin/api/me', needAuth, (req, res) => {
  const admin = db.prepare('SELECT id, username, full_name, role, must_change_password, created_at FROM admins WHERE id = ?').get(req.session.adminId);
  const settings = {
    site_title: getSetting('site_title') || '',
    site_org: getSetting('site_org') || '',
    base_url: getSetting('base_url') || BASE_URL,
    logo_path: getSetting('logo_path') || ''
  };

  const customTemplates = getAllCustomTemplates();
  res.json({
    admin,
    templates: ['davlat', 'zamonaviy', 'korporativ', 'diplom'],
    customTemplates,
    settings
  });
});

// ==========================================
// 3. ADMIN DASHBOARD & CRUD ROUTES
// ==========================================

app.get('/admin/api/stats', needAuth, (req, res) => {
  try {
    const total_certs = db.prepare('SELECT COUNT(*) as c FROM certificates').get().c;
    const active_certs = db.prepare("SELECT COUNT(*) as c FROM certificates WHERE status = 'active'").get().c;
    const total_courses = db.prepare('SELECT COUNT(*) as c FROM courses').get().c;
    const total_downloads = db.prepare('SELECT COUNT(*) as c FROM downloads').get().c;

    const recent_certs = db.prepare(`
      SELECT c.id, c.uid, c.fio, c.pinfl, c.cert_no, c.issue_date, c.status,
             k.title as course_title, k.series
      FROM certificates c
      JOIN courses k ON c.course_id = k.id
      ORDER BY c.id DESC
      LIMIT 8
    `).all().map(r => ({
      ...r,
      pinfl: maskPinfl(r.pinfl),
      formatted_date: formatUzDate(r.issue_date)
    }));

    res.json({
      total_certs,
      active_certs,
      total_courses,
      total_downloads,
      recent_certs
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Statistikani yuklashda xatolik' });
  }
});

// Courses CRUD
app.get('/admin/api/courses', needAuth, (req, res) => {
  try {
    const courses = db.prepare(`
      SELECT k.*, 
             (SELECT COUNT(*) FROM certificates c WHERE c.course_id = k.id) as cert_count
      FROM courses k
      ORDER BY k.id DESC
    `).all();
    res.json(courses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/admin/api/courses', needAuth, (req, res) => {
  const {
    code, title, org_line1, org_line2, template, series,
    hours, start_date, end_date, body_text, director, show_score, accent, active
  } = req.body;

  if (!code || !title || !org_line1 || !series) {
    return res.status(400).json({ error: 'Kurs kodi, nomi, tashkilot nomi va seriya majburiy.' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO courses (
        code, title, org_line1, org_line2, template, series,
        hours, start_date, end_date, body_text, director, show_score, accent, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(code).trim().toLowerCase(),
      String(title).trim(),
      String(org_line1).trim(),
      String(org_line2 || '').trim(),
      template || 'davlat',
      String(series).trim().toUpperCase(),
      parseInt(hours, 10) || 72,
      start_date || null,
      end_date || null,
      body_text || "{{START}}dan {{END}}gacha {{HOURS}} soatga mo'ljallangan «{{TITLE}}» kursi bo'yicha malakasini oshirdi.",
      director || 'I.M. Azimov',
      show_score ? 1 : 0,
      accent || '#1a56db',
      active ? 1 : 0
    );

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Bu kodli kurs allaqachon mavjud. Boshqa kod tanlang.' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/admin/api/courses/:id', needAuth, (req, res) => {
  const id = req.params.id;
  const {
    code, title, org_line1, org_line2, template, series,
    hours, start_date, end_date, body_text, director, show_score, accent, active
  } = req.body;

  try {
    db.prepare(`
      UPDATE courses SET
        code = ?, title = ?, org_line1 = ?, org_line2 = ?, template = ?, series = ?,
        hours = ?, start_date = ?, end_date = ?, body_text = ?, director = ?,
        show_score = ?, accent = ?, active = ?
      WHERE id = ?
    `).run(
      String(code).trim().toLowerCase(),
      String(title).trim(),
      String(org_line1).trim(),
      String(org_line2 || '').trim(),
      template || 'davlat',
      String(series).trim().toUpperCase(),
      parseInt(hours, 10) || 72,
      start_date || null,
      end_date || null,
      body_text,
      director || 'I.M. Azimov',
      show_score ? 1 : 0,
      accent || '#1a56db',
      active ? 1 : 0,
      id
    );

    res.json({ success: true });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Bu kodli kurs allaqachon mavjud.' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.delete('/admin/api/courses/:id', needAuth, (req, res) => {
  const id = req.params.id;
  try {
    const certCount = db.prepare('SELECT COUNT(*) as c FROM certificates WHERE course_id = ?').get(id).c;
    if (certCount > 0) {
      return res.status(400).json({ error: `Ushbu kursda ${certCount} ta sertifikat mavjud. Avval ularni o'chiring.` });
    }
    db.prepare('DELETE FROM courses WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auto-generate next numbers and series for a course
app.get('/admin/api/courses/:id/next-numbers', needAuth, (req, res) => {
  const courseId = req.params.id;
  try {
    const course = db.prepare('SELECT id, series FROM courses WHERE id = ?').get(courseId);
    if (!course) {
      return res.status(404).json({ error: 'Kurs topilmadi' });
    }
    const nextCertNo = getNextCertNo(courseId);
    const nextRegNo = getNextRegNo();
    const today = new Date().toISOString().split('T')[0];

    res.json({
      series: course.series || 'MO',
      next_cert_no: nextCertNo,
      next_reg_no: nextRegNo,
      issue_date: today
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// CUSTOM TEMPLATES API (Vizual Konstruktor)
// ==========================================

// Get all custom templates
app.get('/admin/api/custom-templates', needAuth, (req, res) => {
  try {
    const templates = getAllCustomTemplates();
    res.json(templates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single custom template
app.get('/admin/api/custom-templates/:id', needAuth, (req, res) => {
  try {
    const tpl = getCustomTemplate(req.params.id);
    if (!tpl) return res.status(404).json({ error: 'Shablon topilmadi.' });
    res.json(tpl);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new custom template with background image upload
app.post('/admin/api/custom-templates', needAuth, upload.single('bg_image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Blanka fon rasmi (.png yoki .jpg) yuklanishi shart.' });
  }

  const { name, orientation = 'landscape', elements_config } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Shablon nomi kiritilishi shart.' });
  }

  const bg_image = path.basename(req.file.path);
  let finalConfig = '{}';

  if (typeof elements_config === 'string') {
    finalConfig = elements_config;
  } else if (typeof elements_config === 'object') {
    finalConfig = JSON.stringify(elements_config);
  }

  try {
    const result = db.prepare(`
      INSERT INTO custom_templates (name, bg_image, orientation, elements_config)
      VALUES (?, ?, ?, ?)
    `).run(name.trim(), bg_image, orientation, finalConfig);

    const created = getCustomTemplate(result.lastInsertRowid);
    res.json({ success: true, id: result.lastInsertRowid, template: created });
  } catch (err) {
    console.error('Create template error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update custom template
app.put('/admin/api/custom-templates/:id', needAuth, upload.single('bg_image'), (req, res) => {
  const id = req.params.id;
  const tpl = getCustomTemplate(id);
  if (!tpl) return res.status(404).json({ error: 'Shablon topilmadi.' });

  const { name, orientation, elements_config } = req.body;
  const bg_image = req.file ? path.basename(req.file.path) : tpl.bg_image;
  const finalName = name && name.trim() ? name.trim() : tpl.name;
  const finalOrientation = orientation || tpl.orientation;
  
  let finalConfig = tpl.elements_config;
  if (typeof elements_config === 'string') {
    finalConfig = elements_config;
  } else if (typeof elements_config === 'object') {
    finalConfig = JSON.stringify(elements_config);
  }

  try {
    db.prepare(`
      UPDATE custom_templates 
      SET name = ?, bg_image = ?, orientation = ?, elements_config = ?
      WHERE id = ?
    `).run(finalName, bg_image, finalOrientation, finalConfig, id);

    const updated = getCustomTemplate(id);
    res.json({ success: true, template: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete custom template
app.delete('/admin/api/custom-templates/:id', needAuth, (req, res) => {
  const id = req.params.id;
  try {
    // Check if in use in courses or certificates
    const inCourses = db.prepare("SELECT COUNT(*) as c FROM courses WHERE template = ? OR template = ?").get(`custom:${id}`, `custom_${id}`).c;
    const inCerts = db.prepare("SELECT COUNT(*) as c FROM certificates WHERE template = ? OR template = ?").get(`custom:${id}`, `custom_${id}`).c;

    if (inCourses > 0 || inCerts > 0) {
      return res.status(400).json({
        error: `Ushbu shablon ${inCourses} ta kurs yoki ${inCerts} ta sertifikatda ishlatilmoqda. Uni o‘chirishdan oldin ularning shablonini o‘zgartiring.`
      });
    }

    db.prepare('DELETE FROM custom_templates WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Live test PDF generation from template designer
app.post('/admin/api/custom-templates/preview-pdf', needAuth, upload.single('bg_image'), async (req, res) => {
  try {
    let bgFilename = req.body.existing_bg || '';
    if (req.file) {
      bgFilename = path.basename(req.file.path);
    }
    const orientation = req.body.orientation || 'landscape';
    let elementsConfig = {};
    if (req.body.elements_config) {
      try {
        elementsConfig = typeof req.body.elements_config === 'string' 
          ? JSON.parse(req.body.elements_config) 
          : req.body.elements_config;
      } catch (_) {}
    }

    const mockCert = {
      uid: 'demo' + Date.now().toString(16),
      fio: req.body.sample_fio || 'ALISHER NAVOIY',
      pinfl: '31502900000012',
      cert_no: '000123',
      reg_no: '1001',
      score: 95.0,
      issue_date: new Date().toISOString().split('T')[0],
      title: req.body.sample_title || 'Zamonaviy axborot texnologiyalari kursi',
      series: 'MO',
      hours: 72,
      director: 'I.M. Azimov'
    };

    const customTpl = {
      name: 'Sinov shabloni',
      bg_image: bgFilename,
      orientation,
      parsedConfig: elementsConfig
    };

    const baseUrl = getSetting('base_url') || BASE_URL;
    const html = await renderCustomHtml(customTpl, mockCert, baseUrl);
    const isLandscape = orientation !== 'portrait';
    const pdfBuffer = await generatePdf(html, isLandscape);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="sinov_shablon.pdf"');
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Preview PDF error:', err);
    res.status(500).send('Sinov PDF xatosi: ' + err.message);
  }
});

// Certificates CRUD with pagination and search
app.get('/admin/api/certificates', needAuth, (req, res) => {
  const { q, course, page = 1, limit = 25 } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(100, Math.max(5, parseInt(limit, 10) || 25));
  const offset = (pageNum - 1) * pageSize;

  try {
    let whereClauses = ['1=1'];
    const params = [];

    if (q && q.trim()) {
      whereClauses.push('(c.fio LIKE ? OR c.pinfl LIKE ? OR c.cert_no LIKE ? OR c.passport LIKE ?)');
      const term = `%${q.trim()}%`;
      params.push(term, term, term, term);
    }

    if (course && course !== 'all') {
      whereClauses.push('c.course_id = ?');
      params.push(course);
    }

    const whereSql = whereClauses.join(' AND ');

    const countRow = db.prepare(`
      SELECT COUNT(*) as total 
      FROM certificates c 
      WHERE ${whereSql}
    `).get(params);

    const total = countRow ? countRow.total : 0;
    const totalPages = Math.ceil(total / pageSize) || 1;

    const items = db.prepare(`
      SELECT c.*, k.title as course_title, COALESCE(c.series, k.series) as series
      FROM certificates c
      JOIN courses k ON c.course_id = k.id
      WHERE ${whereSql}
      ORDER BY c.id DESC
      LIMIT ? OFFSET ?
    `).all([...params, pageSize, offset]);

    res.json({
      items,
      total,
      page: pageNum,
      totalPages,
      pageSize
    });
  } catch (err) {
    console.error('List certs error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/admin/api/certificates', needAuth, (req, res) => {
  const {
    course_id, fio, pinfl, passport, series, cert_no, reg_no,
    score, issue_date, template, status, note
  } = req.body;

  if (!course_id || !fio || !pinfl) {
    return res.status(400).json({ error: 'Kurs, F.I.Sh. va PINFL kiritilishi shart.' });
  }

  const cleanPinfl = String(pinfl).replace(/\D/g, '').trim();
  if (cleanPinfl.length !== 14) {
    return res.status(400).json({ error: 'PINFL aniq 14 ta raqam bo\'lishi shart.' });
  }

  try {
    const course = db.prepare('SELECT id, series FROM courses WHERE id = ?').get(course_id);
    const finalSeries = (series && String(series).trim()) 
      ? String(series).trim().toUpperCase() 
      : (course ? course.series : 'MO');

    const finalCertNo = (cert_no && String(cert_no).trim()) 
      ? String(cert_no).trim().padStart(6, '0') 
      : getNextCertNo(course_id);

    const finalRegNo = (reg_no && String(reg_no).trim())
      ? String(reg_no).trim()
      : getNextRegNo();

    const finalIssueDate = (issue_date && String(issue_date).trim())
      ? String(issue_date).trim()
      : new Date().toISOString().split('T')[0];

    const uid = generateUid();

    const result = db.prepare(`
      INSERT INTO certificates (
        uid, course_id, fio, pinfl, passport, series, cert_no, reg_no,
        score, issue_date, template, status, note, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uid,
      course_id,
      String(fio).trim().toUpperCase(),
      cleanPinfl,
      passport ? String(passport).trim().toUpperCase() : null,
      finalSeries,
      finalCertNo,
      finalRegNo,
      score != null && score !== '' ? parseFloat(score) : null,
      finalIssueDate,
      template || null,
      status || 'active',
      note || null,
      req.session.adminId
    );

    res.json({ success: true, id: result.lastInsertRowid, uid, cert_no: finalCertNo, reg_no: finalRegNo, series: finalSeries });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Ushbu kursda bu sertifikat raqami allaqachon mavjud.' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/admin/api/certificates/:id', needAuth, (req, res) => {
  const id = req.params.id;
  const {
    course_id, fio, pinfl, passport, series, cert_no, reg_no,
    score, issue_date, template, status, note
  } = req.body;

  const cleanPinfl = String(pinfl).replace(/\D/g, '').trim();
  if (cleanPinfl.length !== 14) {
    return res.status(400).json({ error: 'PINFL 14 ta raqam bo\'lishi shart.' });
  }

  try {
    db.prepare(`
      UPDATE certificates SET
        course_id = ?, fio = ?, pinfl = ?, passport = ?, series = ?, cert_no = ?, reg_no = ?,
        score = ?, issue_date = ?, template = ?, status = ?, note = ?
      WHERE id = ?
    `).run(
      course_id,
      String(fio).trim().toUpperCase(),
      cleanPinfl,
      passport ? String(passport).trim().toUpperCase() : null,
      series ? String(series).trim().toUpperCase() : null,
      String(cert_no).trim(),
      String(reg_no).trim(),
      score != null && score !== '' ? parseFloat(score) : null,
      issue_date,
      template || null,
      status || 'active',
      note || null,
      id
    );

    res.json({ success: true });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Bu sertifikat raqami kurs ichida band.' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.delete('/admin/api/certificates/:id', needAuth, (req, res) => {
  const id = req.params.id;
  try {
    db.prepare('DELETE FROM certificates WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin PDF preview by certificate ID (allows query ?tpl=... for testing other designs)
app.get('/admin/api/certificates/:id/pdf', needAuth, async (req, res) => {
  const { id } = req.params;
  const { tpl } = req.query;

  try {
    const cert = db.prepare(`
      SELECT c.*, k.title, k.org_line1, k.org_line2, COALESCE(c.series, k.series) as series, k.hours, 
             k.start_date, k.end_date, k.body_text, k.director, k.show_score, 
             k.accent, k.template as course_template
      FROM certificates c
      JOIN courses k ON c.course_id = k.id
      WHERE c.id = ?
    `).get(id);

    if (!cert) {
      return res.status(404).send('Sertifikat topilmadi');
    }

    const templateName = tpl || cert.template || cert.course_template || 'davlat';
    const baseUrl = getSetting('base_url') || BASE_URL;
    const html = await renderHtml(templateName, cert, baseUrl);

    const isLandscape = isTemplateLandscape(templateName);
    const pdfBuffer = await generatePdf(html, isLandscape);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="preview_${cert.series}_${cert.cert_no}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).send('PDF xatosi: ' + err.message);
  }
});

// Live preview HTML for iframe
app.post('/admin/api/preview', needAuth, async (req, res) => {
  try {
    const courseData = req.body;
    const templateName = courseData.template || 'davlat';

    const mockCert = {
      uid: 'demo12345678',
      fio: courseData.sample_fio || 'ALIMOV BEHZOD SHAVKATOVICH',
      pinfl: '31502900000012',
      cert_no: '000001',
      reg_no: '1001',
      score: courseData.sample_score != null ? courseData.sample_score : 92.5,
      issue_date: courseData.end_date || new Date().toISOString().split('T')[0],
      title: courseData.title || 'Namunaviy kurs nomi',
      org_line1: courseData.org_line1 || "O'ZBEKISTON RESPUBLIKASI VAZIRLIGI",
      org_line2: courseData.org_line2 || 'MALAKA OSHIRISH VA QAYTA TAYYORLASH MARKAZI',
      series: courseData.series || 'MO',
      hours: courseData.hours || 72,
      start_date: courseData.start_date || '2026-03-01',
      end_date: courseData.end_date || '2026-04-01',
      body_text: courseData.body_text || "{{START}}dan {{END}}gacha {{HOURS}} soatga mo'ljallangan «{{TITLE}}» kursi bo'yicha malakasini oshirdi.",
      director: courseData.director || 'I.M. Azimov',
      show_score: courseData.show_score ? 1 : 0,
      accent: courseData.accent || '#1a56db'
    };

    const baseUrl = getSetting('base_url') || BASE_URL;
    const html = await renderHtml(templateName, mockCert, baseUrl);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).send('Preview xatosi: ' + err.message);
  }
});

// Excel / CSV Bulk Import
app.post('/admin/api/import', needAuth, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Hech qanday fayl yuklanmadi.' });
  }

  const { course_id, issue_date: defaultDate } = req.body;
  if (!course_id) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Kurs tanlanishi shart.' });
  }

  try {
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    if (!rows || rows.length === 0) {
      return res.status(400).json({ error: 'Excel fayl bo\'sh yoki jadval topilmadi.' });
    }

    const errors = [];
    let successCount = 0;

    // Helper to find column case-insensitively
    function getColValue(row, possibleNames) {
      const keys = Object.keys(row);
      for (const name of possibleNames) {
        const found = keys.find(k => k.trim().toLowerCase() === name.toLowerCase());
        if (found && row[found] !== undefined && row[found] !== '') {
          return String(row[found]).trim();
        }
      }
      return '';
    }

    // Execute import in single transaction
    const courseInfo = db.prepare('SELECT id, series FROM courses WHERE id = ?').get(course_id);
    const courseSeries = courseInfo ? courseInfo.series : 'MO';

    const runImport = db.transaction(() => {
      let currentCertNo = null;
      let currentRegNo = null;

      rows.forEach((row, index) => {
        const rowNum = index + 2; // header is row 1
        const fio = getColValue(row, ['FIO', 'FISH', 'F.I.SH', 'F.I.Sh.', 'Ism', 'Foydalanuvchi']);
        const pinfl = getColValue(row, ['PINFL', 'JSHSHIR', 'JSHSHR', 'Pinfl', 'Jshshir']).replace(/\D/g, '');
        const passport = getColValue(row, ['Pasport', 'Passport', 'Pasport seriya', 'Hujjat']);
        let certNo = getColValue(row, ['Sertifikat raqami', 'Cert No', 'Raqam', 'Sertifikat']);
        let regNo = getColValue(row, ['Qayd raqami', 'Reg No', 'Qayd', 'Registratsiya']);
        const scoreStr = getColValue(row, ['Ball', 'Score', 'Bahosi', 'Natija']);
        const rowDate = getColValue(row, ['Sana', 'Date', 'Berilgan sana', 'Issue Date']);

        if (!fio) {
          errors.push({ row: rowNum, error: 'F.I.Sh. kiritilmagan' });
          return;
        }

        if (!pinfl || pinfl.length !== 14) {
          errors.push({ row: rowNum, error: `PINFL xato (14 ta raqam bo'lishi kerak): "${pinfl}"` });
          return;
        }

        // Determine cert_no
        if (!certNo) {
          if (!currentCertNo) {
            currentCertNo = getNextCertNo(course_id);
          } else {
            const nextVal = parseInt(currentCertNo, 10) + 1;
            currentCertNo = String(nextVal).padStart(6, '0');
          }
          certNo = currentCertNo;
        } else {
          certNo = certNo.padStart(6, '0');
        }

        // Determine reg_no
        if (!regNo) {
          if (!currentRegNo) {
            currentRegNo = parseInt(getNextRegNo(), 10);
          } else {
            currentRegNo++;
          }
          regNo = String(currentRegNo);
        }

        const finalDate = rowDate || defaultDate || new Date().toISOString().split('T')[0];
        const score = scoreStr ? parseFloat(scoreStr) : null;
        const uid = generateUid();

        try {
          db.prepare(`
            INSERT INTO certificates (
              uid, course_id, fio, pinfl, passport, series, cert_no, reg_no,
              score, issue_date, status, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
          `).run(
            uid,
            course_id,
            fio.toUpperCase(),
            pinfl,
            passport ? passport.toUpperCase() : null,
            courseSeries,
            certNo,
            regNo,
            isNaN(score) ? null : score,
            finalDate,
            req.session.adminId
          );
          successCount++;
        } catch (dbErr) {
          errors.push({ row: rowNum, error: dbErr.message.includes('UNIQUE') ? 'Sertifikat raqami takrorlandi' : dbErr.message });
        }
      });
    });

    runImport();

    res.json({
      total: rows.length,
      successCount,
      errorCount: errors.length,
      errors
    });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Import error:', err);
    res.status(500).json({ error: 'Importda xatolik: ' + err.message });
  }
});

// Settings update
app.post('/admin/api/settings', needAuth, (req, res) => {
  const { site_title, site_org, base_url } = req.body;
  if (site_title) setSetting('site_title', site_title.trim());
  if (site_org) setSetting('site_org', site_org.trim());
  if (base_url) setSetting('base_url', base_url.trim());

  res.json({ success: true });
});

// Logo upload
app.post('/admin/api/logo', needAuth, upload.single('logo'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Logo fayli tanlanmadi.' });
  }

  const allowedExts = ['.png', '.jpg', '.jpeg', '.svg'];
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!allowedExts.includes(ext)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Faqat PNG, JPG yoki SVG formatdagi fayllar qabul qilinadi.' });
  }

  const logoFilename = path.basename(req.file.path);
  setSetting('logo_path', logoFilename);

  res.json({ success: true, logo_url: `/uploads/${logoFilename}` });
});

// Password change
app.post('/admin/api/password', needAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Yangi parol kamida 6 ta belgidan iborat bo‘lishi kerak.' });
  }

  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.session.adminId);
  if (!admin) {
    return res.status(404).json({ error: 'Foydalanuvchi topilmadi.' });
  }

  // If must_change_password is true, oldPassword check can be optional if matched
  if (oldPassword && !bcrypt.compareSync(oldPassword, admin.password_hash)) {
    return res.status(400).json({ error: 'Eski parol noto‘g‘ri kiritildi.' });
  }

  const salt = bcrypt.genSaltSync(10);
  const newHash = bcrypt.hashSync(newPassword, salt);

  db.prepare(`
    UPDATE admins SET password_hash = ?, must_change_password = 0 WHERE id = ?
  `).run(newHash, admin.id);

  req.session.mustChangePassword = false;

  res.json({ success: true, message: 'Parol muvaffaqiyatli almashtirildi!' });
});

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('[SERVER ERROR] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[SERVER ERROR] Unhandled Rejection:', reason);
});

// Helper to discover local IPv4 addresses (Wi-Fi / LAN)
function getLocalNetworkIps() {
  const os = require('os');
  const nets = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        results.push({ name, address: net.address });
      }
    }
  }
  return results;
}

// Start server on 0.0.0.0 to allow LAN / Wi-Fi access
app.listen(PORT, '0.0.0.0', () => {
  const networkIps = getLocalNetworkIps();
  const wifiInterface = networkIps.find(i => /wi-fi|wireless|wlan/i.test(i.name)) || networkIps[0];
  const wifiUrl = wifiInterface ? `http://${wifiInterface.address}:${PORT}` : null;

  console.log(`\n============================================================`);
  console.log(` SER TIZIM — Sertifikat berish va tarqatish platformasi`);
  console.log(` Status: Server Wi-Fi va lokal tarmoqda muvaffaqiyatli ishga tushdi!`);
  console.log(`------------------------------------------------------------`);
  console.log(` 1. Shu kompyuterda ochish:`);
  console.log(`    - Asosiy sahifa: http://localhost:${PORT}`);
  console.log(`    - Admin panel:   http://localhost:${PORT}/admin`);
  console.log(`------------------------------------------------------------`);
  if (wifiUrl) {
    console.log(` 2. Boshqa qurilmalarda (Telefon, boshqa noutbuk, planshet):`);
    console.log(`    - Wi-Fi havola:  ${wifiUrl}`);
    console.log(`    - Admin panel:   ${wifiUrl}/admin`);
    console.log(`    - Tarmoq nomi:   ${wifiInterface.name} (${wifiInterface.address})`);
  }
  console.log(`============================================================\n`);
});
