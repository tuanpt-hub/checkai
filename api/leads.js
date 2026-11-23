import { dispatch } from './_lib/dispatch.js';
import { list, update, reportLink } from './_lib/op-leads.js';

// Khách tiềm năng (nội bộ, cần đăng nhập): /api/leads, /api/leads?op=update
export default dispatch({ list, update, report: reportLink }, 'list');
