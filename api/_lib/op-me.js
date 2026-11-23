import { route, ok, allowMethods } from './util.js';
import { requireUser } from './auth.js';
import { MODELS, configured } from './providers.js';
import { dailyLimit, getUsage } from './usage.js';
import { envInt } from './util.js';
import { modelOptions, PRICING_DATE } from './model-options.js';
import { gatewayEnabled } from './gateway.js';

export default route(async (req, res) => {
  allowMethods(req, ['GET']);
  const user = await requireUser(req, res);
  const used = await getUsage(user.email).catch(() => null);
  ok(res, {
    email: user.email,
    isAdmin: user.isAdmin,
    role: user.role,
    name: user.name,
    mustChange: user.mustChange,
    used,
    limit: dailyLimit(),
    engines: configured(),
    judgeAvailable: Object.values(configured()).some(Boolean),
    models: MODELS(),
    modelOptions: modelOptions(MODELS()),
    gateway: gatewayEnabled(),
    pricingDate: PRICING_DATE,
    searchMaxUses: envInt('WEB_SEARCH_MAX_USES', 3),
  });
});
