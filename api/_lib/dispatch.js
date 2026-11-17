import { fail } from './util.js';

/** Gộp nhiều thao tác vào một hàm máy chủ (gói Hobby của Vercel giới hạn 12 hàm mỗi lần deploy).
 *  Chọn thao tác bằng ?op=…; không có op thì dùng thao tác mặc định. */
export function dispatch(ops, def) {
  return async (req, res) => {
    const op = String((req.query && req.query.op) || def);
    if (!Object.prototype.hasOwnProperty.call(ops, op)) return fail(res, 404, 'not_found', 'Không tìm thấy.');
    return ops[op](req, res);
  };
}
