import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const pool = html.slice(html.indexOf('async function pool('), html.indexOf('function selEngines('));
const run = html.slice(html.indexOf('async function runProbe('), html.indexOf('function engineStats('));
const calls = { Claude: 0, Gemini: 0 };
const context = {
  A: () => ({}), busy: null, stopFlag: false, flash: {},
  promptList: () => Array.from({length:41}, (_,i) => ({id:'B'+i,g:'B',q:'Test?'})),
  selEngines: () => ['Claude','Gemini'], runCfg: {reps:1,web:true},
  ENGMAP: {Claude:'Claude',Gemini:'Gemini'}, newCtl: () => undefined,
  render: () => {}, progress: () => {}, noteUsage: () => {},
  api: async (_, opts) => { const engine=opts.body.engine;calls[engine]++;
    throw {code:engine==='Claude'?'bad_request':'provider_error',message:'Test upstream failure'}; },
};
vm.createContext(context);
await vm.runInContext(pool+run+';runProbe(["B"])', context);
assert.ok(calls.Claude >= 1 && calls.Claude <= 3, 'stop scheduling after config failure, allowing in-flight requests');
assert.equal(calls.Gemini,41,'other engines continue');
assert.match(context.flash.probe,/Claude:/);assert.match(context.flash.probe,/Gemini:/);
console.log('Probe failures: stop broken model, continue other engines, label errors passed.');
