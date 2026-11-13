# checkai.netspace.vn – AI Brand Readiness Audit (bản nội bộ)

Công cụ audit 6 lớp của NetSpace, chạy trên **Vercel**, **bắt buộc đăng nhập**, tự động hỏi **Claude, ChatGPT, Gemini** và dùng Claude chấm điểm câu trả lời. Dữ liệu audit lưu trên **Supabase**.

```
Trình duyệt ──(cookie HttpOnly)──► Vercel (api/*.js) ──► Anthropic / OpenAI / Google
                                        │
                                        └──► Supabase (đăng nhập, bảng audits, bảng usage)
```

Key Gateway, khóa API và khóa bí mật Supabase **chỉ nằm ở biến môi trường của Vercel**, không bao giờ xuống trình duyệt. Gọi AI qua **Vercel AI Gateway** bằng một key `AI_GATEWAY_API_KEY`. Dùng Node.js 22 trở lên. Chạy `npm ci` để cài AI SDK và các định nghĩa công cụ tìm kiếm web.

---

## 1. Thiết lập Supabase (≈10 phút)

1. Tạo project tại supabase.com (hoặc dùng project có sẵn).
2. **SQL Editor** → dán toàn bộ `supabase/schema.sql` → Run. Tạo bảng `audits`, `usage` và hàm đếm hạn mức. Cả hai bảng bật RLS và không có policy: chỉ máy chủ Vercel truy cập được.
3. **Authentication → Sign In / Providers → Email**: **tắt “Allow new users to sign up”**. Đây là chốt chặn quan trọng nhất: người ngoài không thể tự tạo tài khoản.
4. **Authentication → Users → Add user (hoặc Invite)**: tạo tài khoản cho từng người trong đội (email `@netspace.vn`, đặt mật khẩu mạnh, chọn *Auto Confirm*).
5. **Project Settings → API Keys**, lấy 3 giá trị: `Project URL`, **Publishable key** (`sb_publishable_...`) và **Secret key** (`sb_secret_...`). Dự án cũ chỉ có khóa kiểu cũ thì dùng `anon` và `service_role`; mã hỗ trợ cả hai.

## 2. Cấu hình Vercel AI Gateway

Tạo key tại Vercel → AI Gateway → API Keys, rồi thêm biến **`AI_GATEWAY_API_KEY`** vào môi trường Production của project và Redeploy. Chỉ cần key Gateway; không cần ba key nhà cung cấp riêng. Tài khoản Gateway cần có credit và quyền truy cập model.

Khi biến này có giá trị, toàn bộ câu hỏi, chấm điểm, phân tích và viết báo cáo đều đi qua Gateway. Nếu đồng thời còn key cũ, ứng dụng vẫn ưu tiên Gateway; lỗi Gateway không tự chuyển sang key cũ.

| Biến tùy chọn | Mặc định |
|---|---|
| `AI_GATEWAY_CLAUDE_MODEL` | `anthropic/claude-sonnet-5.5` |
| `AI_GATEWAY_JUDGE_MODEL` | `anthropic/claude-sonnet-5.5` |
| `AI_GATEWAY_OPENAI_MODEL` | `openai/gpt-6-astra` |
| `AI_GATEWAY_GEMINI_MODEL` | `google/gemini-3.6-flash` |

Tên model phải có tiền tố hãng và khớp danh sách AI Gateway. Các biến `ANTHROPIC_*_MODEL`, `OPENAI_MODEL`, `GEMINI_MODEL` cũ chỉ áp dụng khi không có key Gateway. Tìm kiếm web vẫn dùng native tools của Anthropic, OpenAI và Google; không thay bằng một công cụ tìm kiếm chung.

Nếu không cấu hình `AI_GATEWAY_API_KEY`, ứng dụng tiếp tục hỗ trợ ba key riêng `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` như trước. Đặt hạn mức chi tiêu ở Gateway hoặc nhà cung cấp đang sử dụng.

Tài liệu: [Gateway web search](https://vercel.com/docs/ai-gateway/models-and-providers/web-search), [AI SDK Gateway](https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway).

## 3. Triển khai lên Vercel

1. Đưa thư mục này lên một repo GitHub riêng tư rồi **Add New → Project → Import** trên Vercel. Framework preset: **Other** (đã cấu hình sẵn trong `vercel.json`: thư mục xuất bản `public`, hàm AI chạy tối đa 120 giây). Hoặc dùng CLI: `npx vercel --prod`.
2. **Settings → Environment Variables** (Production), nhập các biến dưới đây. Có thể sao từ `.env.example`.

| Biến | Giá trị |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_PUBLISHABLE_KEY` | khóa công khai |
| `SUPABASE_SECRET_KEY` | khóa bí mật (đánh dấu **Sensitive**) |
| `ALLOWED_EMAIL_DOMAINS` | `netspace.vn` |
| `ALLOWED_EMAILS` | (tuỳ chọn) email lẻ ngoài domain, cách nhau dấu phẩy |
| `AI_GATEWAY_API_KEY` | Key Vercel AI Gateway (đánh dấu **Sensitive**); kích hoạt cả ba AI |
| `DAILY_CALL_LIMIT` | mặc định 1500 lượt gọi AI/người/ngày (giờ Việt Nam) |

   Biến chọn model (mặc định đã đặt theo tài liệu hãng tại 13/11/2026, đổi được mà không cần sửa mã): `ANTHROPIC_PROBE_MODEL`, `ANTHROPIC_JUDGE_MODEL`, `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT`, `GEMINI_MODEL`.
3. **Redeploy** sau khi đổi biến môi trường.
4. Lưu ý gói: Vercel quy định gói **Hobby** dành cho dự án cá nhân, phi thương mại. Công cụ dùng nội bộ doanh nghiệp nên dùng gói **Pro**; xem điều khoản hiện hành của Vercel.

## 4. Gắn tên miền checkai.netspace.vn

1. Vercel → project → **Settings → Domains → Add** → nhập `checkai.netspace.vn`.
2. Vercel hiển thị bản ghi DNS cần tạo. Với tên miền con thường là **CNAME**: tên `checkai`, giá trị là đích Vercel cung cấp. Tạo bản ghi đó ở nơi quản lý DNS của `netspace.vn`.
3. Chờ trạng thái **Valid Configuration**; Vercel tự cấp HTTPS. Mở `https://checkai.netspace.vn` → màn hình đăng nhập.

## 5. Kiểm tra lần đầu (bắt buộc làm)

Mã được kiểm thử với máy chủ giả lập, **chưa gọi thử API thật** của ba hãng. Sau khi triển khai:

1. Đăng nhập → **Nạp audit mẫu NetSpace**.
2. Bước **Hỏi AI**: chạy **Nhóm B** (6 câu × 3 AI = 18 lượt). Thông báo lỗi (nếu có) hiện ngay dưới các nút, ví dụ:
   - `khóa API không hợp lệ` → sai biến `*_API_KEY`.
   - `không tìm thấy model` → đổi `OPENAI_MODEL` / `GEMINI_MODEL` / `ANTHROPIC_*_MODEL` theo danh sách model hiện hành của hãng.
   - `yêu cầu bị từ chối` kèm “web search” → chưa bật Web search ở Claude Console, hoặc model không hỗ trợ công cụ tìm kiếm.
3. Mở một ô kết quả: phải thấy câu trả lời, truy vấn tìm kiếm và danh sách nguồn.

## 6. Cách dùng hằng ngày

- **Một audit = một thương hiệu.** Mọi người trong đội đều thấy và sửa được mọi audit. Nếu hai người sửa cùng lúc, người lưu sau nhận cảnh báo xung đột và chọn *Tải bản mới* hoặc *Ghi đè*.
- **Hỏi AI**: chọn AI, bật/tắt tìm kiếm web, số lần lặp (1–3). Khi lặp, mã kết quả là mã xuất hiện nhiều nhất; hòa thì lấy mã thấp hơn. Nút ghi rõ số lượt sẽ gọi.
- Perplexity và Copilot vẫn làm tay: dán câu trả lời ở ô **Dán câu trả lời từ AI khác**.
- **Xuất báo cáo** (.md) và **dữ liệu audit** (.json) ở bước *Kết quả*. Nút **Nhập** nạp lại file .json.

### Chọn model và dự toán trước khi chạy

Ở bước **Hỏi AI**, chọn riêng model Claude, OpenAI, Gemini và Claude dùng để chấm/viết nội dung. Lựa chọn được lưu theo audit; model mặc định vẫn lấy từ biến môi trường. Chỉ Gateway hỗ trợ đổi model trong giao diện; chế độ key trực tiếp giữ cấu hình máy chủ. Máy chủ kiểm tra model theo danh sách của từng hãng trước khi cộng hạn mức hoặc gọi AI.

Bảng dự toán và nút chạy hiển thị khoảng chi phí USD cho từng nhóm hoặc toàn bộ câu hỏi, cập nhật theo model, AI được chọn, số lần lặp và tìm kiếm web. Dự toán gồm hỏi + chấm Claude theo nhóm/lô tối đa 8 câu, dùng giá tham khảo trong `api/_lib/model-options.js` (ngày kiểm tra hiển thị trên giao diện). Đây không phải giá trực tiếp hay trần chi tiêu: số token, suy luận, truy vấn tìm kiếm, retry, cache và phụ phí thực tế có thể làm chi phí nằm ngoài khoảng. Model tùy chỉnh chưa có giá sẽ hiện “Chưa đủ giá để ước tính”, không tính bằng 0.

Kết quả lưu tên model thực tế và model giám khảo nếu chấm thành công; đổi lựa chọn chỉ áp dụng cho các yêu cầu tiếp theo. Cần cập nhật bảng giá khi nhà cung cấp thay đổi giá. Ước tính áp dụng cho lần bấm Hỏi AI; các thao tác viết/phân tích riêng không nằm trong dự toán này.

## 7. Bảo mật

- Mọi API (`/api/*`) đòi cookie phiên hợp lệ; chưa đăng nhập thì **không gọi được AI** (đã kiểm thử).
- Cookie `HttpOnly; Secure; SameSite=Strict`; yêu cầu ghi phải có header riêng và đúng Origin (chống CSRF).
- **Allowlist đóng mặc định**: nếu `ALLOWED_EMAIL_DOMAINS` và `ALLOWED_EMAILS` đều trống thì không ai vào được. Người có tài khoản Supabase nhưng ngoài allowlist vẫn bị từ chối.
- Hạn mức theo người/ngày ở máy chủ; lỗi cơ sở dữ liệu thì **từ chối** (bảo vệ chi phí).
- Tiêu đề bảo mật và CSP chặn tải mã từ nguồn ngoài; trang đặt `noindex`.
- **Khi có người nghỉ việc**: xóa người đó ở Supabase → Authentication → Users. Máy chủ kiểm tra lại tài khoản với Supabase ở mỗi yêu cầu nên quyền truy cập mất trong vòng vài phút; nếu email nằm trong `ALLOWED_EMAILS` thì xóa luôn ở đó.
- Dữ liệu thương hiệu trong prompt được gửi tới Anthropic, OpenAI và Google. Không nhập dữ liệu cá nhân của khách hàng vào hồ sơ audit.

## 8. Chi phí

Số lượt gọi cho một audit đầy đủ, 3 AI, lặp 1 lần: **123 lượt hỏi + khoảng 16–20 lượt chấm**. Lặp 2 lần thì gần gấp đôi. Có tìm kiếm web thì mỗi lượt tính thêm phí tìm kiếm theo bảng giá từng hãng (tài liệu Claude ghi 10 USD/1.000 lượt tìm kiếm tại thời điểm viết). Xem bảng giá hiện hành trước khi chạy hàng loạt.

## 9. Giới hạn của phép đo

- API không trả lời y như ứng dụng ChatGPT/Gemini/Claude (không có cá nhân hóa, bộ nhớ). Gemini trả nguồn dưới dạng liên kết chuyển hướng của Google, tên hiển thị là tên miền.
- Vị trí tìm kiếm được đặt là Hà Nội, Việt Nam (đổi bằng `SEARCH_*`). Claude và ChatGPT nhận tham số vị trí; Gemini không có tham số tương đương.
- Câu trả lời thay đổi theo thời điểm: dùng tỷ lệ qua nhiều lượt, không dựa vào một câu trả lời.
- Giám khảo chấm điểm là Claude, nên có thể thiên vị với câu trả lời của chính Claude. Xem lại các ô quan trọng bằng mắt trước khi gửi báo cáo cho khách.
- Prompt hỏi mặc định chỉ yêu cầu “trả lời tiếng Việt, ngắn gọn” để gần với người dùng thật; đổi bằng biến `PROBE_SYSTEM`.

## 10. Chạy thử trên máy

```bash
npm ci
npm run dev:fake   # giao diện với dữ liệu giả lập, không cần khóa. http://localhost:3100
                   # đăng nhập: staff@netspace.vn / Mat-khau-1
npm test           # kiểm tra API giả lập + cấu hình, công cụ và HTTP transport của Gateway
cp .env.example .env   # điền khóa thật, rồi:
npm run dev        # http://localhost:3000, dùng Supabase và AI thật
```

## 11. Cấu trúc

```
public/index.html        giao diện (một file)
api/login.js logout.js me.js        đăng nhập, đăng xuất, thông tin phiên và cấu hình
api/probe.js             hỏi 1 câu tới 1 AI (claude | openai | gemini)
api/claude.js            Claude chấm điểm và viết nội dung
api/audits/              lưu, đọc, xóa audit (có kiểm tra phiên bản)
api/_lib/                xác thực, Supabase, nhà cung cấp AI, hạn mức
api/_lib/gateway.js      AI SDK, một key Gateway, native web search
supabase/schema.sql      bảng và hàm
seed/netspace-pilot.json audit mẫu NetSpace
test/                    máy chủ giả lập và kiểm thử
```

## Chẩn đoán lỗi HTTP 502 khi Hỏi AI

Mỗi AI chạy câu hỏi đầu tiên trong danh sách trước khi mở các lượt gọi song song. Nếu câu này lỗi, dừng riêng AI đó; câu hỏi kiểm tra được dùng luôn làm kết quả nên không tạo thêm lượt trả phí. Các AI còn lại tiếp tục. Nếu sau đó xuất hiện nhiều lỗi liên tiếp, dừng các câu chưa gửi của AI đang lỗi.

Nếu phản hồi API không theo cấu trúc JSON của ứng dụng (HTML/text, hoặc JSON khác định dạng), giao diện hiện HTTP status và mã `x-vercel-id` nếu có, thay vì chỉ `http_502`. Dùng mã này đối chiếu Vercel Logs. Không hiển thị HTML hoặc toàn bộ nội dung phản hồi bên ngoài.

Để phân biệt lỗi công cụ tìm kiếm với lỗi model/runtime: chạy cùng câu hỏi và cùng model Claude với web tắt rồi bật. Nếu chỉ web bật thất bại, kiểm tra quyền native web search, provider được Gateway chọn và nội dung lỗi upstream; nếu cả hai thất bại, kiểm tra model/key/quyền và lỗi thực thi hàm. Không tự bỏ tìm kiếm web hoặc đổi model để giả lập một phép đo thành công. CSV chỉ có HTTP status không đủ xác định nguyên nhân upstream.
