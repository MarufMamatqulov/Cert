const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
require('dotenv').config();

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'sertifikat.db');

let db;

// Allow BigInt values to be cleanly serialized to JSON (prevent TypeError: Do not know how to serialize a BigInt)
if (typeof BigInt.prototype.toJSON !== 'function') {
  BigInt.prototype.toJSON = function() { return Number(this); };
}

function normalizeSqliteValue(val) {
  if (typeof val === 'bigint') return Number(val);
  return val;
}

function normalizeSqliteRow(row) {
  if (!row || typeof row !== 'object') return row;
  for (const k of Object.keys(row)) {
    if (typeof row[k] === 'bigint') {
      row[k] = Number(row[k]);
    }
  }
  return row;
}

// Try better-sqlite3 first; fallback to node:sqlite (native in Node.js 22+)
try {
  const BetterSqlite3 = require('better-sqlite3');
  db = new BetterSqlite3(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
} catch (e) {
  // Use node:sqlite DatabaseSync
  const { DatabaseSync } = require('node:sqlite');
  const rawDb = new DatabaseSync(dbPath);
  rawDb.exec('PRAGMA journal_mode = WAL;');
  rawDb.exec('PRAGMA foreign_keys = ON;');

  // Adapter for full compatibility
  db = {
    exec(sql) {
      return rawDb.exec(sql);
    },
    pragma(sql) {
      return rawDb.exec(`PRAGMA ${sql};`);
    },
    prepare(sql) {
      const stmt = rawDb.prepare(sql);
      return {
        run(...params) {
          const flatParams = (params.length === 1 && Array.isArray(params[0])) ? params[0] : params;
          const res = stmt.run(...flatParams);
          return {
            changes: typeof res.changes === 'bigint' ? Number(res.changes) : res.changes,
            lastInsertRowid: typeof res.lastInsertRowid === 'bigint' ? Number(res.lastInsertRowid) : res.lastInsertRowid
          };
        },
        get(...params) {
          const flatParams = (params.length === 1 && Array.isArray(params[0])) ? params[0] : params;
          const row = stmt.get(...flatParams);
          return normalizeSqliteRow(row);
        },
        all(...params) {
          const flatParams = (params.length === 1 && Array.isArray(params[0])) ? params[0] : params;
          const rows = stmt.all(...flatParams);
          if (!Array.isArray(rows)) return rows;
          return rows.map(normalizeSqliteRow);
        }
      };
    },
    transaction(fn) {
      return (...args) => {
        rawDb.exec('BEGIN TRANSACTION;');
        try {
          const result = fn(...args);
          rawDb.exec('COMMIT;');
          return result;
        } catch (err) {
          try { rawDb.exec('ROLLBACK;'); } catch (_) {}
          throw err;
        }
      };
    }
  };
}

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'superadmin',
      must_change_password INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      org_line1 TEXT NOT NULL,
      org_line2 TEXT NOT NULL,
      template TEXT NOT NULL DEFAULT 'davlat',
      series TEXT NOT NULL DEFAULT 'MO',
      hours INTEGER NOT NULL DEFAULT 72,
      start_date TEXT,
      end_date TEXT,
      body_text TEXT NOT NULL,
      director TEXT NOT NULL DEFAULT 'I.M. Azimov',
      show_score INTEGER NOT NULL DEFAULT 1,
      accent TEXT NOT NULL DEFAULT '#1a56db',
      active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS certificates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT UNIQUE NOT NULL,
      course_id INTEGER NOT NULL,
      fio TEXT NOT NULL,
      pinfl TEXT NOT NULL,
      passport TEXT,
      cert_no TEXT NOT NULL,
      reg_no TEXT NOT NULL,
      score REAL,
      issue_date TEXT NOT NULL,
      template TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      note TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES admins(id) ON DELETE SET NULL,
      UNIQUE(course_id, cert_no)
    );

    CREATE INDEX IF NOT EXISTS idx_certificates_pinfl ON certificates(pinfl);
    CREATE INDEX IF NOT EXISTS idx_certificates_uid ON certificates(uid);
    CREATE INDEX IF NOT EXISTS idx_certificates_course ON certificates(course_id);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      certificate_id INTEGER NOT NULL,
      ip TEXT,
      at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (certificate_id) REFERENCES certificates(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS custom_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      bg_image TEXT NOT NULL,
      orientation TEXT NOT NULL DEFAULT 'landscape',
      elements_config TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migrate certificates table to have series and verify_code columns if missing
  try {
    db.exec(`ALTER TABLE certificates ADD COLUMN series TEXT;`);
  } catch (_) {
    // Column already exists
  }

  try {
    db.exec(`ALTER TABLE certificates ADD COLUMN verify_code TEXT;`);
  } catch (_) {
    // Column already exists
  }

  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_certificates_verify_code ON certificates(verify_code);`);
  } catch (_) {}

  // Default settings
  const defaultSettings = [
    ['site_title', "Digital Education Development Center"],
    ['site_org', "Digital Education Development Center"],
    ['base_url', process.env.BASE_URL || 'http://localhost:3000'],
    ['logo_path', 'RTRM logo eng.png']
  ];

  for (const [k, v] of defaultSettings) {
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(k, v);
  }

  // Update legacy placeholder strings to brand name if present
  try {
    db.prepare(`
      UPDATE settings 
      SET value = 'Digital Education Development Center' 
      WHERE key IN ('site_title', 'site_org') 
        AND (value LIKE '%Kadrlar malakasini%' OR value LIKE '%Sertifikatlar Reyestri%')
    `).run();

    const logoSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('logo_path');
    if (!logoSetting || !logoSetting.value) {
      db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('RTRM logo eng.png', 'logo_path');
    }
  } catch (_) {}

  // Default admin creation
  const adminCount = db.prepare('SELECT COUNT(*) as count FROM admins').get().count;
  if (adminCount === 0) {
    const adminUser = process.env.ADMIN_USER || 'admin';
    const adminPass = process.env.ADMIN_PASS || 'admin123';
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(adminPass, salt);

    db.prepare(`
      INSERT INTO admins (username, password_hash, full_name, role, must_change_password, active)
      VALUES (?, ?, ?, 'superadmin', 1, 1)
    `).run(adminUser, hash, 'Bosh Administrator');

    console.warn('\n================================================================');
    console.warn(`[DIQQAT] Standart administrator hisobi yaratildi:`);
    console.warn(`Login: ${adminUser}`);
    console.warn(`Parol: ${adminPass}`);
    console.warn(`Xavfsizlik uchun tizimga kirganingizda parolni o'zgartiring!`);
    console.warn('================================================================\n');
  }

  // Seed sample course if none exists
  const courseCount = db.prepare('SELECT COUNT(*) as count FROM courses').get().count;
  if (courseCount === 0) {
    const res = db.prepare(`
      INSERT INTO courses (code, title, org_line1, org_line2, template, series, hours, start_date, end_date, body_text, director, show_score, accent, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      'mo',
      "Davlat tilida ish yuritish va malaka oshirish kursi",
      "O'ZBEKISTON RESPUBLIKASI OLIY TA'LIM, FAN VA INNOVATSIYALAR VAZIRLIGI",
      "DAVLAT TILIDA ISH YURITISH ASOSLARINI O'QITISH VA MALAKA OSHIRISH MARKAZI",
      'davlat',
      'MO',
      144,
      '2026-03-02',
      '2026-04-01',
      "{{START}}dan {{END}}gacha {{HOURS}} soatga mo'ljallangan «{{TITLE}}» bo'yicha malakasini oshirdi.",
      'I.M. Azimov',
      1,
      '#c02424'
    );

    const courseId = Number(res.lastInsertRowid);

    // Seed sample certificate
    const uid = crypto.randomBytes(6).toString('hex');
    db.prepare(`
      INSERT INTO certificates (uid, course_id, fio, pinfl, passport, cert_no, reg_no, score, issue_date, template, status, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uid,
      courseId,
      'KARIMOV SARDOR BAXTIYOROVICH',
      '31502900000012',
      'AA1234567',
      '000001',
      '3153',
      88.5,
      '2026-04-02',
      'davlat',
      'active',
      'Namunaviy sertifikat'
    );

    console.log('[SEED] Namunaviy kurs va sertifikat yaratildi (PINFL: 31502900000012)');
  }

  // Backfill verify_code for existing certificates if missing
  try {
    const missing = db.prepare("SELECT id FROM certificates WHERE verify_code IS NULL OR verify_code = ''").all();
    if (missing && missing.length > 0) {
      const updateStmt = db.prepare('UPDATE certificates SET verify_code = ? WHERE id = ?');
      for (const row of missing) {
        updateStmt.run(generateVerifyCode(), row.id);
      }
      console.log(`[DB] ${missing.length} ta sertifikatga 10 xonali tekshirish kodi berildi.`);
    }
  } catch (_) {}
}

function getNextCertNo(courseId) {
  let certNo;
  let exists = true;
  let attempts = 0;
  while (exists && attempts < 100) {
    // 6 xonali tasodifiy raqam (100000 - 999999)
    certNo = String(Math.floor(100000 + Math.random() * 900000));
    if (courseId) {
      const row = db.prepare('SELECT id FROM certificates WHERE course_id = ? AND cert_no = ?').get(courseId, certNo);
      if (!row) exists = false;
    } else {
      const row = db.prepare('SELECT id FROM certificates WHERE cert_no = ?').get(certNo);
      if (!row) exists = false;
    }
    attempts++;
  }
  return certNo || String(Math.floor(100000 + Math.random() * 900000));
}

function getNextRegNo() {
  const row = db.prepare(`
    SELECT reg_no FROM certificates 
    WHERE reg_no GLOB '[0-9]*'
    ORDER BY CAST(reg_no AS INTEGER) DESC LIMIT 1
  `).get();

  if (!row || !row.reg_no) {
    return '1001';
  }

  const num = parseInt(String(row.reg_no).replace(/\D/g, ''), 10);
  if (isNaN(num)) {
    return '1001';
  }

  return String(num + 1);
}

function generateUid() {
  return crypto.randomBytes(6).toString('hex'); // 12-char hex
}

function maskPinfl(pinfl) {
  if (!pinfl || String(pinfl).length < 8) return pinfl;
  const str = String(pinfl).trim();
  if (str.length === 14) {
    return str.substring(0, 4) + '******' + str.substring(10);
  }
  return str.substring(0, 2) + '****' + str.substring(str.length - 2);
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

function getCustomTemplate(id) {
  const row = db.prepare('SELECT * FROM custom_templates WHERE id = ?').get(id);
  if (!row) return null;
  try {
    row.parsedConfig = JSON.parse(row.elements_config);
  } catch (_) {
    row.parsedConfig = {};
  }
  return row;
}

function getAllCustomTemplates() {
  const rows = db.prepare('SELECT * FROM custom_templates ORDER BY id DESC').all();
  return rows.map(r => {
    try {
      r.parsedConfig = JSON.parse(r.elements_config);
    } catch (_) {
      r.parsedConfig = {};
    }
    return r;
  });
}
function generateVerifyCode() {
  while (true) {
    const code = Math.floor(1000000000 + Math.random() * 9000000000).toString();
    const existing = db.prepare('SELECT id FROM certificates WHERE verify_code = ?').get(code);
    if (!existing) {
      return code;
    }
  }
}

// Ensure database schema is initialized
initDb();

module.exports = {
  db,
  initDb,
  getNextCertNo,
  getNextRegNo,
  generateUid,
  generateVerifyCode,
  maskPinfl,
  getSetting,
  setSetting,
  getCustomTemplate,
  getAllCustomTemplates
};
