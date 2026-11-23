import { dispatch } from './_lib/dispatch.js';
import me from './_lib/op-me.js';
import login from './_lib/op-login.js';
import logout from './_lib/op-logout.js';
import { setpw, password } from './_lib/op-password.js';

// Đăng nhập, đăng xuất và thông tin phiên: /api/me, /api/me?op=login, /api/me?op=logout
export default dispatch({ me, login, logout, setpw, password }, 'me');
