const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const QRCode = require('qrcode');
const { getSetting, getCustomTemplate } = require('./db');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

// Shared browser instance
let browserInstance = null;
let browserLaunching = null;

const MONTH_NAMES_UZ = [
  'yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
  'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'
];

/**
 * Format date string (YYYY-MM-DD or Date) into Uzbek format: "2026-yil 2-mart"
 */
function formatUzDate(dateInput) {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return String(dateInput);

  const year = d.getFullYear();
  const month = MONTH_NAMES_UZ[d.getMonth()];
  const day = d.getDate();

  return `${year}-yil ${day}-${month}`;
}

/**
 * Detects Chromium executable on the system
 */
function findChromiumExecutable() {
  const envPath = process.env.CHROMIUM_PATH;
  if (envPath && envPath !== 'auto' && fs.existsSync(envPath)) {
    return envPath;
  }

  const potentialPaths = [
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    // Linux
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ];

  for (const p of potentialPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

/**
 * Returns reusable Chromium browser instance
 */
async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }

  if (browserLaunching) {
    return browserLaunching;
  }

  browserLaunching = (async () => {
    const executablePath = findChromiumExecutable();
    if (!executablePath) {
      throw new Error(
        'Chromium topilmadi! Iltimos, .env faylida CHROMIUM_PATH parametrini sozlang (masalan, Google Chrome yoki Microsoft Edge yo\'li).'
      );
    }

    const browser = await chromium.launch({
      executablePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--font-render-hinting=medium'
      ]
    });

    browserInstance = browser;
    browserLaunching = null;
    return browser;
  })();

  return browserLaunching;
}

/**
 * Generate QR code data URL
 */
async function generateQrCode(text) {
  return await QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 200,
    color: {
      dark: '#111827',
      light: '#ffffff'
    }
  });
}

/**
 * Get logo or coat of arms base64 data
 */
function getLogoDataUrl() {
  const customLogoPath = getSetting('logo_path') || 'RTRM logo eng.png';
  if (customLogoPath) {
    let fullPath = path.join(UPLOADS_DIR, customLogoPath);
    if (!fs.existsSync(fullPath)) {
      fullPath = path.join(__dirname, '..', 'public', customLogoPath);
    }
    if (fs.existsSync(fullPath)) {
      const ext = path.extname(fullPath).toLowerCase().replace('.', '');
      const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      const base64 = fs.readFileSync(fullPath).toString('base64');
      return `data:${mime};base64,${base64}`;
    }
  }

  // Official State Emblem of Uzbekistan (Davlat Gerbi) SVG as high-res default
  const gerbSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="120" height="120">
    <defs>
      <radialGradient id="sunGrad" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#fff8d6"/>
        <stop offset="60%" stop-color="#f59e0b"/>
        <stop offset="100%" stop-color="#d97706"/>
      </radialGradient>
      <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#fbbf24"/>
        <stop offset="50%" stop-color="#d97706"/>
        <stop offset="100%" stop-color="#b45309"/>
      </linearGradient>
      <linearGradient id="ribbonBlue" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#0284c7"/>
        <stop offset="100%" stop-color="#0369a1"/>
      </linearGradient>
      <linearGradient id="ribbonGreen" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#16a34a"/>
        <stop offset="100%" stop-color="#15803d"/>
      </linearGradient>
    </defs>
    <!-- Circular Shield Background -->
    <circle cx="100" cy="95" r="76" fill="#e0f2fe" stroke="url(#goldGrad)" stroke-width="4"/>
    <!-- Rising Sun Rays -->
    <circle cx="100" cy="100" r="50" fill="url(#sunGrad)" opacity="0.6"/>
    <!-- Mountains & Rivers representation -->
    <path d="M40 120 Q70 85 100 115 Q130 85 160 120 L160 145 Q100 160 40 145 Z" fill="#bbf7d0" opacity="0.8"/>
    <!-- Blue rivers flowing down -->
    <path d="M85 120 Q100 135 95 152 M115 120 Q100 135 105 152" stroke="#0284c7" stroke-width="4" fill="none" stroke-linecap="round"/>
    <!-- Humo Bird (Simurgh) stylized silhouette spreading wings -->
    <g fill="url(#goldGrad)">
      <path d="M100 56 C95 62 95 68 100 74 C105 68 105 62 100 56 Z"/>
      <path d="M100 74 Q90 85 75 92 Q60 98 44 96 Q65 110 88 106 Q97 104 100 112 Q103 104 112 106 Q135 110 156 96 Q140 98 125 92 Q110 85 100 74 Z"/>
      <path d="M96 112 Q90 130 84 140 Q100 135 116 140 Q110 130 104 112 Z"/>
    </g>
    <!-- Left Wheat Garland & Right Cotton Garland Frame -->
    <path d="M30 110 C20 70 45 40 70 30 C60 45 50 70 54 110 Z" fill="#f59e0b" opacity="0.9"/>
    <path d="M170 110 C180 70 155 40 130 30 C140 45 150 70 146 110 Z" fill="#15803d" opacity="0.9"/>
    <circle cx="160" cy="70" r="6" fill="#ffffff" stroke="#15803d" stroke-width="2"/>
    <circle cx="155" cy="52" r="5" fill="#ffffff" stroke="#15803d" stroke-width="2"/>
    <circle cx="162" cy="90" r="6" fill="#ffffff" stroke="#15803d" stroke-width="2"/>
    <!-- Crescent and Star Octagram at Top -->
    <path d="M100 18 L104 24 L111 25 L106 30 L108 37 L100 33 L92 37 L94 30 L89 25 L96 24 Z" fill="#0284c7" stroke="url(#goldGrad)" stroke-width="1.5"/>
    <circle cx="98" cy="27" r="4" fill="#ffffff"/>
    <circle cx="100" cy="26.5" r="3.5" fill="#0284c7"/>
    <!-- Bottom Ribbon with O'ZBEKISTON text -->
    <path d="M45 150 Q100 162 155 150 L150 168 Q100 180 50 168 Z" fill="url(#ribbonBlue)"/>
    <path d="M48 162 Q100 174 152 162 L150 170 Q100 182 50 170 Z" fill="#ffffff"/>
    <path d="M50 168 Q100 180 150 168 L146 177 Q100 188 54 177 Z" fill="url(#ribbonGreen)"/>
    <text x="100" y="163" text-anchor="middle" font-family="'Times New Roman', serif" font-size="8.5" font-weight="bold" fill="#ffffff" letter-spacing="2">OʻZBEKISTON</text>
  </svg>`;

  const svgBase64 = Buffer.from(gerbSvg).toString('base64');
  return `data:image/svg+xml;base64,${svgBase64}`;
}

/**
 * Check if template is landscape orientation
 */
function isTemplateLandscape(templateName) {
  if (templateName === 'diplom') return true;
  let customId = null;
  if (typeof templateName === 'string' && (templateName.startsWith('custom:') || templateName.startsWith('custom_'))) {
    customId = parseInt(templateName.replace(/^custom[:_]/, ''), 10);
  } else if (!isNaN(parseInt(templateName, 10)) && !fs.existsSync(path.join(TEMPLATES_DIR, `${templateName}.html`))) {
    customId = parseInt(templateName, 10);
  }
  if (customId) {
    const customTpl = getCustomTemplate(customId);
    if (customTpl && customTpl.orientation === 'landscape') return true;
    if (customTpl && customTpl.orientation === 'portrait') return false;
  }
  return false;
}

/**
 * Render custom template HTML from uploaded image background and element coordinates
 */
async function renderCustomHtml(customTpl, certData, baseUrl) {
  const isLandscape = customTpl.orientation !== 'portrait';

  // Find background image
  let bgPath = path.join(UPLOADS_DIR, customTpl.bg_image);
  if (!fs.existsSync(bgPath)) {
    bgPath = path.join(__dirname, '..', 'public', customTpl.bg_image);
  }

  let bgDataUrl = '';
  if (fs.existsSync(bgPath)) {
    const ext = path.extname(bgPath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : (ext === '.svg' ? 'image/svg+xml' : 'image/jpeg');
    const base64 = fs.readFileSync(bgPath).toString('base64');
    bgDataUrl = `data:${mime};base64,${base64}`;
  }

  // QR Code
  const verifyUrl = `${baseUrl.replace(/\/+$/, '')}/t/${certData.uid || 'demo'}`;
  const qrDataUrl = await generateQrCode(verifyUrl);

  const formattedDate = formatUzDate(certData.issue_date || new Date());
  const formattedStart = formatUzDate(certData.start_date || new Date());
  const formattedEnd = formatUzDate(certData.end_date || new Date());

  // Parse body text
  let bodyText = certData.body_text || "{{START}}dan {{END}}gacha {{HOURS}} soatga mo'ljallangan «{{TITLE}}» kursi bo'yicha malakasini oshirdi.";
  bodyText = bodyText
    .replace(/\{\{FIO\}\}/g, certData.fio || '')
    .replace(/\{\{HOURS\}\}/g, String(certData.hours || ''))
    .replace(/\{\{START\}\}/g, formattedStart)
    .replace(/\{\{END\}\}/g, formattedEnd)
    .replace(/\{\{TITLE\}\}/g, certData.title || '')
    .replace(/\{\{SCORE\}\}/g, certData.score != null ? String(certData.score) : '');

  const cfg = customTpl.parsedConfig || {};

  function getStyle(itemCfg) {
    if (!itemCfg) return 'display: none;';
    const align = itemCfg.textAlign || 'center';
    let transform = 'translate(-50%, -50%)';
    if (align === 'left') transform = 'translate(0, -50%)';
    if (align === 'right') transform = 'translate(-100%, -50%)';

    return `
      position: absolute;
      left: ${itemCfg.x}%;
      top: ${itemCfg.y}%;
      transform: ${transform};
      font-family: '${itemCfg.fontFamily || 'Plus Jakarta Sans'}', sans-serif, serif;
      font-size: ${itemCfg.fontSize || 20}px;
      font-weight: ${itemCfg.fontWeight || 'bold'};
      color: ${itemCfg.color || '#0f172a'};
      text-align: ${align};
      ${itemCfg.width ? `width: ${itemCfg.width}%;` : ''}
      ${itemCfg.letterSpacing ? `letter-spacing: ${itemCfg.letterSpacing}px;` : ''}
      ${itemCfg.lineHeight ? `line-height: ${itemCfg.lineHeight};` : ''}
      ${itemCfg.textTransform ? `text-transform: ${itemCfg.textTransform};` : ''}
      z-index: 10;
      display: ${itemCfg.visible !== false ? 'block' : 'none'};
    `;
  }

  function getQrStyle(qrCfg) {
    if (!qrCfg) return 'display: none;';
    const size = qrCfg.size || 100;
    return `
      position: absolute;
      left: ${qrCfg.x}%;
      top: ${qrCfg.y}%;
      transform: translate(-50%, -50%);
      width: ${size}px;
      height: ${size}px;
      z-index: 10;
      display: ${qrCfg.visible !== false ? 'block' : 'none'};
      ${qrCfg.bg ? `background: ${qrCfg.bg}; padding: 4px; border-radius: 6px;` : ''}
    `;
  }

  const certNoText = `${certData.series || 'MO'} № ${certData.cert_no || '000001'}`;
  const regNoPrefix = (cfg.regNo && cfg.regNo.prefix !== undefined) ? cfg.regNo.prefix : '№ ';
  const regNoText = certData.reg_no ? `${regNoPrefix}${certData.reg_no}` : '';
  const hoursText = certData.hours ? `${certData.hours} soat` : '';

  return `
<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8">
  <title>Sertifikat — ${certData.series || ''} ${certData.cert_no || ''}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Great+Vibes&family=Merriweather:ital,wght@0,400;0,700;1,400&family=Montserrat:wght@400;500;600;700;800&family=Playfair+Display:ital,wght@0,600;0,700;0,800;1,600&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    @page {
      size: ${isLandscape ? 'A4 landscape' : 'A4 portrait'};
      margin: 0;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: ${isLandscape ? '297mm' : '210mm'};
      height: ${isLandscape ? '210mm' : '297mm'};
      margin: 0;
      padding: 0;
      overflow: hidden;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .cert-canvas {
      position: relative;
      width: ${isLandscape ? '297mm' : '210mm'};
      height: ${isLandscape ? '210mm' : '297mm'};
      background-image: url('${bgDataUrl}');
      background-size: 100% 100%;
      background-position: center;
      background-repeat: no-repeat;
      overflow: hidden;
    }
  </style>
</head>
<body>
  <div class="cert-canvas">
    ${(cfg.orgLine1 && cfg.orgLine1.visible !== false && certData.org_line1) ? `<div style="${getStyle(cfg.orgLine1)}">${(certData.org_line1 || '').toUpperCase()}</div>` : ''}
    ${(cfg.orgLine2 && cfg.orgLine2.visible !== false && certData.org_line2) ? `<div style="${getStyle(cfg.orgLine2)}">${certData.org_line2 || ''}</div>` : ''}
    ${(cfg.fio && cfg.fio.visible !== false) ? `<div style="${getStyle(cfg.fio)}">${certData.fio || ''}</div>` : ''}
    ${(cfg.courseTitle && cfg.courseTitle.visible !== false && certData.title) ? `<div style="${getStyle(cfg.courseTitle)}">${certData.title || ''}</div>` : ''}
    ${(cfg.bodyText && cfg.bodyText.visible !== false) ? `<div style="${getStyle(cfg.bodyText)}">${bodyText}</div>` : ''}
    ${(cfg.certNo && cfg.certNo.visible !== false) ? `<div style="${getStyle(cfg.certNo)}">${certNoText}</div>` : ''}
    ${(cfg.issueDate && cfg.issueDate.visible !== false) ? `<div style="${getStyle(cfg.issueDate)}">${formattedDate}</div>` : ''}
    ${(cfg.regNo && cfg.regNo.visible !== false && certData.reg_no) ? `<div style="${getStyle(cfg.regNo)}">${regNoText}</div>` : ''}
    ${(cfg.hoursPeriod && cfg.hoursPeriod.visible !== false && hoursText) ? `<div style="${getStyle(cfg.hoursPeriod)}">${hoursText}</div>` : ''}
    ${(cfg.score && cfg.score.visible !== false && certData.score != null && certData.score !== '') ? `<div style="${getStyle(cfg.score)}">${certData.score} ball</div>` : ''}
    ${(cfg.director && cfg.director.visible !== false && certData.director) ? `<div style="${getStyle(cfg.director)}">${certData.director || ''}</div>` : ''}
    ${(cfg.qr && cfg.qr.visible !== false) ? `<div style="${getQrStyle(cfg.qr)}"><img src="${qrDataUrl}" style="width: 100%; height: 100%; display: block;" alt="QR Code" /></div>` : ''}
  </div>
</body>
</html>
  `;
}

/**
 * Render HTML string by populating template placeholders
 */
async function renderHtml(templateName, certData, baseUrl) {
  // Check if template is custom
  let customId = null;
  if (typeof templateName === 'string' && (templateName.startsWith('custom:') || templateName.startsWith('custom_'))) {
    customId = parseInt(templateName.replace(/^custom[:_]/, ''), 10);
  } else if (!isNaN(parseInt(templateName, 10)) && !fs.existsSync(path.join(TEMPLATES_DIR, `${templateName}.html`))) {
    customId = parseInt(templateName, 10);
  }

  if (customId) {
    const customTpl = getCustomTemplate(customId);
    if (!customTpl) {
      throw new Error(`Maxsus shablon topilmadi (ID: ${customId})`);
    }
    return await renderCustomHtml(customTpl, certData, baseUrl);
  }

  const tplFile = path.join(TEMPLATES_DIR, `${templateName}.html`);
  if (!fs.existsSync(tplFile)) {
    throw new Error(`Shablon topilmadi: ${templateName}`);
  }

  let html = fs.readFileSync(tplFile, 'utf8');

  // Verify URL for QR Code and public verification page
  const verifyUrl = `${baseUrl.replace(/\/+$/, '')}/t/${certData.uid}`;
  const qrDataUrl = await generateQrCode(verifyUrl);
  const logoDataUrl = getLogoDataUrl();

  // Format dates
  const formattedDate = formatUzDate(certData.issue_date);
  const formattedStart = formatUzDate(certData.start_date);
  const formattedEnd = formatUzDate(certData.end_date);

  // Parse body text template
  let bodyText = certData.body_text || "{{START}}dan {{END}}gacha {{HOURS}} soatga mo'ljallangan «{{TITLE}}» kursi bo'yicha malakasini oshirdi.";
  bodyText = bodyText
    .replace(/\{\{FIO\}\}/g, certData.fio || '')
    .replace(/\{\{HOURS\}\}/g, String(certData.hours || ''))
    .replace(/\{\{START\}\}/g, formattedStart)
    .replace(/\{\{END\}\}/g, formattedEnd)
    .replace(/\{\{TITLE\}\}/g, certData.title || '')
    .replace(/\{\{SCORE\}\}/g, certData.score != null ? String(certData.score) : '');

  // Score block
  let scoreBlock = '';
  if (certData.show_score && certData.score != null && certData.score !== '') {
    scoreBlock = `<div class="cert-score">Attestatsiya komissiyasi xulosasiga koʻra <strong>${certData.score} ball</strong> bilan baholandi.</div>`;
  }

  // Logo block HTML
  const logoBlock = `<div class="cert-logo"><img src="${logoDataUrl}" alt="Gerb/Logo" /></div>`;

  const accentColor = certData.accent || '#1a56db';

  // Replacements dictionary
  const replacements = {
    '{{ORG1}}': (certData.org_line1 || '').toUpperCase(),
    '{{ORG2}}': certData.org_line2 || '',
    '{{TITLE}}': certData.title || '',
    '{{SERIES}}': certData.series || 'MO',
    '{{CERT_NO}}': certData.cert_no || '000001',
    '{{FIO}}': (certData.fio || '').toUpperCase(),
    '{{BODY}}': bodyText,
    '{{SCORE_BLOCK}}': scoreBlock,
    '{{DIRECTOR}}': certData.director || 'I.M. Azimov',
    '{{REG_NO}}': certData.reg_no || '1001',
    '{{DATE}}': formattedDate,
    '{{QR}}': qrDataUrl,
    '{{LOGO_BLOCK}}': logoBlock,
    '{{ACCENT}}': accentColor,
    '{{UID}}': certData.uid || '',
    '{{VERIFY_URL}}': verifyUrl
  };

  for (const [placeholder, val] of Object.entries(replacements)) {
    html = html.split(placeholder).join(val || '');
  }

  return html;
}

/**
 * Generate PDF buffer from HTML string
 */
async function generatePdf(html, isLandscape = false) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(html, {
      waitUntil: 'load',
      timeout: 30000
    });

    // Wait for images and fonts to be ready
    await page.evaluate(async () => {
      if (document.fonts) {
        await document.fonts.ready;
      }
    });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      landscape: isLandscape,
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: '0mm',
        right: '0mm',
        bottom: '0mm',
        left: '0mm'
      }
    });

    return pdfBuffer;
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = {
  renderHtml,
  renderCustomHtml,
  isTemplateLandscape,
  generatePdf,
  generateQrCode,
  formatUzDate,
  findChromiumExecutable
};
