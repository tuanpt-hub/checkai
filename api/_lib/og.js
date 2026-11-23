import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Ảnh xem trước 1200×630 khi chia sẻ đường dẫn báo cáo (Zalo, Facebook, email). Chỉ hiện tên thương hiệu và tỷ lệ AI nhận ra. */
const file = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const FONTS = [file('../../node_modules/@expo-google-fonts/nunito/800ExtraBold/Nunito_800ExtraBold.ttf'), file('../../node_modules/@expo-google-fonts/nunito/400Regular/Nunito_400Regular.ttf')];
let symbol = null;
const symbolUri = () => (symbol ??= 'data:image/png;base64,' + fs.readFileSync(file('../../public/site/assets/symbol.png')).toString('base64'));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Ngắt tên thương hiệu tối đa 2 dòng theo độ rộng ước lượng. */
export function wrapBrand(name, width = 600) {
  const s = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const size = s.length <= 14 ? 84 : s.length <= 26 ? 66 : 54, per = Math.floor(width / (size * 0.56));
  const words = s.split(' '), lines = [''];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if (!cur) lines[lines.length - 1] = w.slice(0, per);
    else if ((cur + ' ' + w).length <= per) lines[lines.length - 1] = cur + ' ' + w;
    else if (lines.length < 2) lines.push(w.slice(0, per));
    else { lines[1] = (lines[1] + ' ' + w).slice(0, per - 1).replace(/\s+\S*$/, '') + '…'; break; }
  }
  return { size, lines };
}

export function ogSvg({ brand, rate } = {}) {
  const C = 2 * Math.PI * 120, has = brand && rate != null && Number.isFinite(rate);
  const pct = has ? Math.round(rate * 100) : null, ok = has && rate >= 0.75;
  const { size, lines } = wrapBrand(has ? brand : 'AI đang nói gì về thương hiệu của bạn?', has ? 600 : 1040);
  const title = lines.map((l, i) => `<text x="80" y="${250 + i * size * 1.1}" font-family="Nunito" font-weight="800" font-size="${size}" fill="#FFFFFF">${esc(l)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
<defs><radialGradient id="g" cx="80%" cy="30%" r="70%"><stop offset="0" stop-color="#0A5CF5" stop-opacity=".55"/><stop offset="1" stop-color="#030B1C" stop-opacity="0"/></radialGradient>
<linearGradient id="r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22D3EE"/><stop offset="1" stop-color="#0A5CF5"/></linearGradient></defs>
<rect width="1200" height="630" fill="#030B1C"/><rect width="1200" height="630" fill="url(#g)"/>
<path d="M0 560H1200" stroke="#22D3EE" stroke-opacity=".25"/>
<text x="80" y="130" font-family="Nunito" font-weight="800" font-size="26" letter-spacing="4" fill="#22D3EE">KẾT QUẢ AI HEALTH CHECK</text>
${title}
${has ? `<text x="80" y="${250 + lines.length * size * 1.1 + 24}" font-family="Nunito" font-size="32" fill="#93A8CF">Trên ChatGPT, Gemini, Claude, Grok, DeepSeek</text>` : `<text x="80" y="${250 + lines.length * size * 1.1 + 24}" font-family="Nunito" font-size="34" fill="#93A8CF">AI Health Check miễn phí · kết quả sau 2–3 phút</text>`}
${has ? `<circle cx="960" cy="290" r="120" fill="none" stroke="#132C5C" stroke-width="28"/>
<circle cx="960" cy="290" r="120" fill="none" stroke="${ok ? 'url(#r)' : '#FF5C7A'}" stroke-width="28" stroke-linecap="round" stroke-dasharray="${(C * Math.max(0.01, rate)).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 960 290)"/>
<text x="960" y="315" text-anchor="middle" font-family="Nunito" font-weight="800" font-size="76" fill="#FFFFFF">${pct}%</text>
<text x="960" y="460" text-anchor="middle" font-family="Nunito" font-size="28" fill="#C3D2EE">AI nhận ra đúng thương hiệu</text>` : ''}
<image x="80" y="582" width="40" height="32" href="${symbolUri()}" xlink:href="${symbolUri()}"/>
<text x="132" y="608" font-family="Nunito" font-weight="800" font-size="28" fill="#FFFFFF">brand.<tspan fill="#3D7BFF">ai</tspan>.vn</text>
<text x="1120" y="608" text-anchor="end" font-family="Nunito" font-size="24" fill="#93A8CF">AI Brand Readiness · NetSpace</text>
</svg>`;
}

export async function ogPng(data) {
  const { Resvg } = await import('@resvg/resvg-js');
  return new Resvg(ogSvg(data), { font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Nunito' }, fitTo: { mode: 'width', value: 1200 } }).render().asPng();
}
