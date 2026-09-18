/**
 * Mathematical SVG Captcha Generator
 * Creates lightweight, secure SVG image of an arithmetic problem (e.g. 24 + 9 = ?)
 */

function generateMathCaptcha() {
  const isAddition = Math.random() > 0.4; // 60% addition, 40% subtraction
  let a, b, operator, answer;

  if (isAddition) {
    a = Math.floor(Math.random() * 40) + 10; // 10 to 49
    b = Math.floor(Math.random() * 20) + 2;  // 2 to 21
    operator = '+';
    answer = a + b;
  } else {
    a = Math.floor(Math.random() * 40) + 20; // 20 to 59
    b = Math.floor(Math.random() * 15) + 2;  // 2 to 16
    operator = '-';
    answer = a - b;
  }

  const text = `${a} ${operator} ${b} = ?`;

  // Generate background noise lines
  const lines = [];
  const colors = ['#3b82f6', '#1e3a8a', '#10b981', '#f59e0b', '#8b5cf6'];
  for (let i = 0; i < 4; i++) {
    const x1 = Math.floor(Math.random() * 140);
    const y1 = Math.floor(Math.random() * 44);
    const x2 = Math.floor(Math.random() * 140);
    const y2 = Math.floor(Math.random() * 44);
    const col = colors[i % colors.length];
    lines.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="1.2" opacity="0.25"/>`);
  }

  // Generate subtle noise dots
  const dots = [];
  for (let i = 0; i < 16; i++) {
    const cx = Math.floor(Math.random() * 150);
    const cy = Math.floor(Math.random() * 44);
    const r = Math.random() * 1.5 + 0.5;
    dots.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="#94a3b8" opacity="0.3"/>`);
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="145" height="46" viewBox="0 0 145 46" style="border-radius: 8px; background: #f1f5f9; border: 1.5px solid #cbd5e1; user-select: none;">
      <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#f8fafc"/>
          <stop offset="100%" stop-color="#e2e8f0"/>
        </linearGradient>
      </defs>
      <rect width="145" height="46" fill="url(#bgGrad)"/>
      ${lines.join('')}
      ${dots.join('')}
      <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="'Plus Jakarta Sans', Arial, sans-serif" font-size="20" font-weight="800" fill="#1e3a8a" letter-spacing="2">
        ${text}
      </text>
    </svg>
  `.trim();

  const base64 = Buffer.from(svg).toString('base64');
  const dataUrl = `data:image/svg+xml;base64,${base64}`;

  return {
    answer,
    svg,
    dataUrl
  };
}

module.exports = {
  generateMathCaptcha
};
