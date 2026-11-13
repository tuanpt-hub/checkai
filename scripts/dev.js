// Máy chủ chạy thử cục bộ (không cần Vercel CLI): node scripts/dev.js
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnv(file = path.join(root, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

function collectRoutes(dir, prefix = '/api') {
  const out = [];
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    if (name.name.startsWith('_')) continue;
    const full = path.join(dir, name.name);
    if (name.isDirectory()) out.push(...collectRoutes(full, `${prefix}/${name.name}`));
    else if (name.name.endsWith('.js')) {
      const base = name.name.slice(0, -3);
      const urlPath = base === 'index' ? prefix : `${prefix}/${base}`;
      const keys = [];
      const pattern = urlPath.replace(/\[([^\]]+)\]/g, (_, k) => { keys.push(k); return '([^/]+)'; });
      out.push({ re: new RegExp(`^${pattern}$`), keys, file: full });
    }
  }
  return out;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

export async function startServer(port = Number(process.env.PORT) || 3000) {
  const routes = collectRoutes(path.join(root, 'api'));
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      for (const r of routes) {
        const m = url.pathname.match(r.re);
        if (!m) continue;
        req.query = Object.fromEntries(url.searchParams);
        r.keys.forEach((k, i) => (req.query[k] = decodeURIComponent(m[i + 1])));
        const mod = await import(pathToFileURL(r.file).href);
        return mod.default(req, res);
      }
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: { code: 'not_found' } }));
    }
    let file = path.join(root, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(path.join(root, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.statusCode = 404;
      return res.end('Not found');
    }
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(port, r));
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadEnv();
  if (!process.env.NODE_ENV) process.env.COOKIE_INSECURE = process.env.COOKIE_INSECURE || '1';
  const s = await startServer();
  console.log(`Chạy thử tại http://localhost:${s.address().port}`);
}
