import { dispatch } from './_lib/dispatch.js';
import publicForm from './_lib/op-intake-public.js';
import ai from './_lib/op-intake-ai.js';

// Form công khai cho thương hiệu: /api/intake, /api/intake?op=ai
export default dispatch({ public: publicForm, ai }, 'public');
