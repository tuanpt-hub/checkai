import { route, ok, allowMethods, assertCsrf, parseCookies } from './util.js';
import { authLogout } from './supabase.js';
import { clearSession } from './auth.js';

export default route(async (req, res) => {
  allowMethods(req, ['POST']);
  assertCsrf(req);
  const at = parseCookies(req).abr_at;
  if (at) await authLogout(at);
  clearSession(res);
  ok(res, { ok: true });
});
