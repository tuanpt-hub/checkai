import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
// Gói Hobby của Vercel: tối đa 12 hàm máy chủ mỗi lần deploy. Mọi khóa "functions" phải trỏ tới tệp có thật (nếu không, build lỗi).
const root = path.resolve(new URL('..', import.meta.url).pathname);
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name.startsWith('_') || e.name.startsWith('.') ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : /\.(js|mjs|cjs|ts)$/.test(e.name) ? [path.join(d, e.name)] : []));
const fns = walk(path.join(root, 'api')).map((f) => path.relative(root, f));
assert.ok(fns.length <= 12, `Có ${fns.length} hàm máy chủ (tối đa 12 trên gói Hobby): ${fns.join(', ')}`);
const v = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
for (const k of Object.keys(v.functions || {})) assert.ok(fs.existsSync(path.join(root, k)), `vercel.json functions trỏ tới tệp không tồn tại: ${k}`);
for (const r of v.rewrites || []) {
  const dest = new URL(r.destination, 'http://x').pathname;
  assert.ok(fns.some((f) => '/' + f.replace(/\.js$/, '').replace(/\/index$/, '') === dest), `rewrite ${r.source} trỏ tới hàm không tồn tại: ${dest}`);
  assert.ok(!fns.some((f) => '/' + f.replace(/\.js$/, '') === r.source), `rewrite ${r.source} bị che bởi một hàm cùng tên`);
}
console.log(`Vercel config: ${fns.length}/12 functions, every functions key and rewrite target exists passed.`);
