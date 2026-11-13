import { httpJSON, HttpError } from './util.js';

const base = () => {
  const u = process.env.SUPABASE_URL;
  if (!u) throw new HttpError(500, 'not_configured', 'Thiếu biến môi trường SUPABASE_URL.');
  return u.replace(/\/$/, '');
};
const pubKey = () => {
  const k = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!k) throw new HttpError(500, 'not_configured', 'Thiếu SUPABASE_PUBLISHABLE_KEY.');
  return k;
};
const secKey = () => {
  const k = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new HttpError(500, 'not_configured', 'Thiếu SUPABASE_SECRET_KEY.');
  return k;
};
/** Khóa kiểu mới (sb_...) chỉ gửi ở header apikey; khóa JWT cũ (eyJ...) gửi cả hai. */
const keyHeaders = (k) => (k.startsWith('eyJ') ? { apikey: k, Authorization: `Bearer ${k}` } : { apikey: k });

export const authPassword = (email, password) =>
  httpJSON(`${base()}/auth/v1/token?grant_type=password`, {
    headers: { apikey: pubKey(), 'Content-Type': 'application/json' },
    body: { email, password },
    timeoutMs: 15000,
    retries: 0,
  });

export const authRefresh = (refresh_token) =>
  httpJSON(`${base()}/auth/v1/token?grant_type=refresh_token`, {
    headers: { apikey: pubKey(), 'Content-Type': 'application/json' },
    body: { refresh_token },
    timeoutMs: 15000,
    retries: 0,
  });

export async function authUser(accessToken) {
  const r = await httpJSON(`${base()}/auth/v1/user`, {
    method: 'GET',
    headers: { apikey: pubKey(), Authorization: `Bearer ${accessToken}` },
    timeoutMs: 15000,
    retries: 1,
  });
  return r.status === 200 && r.json && r.json.email ? r.json : null;
}

export const authLogout = (accessToken) =>
  httpJSON(`${base()}/auth/v1/logout`, {
    headers: { apikey: pubKey(), Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: {},
    timeoutMs: 8000,
    retries: 0,
  }).catch(() => null);

/** Gọi PostgREST bằng khóa bí mật (bỏ qua RLS) – chỉ chạy ở máy chủ. */
export const rest = (method, path, { body, prefer } = {}) =>
  httpJSON(`${base()}/rest/v1/${path}`, {
    method,
    headers: { ...keyHeaders(secKey()), 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body,
    timeoutMs: 15000,
    retries: 1,
  });

export const rpc = (name, args) => rest('POST', `rpc/${name}`, { body: args });
