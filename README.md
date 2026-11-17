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
| `PROBE_MAX_TOKENS_CLAUDE` / `_OPENAI` / `_GEMINI` | (tuỳ chọn) trần token đầu ra mỗi lượt hỏi; mặc định 1500 / 4000 / 4096. OpenAI và Gemini tính cả token suy luận vào mức này nên cần rộng hơn Claude. Câu trả lời vẫn bị cắt sẽ được đánh dấu ⚠ trong bảng kết quả |

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
- Vị trí tìm kiếm mặc định là Hà Nội (`SEARCH_CITY`, `SEARCH_REGION`, `SEARCH_TIMEZONE`). OpenAI nhận thêm `SEARCH_COUNTRY=VN`. Claude không kế thừa mã quốc gia này: chỉ gửi city/region/timezone; nếu cần country thì đặt riêng `ANTHROPIC_SEARCH_COUNTRY` với mã được search provider hỗ trợ. Gemini không có tham số tương đương.
- Câu trả lời thay đổi theo thời điểm: dùng tỷ lệ qua nhiều lượt, không dựa vào một câu trả lời.
- Giám khảo chấm điểm là Claude, nên có thể thiên vị với câu trả lời của chính Claude. Xem lại các ô quan trọng bằng mắt trước khi gửi báo cáo cho khách.
- Prompt hỏi mặc định chỉ yêu cầu “trả lời tiếng Việt, ngắn gọn” để gần với người dùng thật; đổi bằng biến `PROBE_SYSTEM`.

## Quy trình audit 6 bước

1. **Hồ sơ thương hiệu** – dữ kiện chuẩn do thương hiệu cung cấp, chủ đề, tình huống mua hàng và **đối thủ cạnh tranh** (nhập tay, nhờ AI gợi ý theo ngành, hoặc duyệt thương hiệu AI đã nêu sau bước Hỏi AI). Có thể **gửi link riêng cho thương hiệu tự nhập** (xem dưới).
2. **Dữ kiện** – nút "Chạy toàn bộ dữ kiện": quét website → tra Wikidata → kiểm chứng claim.
3. **Hỏi AI** – chạy thư viện prompt trên Claude, ChatGPT, Gemini; share of voice, nguồn trích dẫn, độ tin cậy giám khảo.
4. **Chấm 6 lớp** – "Chấm tự động 6 lớp" hoặc "Chấm lại lớp này": tiêu chí có dữ liệu máy được chấm theo quy tắc (miễn phí); tiêu chí còn lại do AI chấm từ toàn bộ dữ kiện (mỗi lớp 1 lượt gọi), gắn nhãn **AI · cần duyệt**; nếu thiếu dữ kiện AI để trống và ghi cần thu thập gì. **Điểm chuyên viên chấm tay không bao giờ bị ghi đè.** Chuyên viên bấm "Duyệt điểm này" hoặc "Duyệt tất cả".
5. **Kết quả** – nhắc khi còn điểm AI chưa duyệt.
6. **Công cụ cải thiện** – AI soạn **kế hoạch hành động 90 ngày** từ điểm và dữ kiện của audit (mỗi việc có căn cứ, các bước, người phụ trách, cách đo lại); kèm JSON-LD, bộ mô tả chuẩn, hỏi–đáp, robots.txt. Kế hoạch được đưa vào báo cáo xuất ra.

### Link cho thương hiệu tự nhập

**Cần chạy một lần** `supabase/migrations/002_intake.sql` trong Supabase → SQL Editor (tạo bảng `intake_links`, `intake_submissions`).

- Ở bước Hồ sơ → "Thương hiệu tự nhập" → chọn hiệu lực (7/14/30 ngày) → **Tạo link mới**. Link chỉ hiện **một lần**; gửi qua kênh riêng.
- Thương hiệu mở `https://checkai.netspace.vn/intake#t=…` (không cần đăng nhập), chỉ thấy và sửa phần hồ sơ và đối thủ, **không thấy điểm hay dữ liệu audit khác**. Có nút nhờ AI gợi ý chủ đề, tình huống, đối thủ (giới hạn lượt theo link).
- Thông tin gửi lên vào **hàng chờ**; NetSpace xem từng mục (hiện tại ↔ đề xuất), bỏ chọn mục không dùng, bấm **Áp dụng mục đã chọn** hoặc **Từ chối**. Hồ sơ audit không đổi trước khi duyệt.
- Bảo mật: token 256 bit, máy chủ chỉ lưu **mã băm**; token nằm sau dấu `#` nên không đi vào nhật ký máy chủ và bị xóa khỏi thanh địa chỉ ngay khi mở; có thời hạn, **thu hồi được**; giới hạn số lần gửi và lượt AI mỗi link; chi phí AI tính vào hạn mức của người tạo link.

| Biến (tuỳ chọn) | Mặc định | Ý nghĩa |
|---|---|---|
| `INTAKE_AI_LIMIT` | 6 | Số lượt gợi ý bằng AI tối đa mỗi link |
| `INTAKE_SUBMISSION_LIMIT` | 30 | Số lần gửi tối đa mỗi link |

Kiểm thử trên trình duyệt cho quy trình này: `npm run dev:fake` rồi `python3 test/ui-workflow.py`.

## Nâng cấp đo lường (giai đoạn 1 và 2)

**Hỏi AI**
- **Cách hỏi khác:** mỗi câu nhóm C có thêm 2 cách diễn đạt cố định; nhóm S có 2 cách hỏi cho mỗi tình huống do AI soạn và chuyên viên sửa (mục "Cách hỏi khác"). Tắt bằng ô "Hỏi thêm 2 cách diễn đạt".
- **Share of voice:** giám khảo trích mọi thương hiệu được nêu trong câu trả lời nhóm C, T, S kèm vị trí và sắc thái. AI gợi ý đối thủ, chuyên viên bấm Duyệt hoặc Bỏ qua, thêm biến thể tên để gộp đúng.
- **Nguồn AI hay trích dẫn:** tổng hợp tên miền theo AI; cột "khoảng trống" đếm câu trả lời có đối thủ nhưng thiếu thương hiệu.
- **Khoảng tin cậy 95% (Wilson)** cho mọi tỷ lệ.
- **Giám khảo khác hãng** với AI được chấm (bật mặc định) để giảm thiên vị.
- **Chuyên viên chấm lại** từng câu; app tính tỷ lệ trùng khớp và Cohen's kappa giữa AI và người. Điểm của chuyên viên thay thế điểm của AI khi tính.

**Tab Dữ kiện**
- **Quét website** (`/api/scan`): robots.txt theo 13 bot AI (RFC 9309), truy cập thử bằng user-agent của bot để phát hiện tường lửa chặn, sitemap, llms.txt, HTML gốc, schema, thông tin pháp lý, giá, đường dẫn hành động. Gợi ý điểm 1.1, 1.2, 1.5, 2.2, 2.4, 2.6, 3.3, 6.4, 6.6.
- **Wikidata** (`/api/entity`): thực thể nào trỏ đúng website, bao nhiêu thực thể trùng tên. Gợi ý 2.5 khi chưa có dữ liệu từ AI.
- **Kiểm chứng claim** (`/api/verify-claim`): AI tìm kiếm web cho từng claim; chỉ giữ nguồn có trong kết quả tìm kiếm thật; website thương hiệu không bao giờ là nguồn độc lập. Gợi ý 4.1.

**Quy mô một audit đầy đủ** (3 AI, lặp 1 lần): 91 câu hỏi × 3 = 273 lượt hỏi + khoảng 39 lượt chấm + khoảng 10 lượt cho cách hỏi khác, quét, Wikidata và claim. Bảng "Ước tính trước khi chạy" đã tính các con số này.

**Biến môi trường mới (tuỳ chọn)**
| Biến | Ý nghĩa |
|---|---|
| `WIKIDATA_API` | Mặc định `https://www.wikidata.org/w/api.php` |
| `SCAN_ALLOW_PRIVATE` | Chỉ để chạy thử cục bộ với website giả; **luôn bị bỏ qua trên Vercel** |

**Giới hạn cần biết**
- Quét chỉ đọc trang chủ, trang giới thiệu, robots.txt, sitemap và llms.txt; chưa quét trang sản phẩm.
- Thử truy cập bằng user-agent không thay được bot thật (một số tường lửa xác minh theo IP).
- Share of voice dựa trên tên thương hiệu do AI trích; cần khai báo biến thể tên của đối thủ để gộp đúng.
- Kiểm chứng claim vẫn dựa vào AI để phân loại nguồn; xem lại các claim quan trọng bằng mắt.
- Kiểm thử trên trình duyệt: `npm run dev:fake` rồi `python3 test/ui-upgrade.py` và `python3 test/ui-regression.py`.

## 10. Chạy thử trên máy

```bash
npm ci
npm run dev:fake   # giao diện với dữ liệu giả lập, không cần khóa. http://localhost:3100
                   # đăng nhập: staff@netspace.vn / Mat-khau-1
npm test           # kiểm tra API giả lập + cấu hình, công cụ và HTTP transport của Gateway
python3 test/ui-regression.py   # kiểm thử giao diện trên trình duyệt thật (cần `npm run dev:fake` đang chạy, pip install playwright)
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

### Claude qua Gateway và GPT-6 Luna

Claude (hỏi, chấm và viết) dùng Anthropic Messages API tại `https://ai-gateway.vercel.sh/v1/messages` với `AI_GATEWAY_API_KEY`; không cần key Anthropic riêng. Giữ nguyên native web search, citations và nối lượt `pause_turn`, giới hạn chung 100 giây. Các phản hồi lỗi HTTP được chuyển qua bộ chẩn đoán Gateway hiện có. OpenAI và Gemini tiếp tục dùng AI SDK Gateway.

Không tự gán `country=VN` cho Claude web search: Anthropic có thể trả HTTP 400 nếu search provider không hỗ trợ mã quốc gia. Vẫn giữ Hanoi/Asia/Ho_Chi_Minh, không đổi sang quốc gia khác. `ANTHROPIC_SEARCH_COUNTRY` là cấu hình riêng tùy chọn. Việc này xử lý rủi ro trong cấu hình gửi đi, chưa chứng minh nguyên nhân của 502 Production khi chưa có phản hồi thực tế. Tài liệu: https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool và https://vercel.com/docs/ai-gateway/sdks-and-apis/anthropic-messages-api/advanced.

GPT-6 Luna (`openai/gpt-6-luna`) có trong bộ chọn OpenAI; dự toán dùng giá tham khảo $0.10/1M token vào, $0.50/1M token ra và $10/1.000 lượt tìm kiếm ở ngưỡng context thông thường, đối chiếu catalog Gateway ngày 13/11/2026. Model mặc định của máy chủ không thay đổi.
