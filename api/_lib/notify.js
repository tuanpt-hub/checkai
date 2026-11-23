import { httpJSON } from './util.js';

/** Thông báo cho sales và email cho khách. Lỗi gửi chỉ ghi log, không làm hỏng yêu cầu của khách. */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const siteUrl = () => (process.env.SITE_URL || 'https://brand.ai.vn').replace(/\/$/, '');
export const appUrl = () => (process.env.APP_URL || 'https://app.brand.ai.vn').replace(/\/$/, '');
export const salesEmails = () => String(process.env.SALES_EMAILS || '').split(',').map((s) => s.trim()).filter(Boolean);

export async function telegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return { sent: false, reason: 'not_configured' };
  const base = (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, '');
  try {
    const r = await httpJSON(`${base}/bot${token}/sendMessage`, { body: { chat_id: chat, text: text.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true }, timeoutMs: 8000, retries: 1 });
    if (r.status !== 200) console.error('[notify] telegram', r.status, String(r.text || '').slice(0, 200));
    return { sent: r.status === 200 };
  } catch (e) { console.error('[notify] telegram', e && e.message); return { sent: false }; }
}

/** Nhà cung cấp email: Brevo (BREVO_API_KEY, hoặc khóa "xkeysib-…" lỡ đặt vào RESEND_API_KEY) hoặc Resend. */
export function mailProvider() {
  const brevo = process.env.BREVO_API_KEY || (/^xkeysib-/.test(process.env.RESEND_API_KEY || '') ? process.env.RESEND_API_KEY : '');
  if (brevo) return { name: 'brevo', key: brevo.trim() };
  if (process.env.RESEND_API_KEY) return { name: 'resend', key: process.env.RESEND_API_KEY.trim() };
  return null;
}
/** "brand.ai.vn <no-reply@brand.ai.vn>" → { name, email } */
export function parseFrom(s) {
  const m = String(s || '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { ...(m[1] ? { name: m[1] } : {}), email: m[2].trim() } : { email: String(s || '').trim() };
}

export async function email({ to, subject, html, text, replyTo }) {
  const p = mailProvider(), list = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!p || !list.length) return { sent: false, reason: 'not_configured' };
  const from = process.env.MAIL_FROM || 'brand.ai.vn <no-reply@brand.ai.vn>', reply = replyTo || process.env.MAIL_REPLY_TO;
  try {
    let r;
    if (p.name === 'brevo') {
      // Brevo chỉ nhận một kiểu nội dung mỗi lần gửi: dùng htmlContent.
      r = await httpJSON(process.env.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email', {
        headers: { 'api-key': p.key, accept: 'application/json', 'Content-Type': 'application/json' },
        body: { sender: parseFrom(from), to: list.map((e) => ({ email: e })), subject, htmlContent: html, ...(reply ? { replyTo: parseFrom(reply) } : {}) },
        timeoutMs: 10000, retries: 1,
      });
    } else {
      r = await httpJSON(process.env.RESEND_API_URL || 'https://api.resend.com/emails', {
        headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' },
        body: { from, to: list, subject, html, text, ...(reply ? { reply_to: reply } : {}) },
        timeoutMs: 10000, retries: 1,
      });
    }
    if (r.status >= 300) console.error('[notify]', p.name, r.status, String(r.text || '').slice(0, 300));
    return { sent: r.status < 300, provider: p.name };
  } catch (e) { console.error('[notify]', p.name, e && e.message); return { sent: false, provider: p.name }; }
}

/** Khung email đơn giản, chữ rõ, có bản text thuần. */
export function mailBody(title, paragraphs, cta) {
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0b1528;line-height:1.6">
<p style="font-size:20px;font-weight:bold;margin:0 0 12px">${esc(title)}</p>${paragraphs.map((p) => `<p style="margin:0 0 12px">${esc(p)}</p>`).join('')}
${cta ? `<p style="margin:20px 0"><a href="${esc(cta.href)}" style="background:#0A5CF5;color:#ffffff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:bold">${esc(cta.label)}</a></p><p style="font-size:12px;color:#5d6b85">Nếu nút không bấm được, chép đường dẫn: ${esc(cta.href)}</p>` : ''}
<p style="font-size:12px;color:#5d6b85;margin-top:24px">brand.ai.vn – dịch vụ AI Brand Readiness của Công ty Cổ phần Công nghệ &amp; Truyền thông Không Gian Số (NetSpace).</p></div>`;
  const text = [title, '', ...paragraphs, ...(cta ? ['', `${cta.label}: ${cta.href}`] : [])].join('\n');
  return { html, text };
}

/** Báo sales qua mọi kênh đã cấu hình (Telegram + email). */
export async function notifySales(title, lines, link) {
  const tg = `<b>${esc(title)}</b>\n${lines.filter(Boolean).map(esc).join('\n')}${link ? `\n<a href="${esc(link)}">Mở trong công cụ</a>` : ''}`;
  const body = mailBody(title, lines.filter(Boolean), link ? { href: link, label: 'Mở trong công cụ' } : null);
  const [t, m] = await Promise.all([telegram(tg), email({ to: salesEmails(), subject: title, ...body })]);
  return { telegram: t.sent, email: m.sent };
}
