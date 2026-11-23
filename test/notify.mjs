import assert from 'node:assert/strict';
import http from 'node:http';

// Gửi email: Brevo (api-key, sender/to/htmlContent) và Resend (Bearer, from/to/html/text); tự nhận khóa Brevo "xkeysib-".
const got = [];
const srv = http.createServer((req, res) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => {
  got.push({ path: req.url, headers: req.headers, body: JSON.parse(d || '{}') });
  const brevoOk = req.url === '/brevo' && req.headers['api-key'] === 'xkeysib-test';
  const resendOk = req.url === '/resend' && req.headers.authorization === 'Bearer re_test';
  res.writeHead(brevoOk ? 201 : resendOk ? 200 : 401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(brevoOk ? { messageId: '<m1@brevo>' } : resendOk ? { id: 'r1' } : { message: 'Key not found' }));
}); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
Object.assign(process.env, { BREVO_API_URL: base + '/brevo', RESEND_API_URL: base + '/resend', MAIL_FROM: 'brand.ai.vn <no-reply@brand.ai.vn>', MAIL_REPLY_TO: 'sales@netspace.vn' });
delete process.env.BREVO_API_KEY; delete process.env.RESEND_API_KEY;
const { email, mailProvider, parseFrom, mailBody } = await import('../api/_lib/notify.js');
const body = mailBody('Xác nhận AI Health Check', ['Chào anh'], { href: 'https://brand.ai.vn/kiem-tra#v=abc', label: 'Bắt đầu' });
try {
  assert.deepEqual(parseFrom('brand.ai.vn <no-reply@brand.ai.vn>'), { name: 'brand.ai.vn', email: 'no-reply@brand.ai.vn' });
  assert.deepEqual(parseFrom('"NetSpace" <a@b.vn>'), { name: 'NetSpace', email: 'a@b.vn' });
  assert.deepEqual(parseFrom('a@b.vn'), { email: 'a@b.vn' });
  assert.equal(mailProvider(), null); assert.equal((await email({ to: 'k@x.vn', subject: 's', ...body })).sent, false);
  // Brevo qua BREVO_API_KEY
  process.env.BREVO_API_KEY = 'xkeysib-test';
  const r1 = await email({ to: 'khach@congty.vn', subject: 'Xác nhận', ...body });
  assert.equal(r1.sent, true); assert.equal(r1.provider, 'brevo');
  const b = got.at(-1); assert.equal(b.path, '/brevo'); assert.equal(b.headers['api-key'], 'xkeysib-test');
  assert.deepEqual(b.body.sender, { name: 'brand.ai.vn', email: 'no-reply@brand.ai.vn' }); assert.deepEqual(b.body.to, [{ email: 'khach@congty.vn' }]);
  assert.match(b.body.htmlContent, /kiem-tra#v=abc/); assert.equal(b.body.textContent, undefined, 'only one body type'); assert.deepEqual(b.body.replyTo, { email: 'sales@netspace.vn' });
  // Khóa Brevo lỡ đặt vào RESEND_API_KEY vẫn chạy qua Brevo
  delete process.env.BREVO_API_KEY; process.env.RESEND_API_KEY = 'xkeysib-test';
  assert.equal(mailProvider().name, 'brevo'); assert.equal((await email({ to: 'a@x.vn', subject: 's', ...body })).sent, true); assert.equal(got.at(-1).path, '/brevo');
  // Resend thật
  process.env.RESEND_API_KEY = 're_test';
  const r2 = await email({ to: ['a@x.vn', 'b@x.vn'], subject: 's', ...body }); assert.equal(r2.provider, 'resend'); assert.equal(r2.sent, true);
  assert.deepEqual(got.at(-1).body.to, ['a@x.vn', 'b@x.vn']); assert.equal(got.at(-1).body.reply_to, 'sales@netspace.vn');
  // Khóa sai: không ném lỗi, báo chưa gửi
  process.env.BREVO_API_KEY = 'xkeysib-sai'; const bad = await email({ to: 'a@x.vn', subject: 's', ...body }); assert.equal(bad.sent, false);
  console.log('Email: Brevo, Resend, key auto-detection and failure handling passed.');
} finally { srv.close(); }
