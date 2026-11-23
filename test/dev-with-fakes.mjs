// Chạy giao diện với Supabase/AI GIẢ LẬP – để xem thử mà không cần khóa thật.
//   npm run dev:fake   → http://localhost:3100   (staff@netspace.vn / Mat-khau-1)
import { startFakes, startFakeSite, startFakeWiki, startFakeNotify } from './fakes.js';
import { startServer } from '../scripts/dev.js';

const f = await startFakes();
const fakeSite = await startFakeSite(Number(process.env.FAKE_SITE_PORT) || 3199), fakeWiki = await startFakeWiki(), fakeNotify = await startFakeNotify();
Object.assign(process.env, {
  SUPABASE_URL: `http://127.0.0.1:${f.ports.supabase}`, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SECRET_KEY: 'sb_secret_test',
  ALLOWED_EMAIL_DOMAINS: 'netspace.vn', ANTHROPIC_API_KEY: 'test-anthropic', OPENAI_API_KEY: 'test-openai', GEMINI_API_KEY: 'test-gemini',
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${f.ports.anthropic}`, OPENAI_BASE_URL: `http://127.0.0.1:${f.ports.openai}`, GEMINI_BASE_URL: `http://127.0.0.1:${f.ports.gemini}`,
  COOKIE_INSECURE: '1', SCAN_ALLOW_PRIVATE: '1', WIKIDATA_API: `http://127.0.0.1:${fakeWiki.address().port}/w/api.php`, DAILY_CALL_LIMIT: process.env.DAILY_CALL_LIMIT || '2000',
});
// Email/Telegram giả (xem thư cuối: GET <notify>/last-email); không đặt khóa Turnstile nên trang công khai bỏ qua bước chống bot khi chạy thử.
const port = Number(process.env.PORT) || 3100;
Object.assign(process.env, { ...fakeNotify.env, SITE_URL: `http://localhost:${port}/site`, APP_URL: `http://localhost:${port}`, HC_DAILY_LIMIT: process.env.HC_DAILY_LIMIT || '50', ADMIN_EMAILS: process.env.ADMIN_EMAILS ?? 'staff@netspace.vn' });
delete process.env.TURNSTILE_SECRET_KEY; process.env.FAKE_NOTIFY = fakeNotify.base;
if (process.env.FAKE_NO_GEMINI) delete process.env.GEMINI_API_KEY;
const s = await startServer(port);
console.log(`Website giả để thử Quét: http://127.0.0.1:${fakeSite.address().port}/`);
console.log(`Email/Telegram giả: ${fakeNotify.base}/last-email`);
console.log(`Landing (brand.ai.vn): http://localhost:${port}/site/home.html · Health Check: http://localhost:${port}/site/kiem-tra.html`);
console.log(`Giao diện thử (dữ liệu giả lập): http://localhost:${s.address().port}\nĐăng nhập: staff@netspace.vn / Mat-khau-1`);
