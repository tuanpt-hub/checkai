import { route, ok, allowMethods, readJson, HttpError } from './_lib/util.js';
import { requireUser } from './_lib/auth.js';
import { bump } from './_lib/usage.js';

// Wikimedia yêu cầu User-Agent có thông tin liên hệ.
const UA = 'NetSpace-CheckAI/1.0 (https://checkai.netspace.vn)';
const base = () => (process.env.WIKIDATA_API || 'https://www.wikidata.org/w/api.php');
async function wd(params) {
  const u = new URL(base()); Object.entries({ format: 'json', ...params }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new HttpError(502, 'wikidata_error', `Wikidata trả mã ${r.status}.`);
  return r.json();
}
const host = u => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };

/** Kiểm tra thực thể trên Wikidata: có thực thể trỏ đúng website không, có bao nhiêu thực thể trùng tên. */
export default route(async (req, res) => {
  allowMethods(req, ['POST']);
  const user = await requireUser(req, res);
  const b = await readJson(req, 10_000);
  const names = [b.name, ...String(b.aliases || '').split(/[;,\n]/)].map(s => String(s || '').trim()).filter(s => s.length >= 2).slice(0, 3);
  if (!names.length) throw new HttpError(400, 'bad_request', 'Thiếu tên thương hiệu.');
  const site = host(b.website || '');
  await bump(user.email, 1);
  const ids = new Set();
  for (const n of names) for (const lang of ['vi', 'en']) {
    const r = await wd({ action: 'wbsearchentities', search: n, language: lang, uselang: lang, type: 'item', limit: '7' });
    (r.search || []).forEach(x => ids.add(x.id));
  }
  let entities = [];
  if (ids.size) {
    const r = await wd({ action: 'wbgetentities', ids: [...ids].slice(0, 30).join('|'), props: 'labels|descriptions|claims|sitelinks', languages: 'vi|en' });
    entities = Object.values(r.entities || {}).map(e => {
      const sites = ((e.claims && e.claims.P856) || []).map(c => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value).filter(Boolean);
      return { id: e.id, label: (e.labels && (e.labels.vi || e.labels.en) || {}).value || e.id, description: (e.descriptions && (e.descriptions.vi || e.descriptions.en) || {}).value || '',
        website: sites[0] || null, matched: !!(site && sites.some(s => host(s) === site || host(s).endsWith('.' + site))),
        wiki: { vi: e.sitelinks && e.sitelinks.viwiki ? e.sitelinks.viwiki.title : null, en: e.sitelinks && e.sitelinks.enwiki ? e.sitelinks.enwiki.title : null } };
    });
  }
  const m = entities.find(e => e.matched);
  ok(res, { at: new Date().toISOString(), query: names, website: site || null, entities: entities.slice(0, 15), matchedId: m ? m.id : null,
    wikipedia: m ? m.wiki : { vi: null, en: null } });
});
