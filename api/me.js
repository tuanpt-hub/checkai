import { route, ok, allowMethods } from './_lib/util.js';
import { requireUser } from './_lib/auth.js';
import { MODELS, configured } from './_lib/providers.js';
import { dailyLimit, getUsage } from './_lib/usage.js';
import { envInt } from './_lib/util.js';

export default route(async (req, res) => {
  allowMethods(req, ['GET']);
  const user = await requireUser(req, res);
  const used = await getUsage(user.email).catch(() => null);
  ok(res, {
    email: user.email,
    used,
    limit: dailyLimit(),
    engines: configured(),
    models: MODELS(),
    searchMaxUses: envInt('WEB_SEARCH_MAX_USES', 3),
  });
});
