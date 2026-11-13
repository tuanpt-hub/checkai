import { route, ok, allowMethods, assertCsrf, parseCookies } from './_lib/util.js';
import { authLogout } from './_lib/supabase.js';
import { clearSession } from './_lib/auth.js';

export default route(async (req, res) => {
  allowMethods(req, ['POST']);
  assertCsrf(req);
  const at = parseCookies(req).abr_at;
  if (at) await authLogout(at);
  clearSession(res);
  ok(res, { ok: true });
});
