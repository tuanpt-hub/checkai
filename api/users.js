import { dispatch } from './_lib/dispatch.js';
import { list, create, update, password, remove } from './_lib/op-users.js';

// Quản lý người dùng (chỉ quản trị viên): /api/users, ?op=create|update|password|remove
export default dispatch({ list, create, update, password, remove }, 'list');
