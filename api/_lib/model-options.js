import { gatewayEnabled } from './gateway.js';
import { HttpError } from './util.js';

// USD per million tokens / per thousand searches, checked against Gateway catalog.
export const PRICING_DATE = '2026-11-13';
export const MODEL_OPTIONS = {
  claude: [
    { id: 'anthropic/claude-haiku-5.5', name: 'Claude Haiku 5.5 · tiết kiệm', input: .1, output: .5, search: 10 },
    { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5', input: 2, output: 10, search: 10 },
  ],
  openai: [
    { id: 'openai/gpt-5-mini', name: 'GPT-5 Mini · tiết kiệm', input: .25, output: 2, search: 10 },
    { id: 'openai/gpt-5.4-mini', name: 'GPT-5.4 Mini', input: .75, output: 4.5, search: 10 },
    { id: 'openai/gpt-6-astra', name: 'GPT-6 Astra', input: 10, output: 50, search: 10 },
  ],
  gemini: [
    { id: 'google/gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite · tiết kiệm', input: .25, output: 1.5, search: 14 },
    { id: 'google/gemini-3.6-flash', name: 'Gemini 3.6 Flash', input: .75, output: 3.75, search: 14 },
  ],
};
export function modelOptions(defaults) {
  return Object.fromEntries(['claude', 'openai', 'gemini', 'judge'].map(role => {
    const engine = role === 'judge' ? 'claude' : role;
    const id = defaults[role];
    if (!gatewayEnabled()) return [role, [{ id, name: id, input: null, output: null, search: null }]];
    const options = MODEL_OPTIONS[engine].map(x => ({ ...x }));
    if (!options.some(x => x.id === id)) options.push({ id, name: id + ' · cấu hình máy chủ', input: null, output: null, search: null });
    return [role, options];
  }));
}
export function selectedModel(role, requested, defaults) {
  if (requested === undefined || requested === null || requested === '') return defaults[role];
  if (typeof requested !== 'string' || !modelOptions(defaults)[role]?.some(x => x.id === requested))
    throw new HttpError(400, 'bad_model', 'Model không nằm trong danh sách được phép cho AI này.');
  return requested;
}
