import { dispatch } from './_lib/dispatch.js';
import links from './_lib/op-intake-links.js';
import subs from './_lib/op-intake-submissions.js';

// Quản lý link và hàng chờ (đội NetSpace): /api/intake-links, /api/intake-links?op=subs
export default dispatch({ links, subs }, 'links');
