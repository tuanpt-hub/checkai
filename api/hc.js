import { dispatch } from './_lib/dispatch.js';
import { config, lead, start, verify, scan, probe, finish, report, page, og } from './_lib/op-hc.js';

// AI Health Check tự phục vụ và biểu mẫu tư vấn trên brand.ai.vn (công khai, không cần đăng nhập).
export default dispatch({ config, lead, start, verify, scan, probe, finish, report, page, og }, 'config');
