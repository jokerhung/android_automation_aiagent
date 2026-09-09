# Kế hoạch gửi email kết quả job trong lập lịch

Ngày lập: 2026-09-09.
Trạng thái: đề xuất triển khai; chỉ tạo tài liệu, chưa cài thư viện, cấu hình SMTP hoặc gửi email.

## 1. Mục tiêu

1. Cấu hình tài khoản gửi email trong **Cấu hình**, tham khảo dự án
   `C:\hungnm\ai_agent_vision_adb`.
2. Khi tạo/sửa job trong Lịch chạy, có tùy chọn **Gửi email sau khi chạy xong**,
   kèm tiêu đề do người dùng nhập.
3. Email chứa kết quả lần chạy và file đính kèm ghi các bước thực hiện.
4. Chạy được cả foreground và background/autostart, không cần mở trình duyệt.
5. Không để lỗi SMTP làm job thất bại hoặc ngăn scheduler xử lý job tiếp theo.

## 2. Khảo sát nguồn tham khảo

Đã đọc các file nguồn sau, không đọc hoặc sao chép mật khẩu trong .env/config thật:

| Nguồn | Hành vi đã có | Áp dụng |
|---|---|---|
| [vision_agent.py](C:/hungnm/ai_agent_vision_adb/vision_agent.py:200) — get_email_config | Đọc EMAIL_SMTP_SERVER, PORT, USE_SSL, USER, PASSWORD, TO; kiểm tra cấu hình | Giữ các nhóm thông tin tương ứng trong Settings |
| [vision_agent.py](C:/hungnm/ai_agent_vision_adb/vision_agent.py:225) — send_result_email | Gọi PowerShell, nhận success/result, cho phép subject_override, timeout 60 giây | Dùng kết quả terminal của run, tiêu đề riêng từng job và timeout gửi |
| [send_mail.ps1](C:/hungnm/ai_agent_vision_adb/send_mail.ps1) | Có SMTP credential, To, Subject, Body và Attachment tùy chọn | Tham khảo cấu trúc email và attachment |
| [schedule.py](C:/hungnm/ai_agent_vision_adb/schedule.py:109) — run_agent | Truyền email_to của schedule qua CLI cho agent | Hỗ trợ người nhận theo job, mặc định lấy từ Settings |
| [vision_agent.py](C:/hungnm/ai_agent_vision_adb/vision_agent.py:26) — DailyLogWriter | Gộp stdout/stderr theo ngày | Không dùng file gộp ngày làm attachment cho từng occurrence |

Các khác biệt cần giữ rõ:

- Trong hàm Python đã đọc, lời gọi send_mail.ps1 **chưa truyền -Attachment**.
  Có hỗ trợ tham số không đồng nghĩa luồng gửi kết quả đã đính kèm log.
- Code cũ bỏ dấu tiếng Việt khỏi subject/body. Bản mới phải giữ UTF-8.
- Code cũ truyền SMTP password qua command-line. Bản mới không đưa secret lên argv,
  console, SSE, thông báo lỗi hoặc payload GET.
- Không chạy lại Python/PowerShell chỉ để gửi mail; triển khai mail service trong Node.
- Không tự nhập tài khoản hay người nhận thật từ dự án tham khảo; người dùng cấu hình lại.

## 3. Hiện trạng dự án và điểm tích hợp

- `components/settings-dialog.tsx`: dialog dạng tabs, draft chỉ được lưu khi bấm Lưu thay đổi.
- `components/app-shell.tsx`: điều phối việc lưu settings và autostart, đã có partial failure.
- `components/schedule-panel.tsx`: tạo/sửa Interval, Daily, Weekly; có Chạy ngay.
- `ScheduleService.onEvent()`: xử lý run.completed, run.failed, run.cancelled,
  cập nhật occurrence rồi gọi log writer.
- `failNew()/failExisting()`: xử lý missed/offline/busy/restart; không phải mọi occurrence đều có run.
- `ScheduleLogWriter.write()`: hiện ghi metadata, prompt, result, error vào file theo ngày;
  chưa ghi danh sách RunStep.
- `RunRecord.steps`: có số bước, action, summary, duration và createdAt trong SQLite.
- `redact()`: mới che một số API key và ảnh base64, chưa đủ cho SMTP password
  hoặc nội dung nhập trên thiết bị.
- Lifecycle hiện có shutdown/drain; worker email cần cùng cơ chế này.

Không attach trực tiếp log gộp ngày: Interval có thể chạy nhiều lần trong ngày,
file gộp dễ chứa dữ liệu của các lần chạy khác và thay đổi trong khi SMTP đang đọc.

## 4. Quy ước nghiệp vụ đề xuất

### 4.1. Khi nào gửi

- Mặc định tất cả lịch cũ và lịch mới đều **tắt gửi email**.
- Khi bật, gửi một thông báo cho **mỗi lần chạy của job** kết thúc ở completed,
  failed hoặc cancelled; không đợi cả schedule hết hạn.
- Failed/cancelled vẫn có email báo trạng thái và các bước đã chạy.
- Chạy ngay từ một job áp dụng cùng lựa chọn email của job đó; không tăng số lần theo lịch.
- Chat chạy thủ công ngoài Lịch chạy không gửi mail trong MVP.
- Occurrence missed/offline/waiting_device timeout chưa có run: không gửi ở MVP;
  UI mô tả rõ email áp dụng cho lần chạy thực tế. Có thể thêm báo lỡ lịch ở phase sau.
- Không gửi trong trạng thái pending, waiting_device, running hoặc paused.
- Không gửi hồi tố cho các occurrence terminal từ trước ngày migration.

### 4.2. Người nhận và tiêu đề

- Settings có **Người nhận mặc định**.
- Job có **Người nhận**, được điền sẵn từ Settings, cho phép sửa; MVP một địa chỉ.
- Lưu địa chỉ đã chọn trong job, không âm thầm đổi người nhận của job cũ khi
  người nhận mặc định trong Settings thay đổi.
- Tiêu đề bắt buộc khi bật email, người dùng tự nhập, trim, dài 1–200 ký tự,
  cấm CR/LF/null để tránh header injection.
- Gửi đúng tiêu đề người dùng lưu; trạng thái thành công/thất bại nằm trong body,
  không tự thêm tiền tố hoặc xử lý template.
- Nếu chưa cấu hình SMTP hợp lệ: job vẫn tạo được với email tắt; bật email thì
  phải chỉ rõ thiếu cấu hình, không báo gửi được khi chưa sẵn sàng.

### 4.3. Snapshot khi bắt đầu chạy

- Snapshot enabled, subject, recipient và identity tài khoản gửi vào occurrence
  khi tạo run, trước khi có thể nhận terminal event.
- Sửa job trong khi run đang chạy chỉ áp dụng từ lần chạy sau.
- Không snapshot SMTP password vào occurrence hoặc outbox.
- Nếu đổi identity tài khoản gửi trước khi worker gửi, giữ email ở blocked_config;
  không chuyển dữ liệu cũ sang SMTP provider/tài khoản mới một cách âm thầm.
- Cập nhật password cho cùng identity được dùng cho lần retry.
- Xóa job: hủy email chưa gửi của job theo cảnh báo xác nhận; message đã bắt đầu
  SMTP hoặc đã được chấp nhận không thể thu hồi.

## 5. Cấu hình email trong Settings

Thêm tab **Email** cạnh Chung, AI Model và Giới thiệu.

Các trường:

| Trường | Quy tắc |
|---|---|
| SMTP server | Hostname/IP hợp lệ, không nhận URL/command |
| SMTP port | Số nguyên 1–65535 |
| Bảo mật kết nối | STARTTLS hoặc TLS trực tiếp |
| Tài khoản SMTP | Username của tài khoản gửi |
| Mật khẩu/App password | Password field, write-only |
| Địa chỉ gửi (From) | Email; mặc định gợi ý từ tài khoản nếu đó là địa chỉ email |
| Tên người gửi | Tùy chọn, ví dụ Android Agent |
| Người nhận mặc định | Email, không lấy từ model/prompt |

Giao diện:

- Trạng thái cấu hình: chưa cấu hình / đã lưu / xác thực SMTP thành công / lỗi.
- Password đã lưu chỉ hiển thị “Đã cấu hình”; để trống nghĩa là giữ nguyên.
- Xóa credential là thao tác riêng có xác nhận, không dùng chuỗi rỗng để xóa ngầm.
- Đổi tab giữ draft, Hủy/Escape không ghi file hoặc gửi mail.
- Nút **Kiểm tra kết nối** xác thực SMTP, không gửi thông báo kết quả job.
- Nút **Gửi email thử** phải hiển thị và xác nhận recipient; body mẫu không chứa
  dữ liệu job, attachment mẫu được tạo riêng.
- Nêu rõ account/password thông thường có thể không đủ nếu provider yêu cầu
  App Password hoặc không hỗ trợ SMTP password. OAuth2 không thuộc MVP.
- Kiểm tra/gửi thử dùng cấu hình đã lưu; báo “Lưu cấu hình trước” khi draft còn thay đổi.

### Bảo mật credential

- Lưu non-secret settings trong SQLite; password lưu server-side riêng.
- Ưu tiên Windows DPAPI CurrentUser + file có ACL chỉ user ứng dụng/SYSTEM,
  tái sử dụng adapter bảo vệ đường dẫn hiện có; background phải chạy cùng user.
- Không lấy thuật toán tự mã hóa hoặc khóa hardcode. Nếu secret store không
  khả dụng thì báo lỗi, không fallback plaintext không thông báo.
- Nếu cần hỗ trợ nền tảng khác, dùng secret adapter riêng; chưa công bố khả năng
  cấu hình password qua UI nếu backend bảo vệ secret chưa có.
- Có thể cho dùng EMAIL_SMTP_PASSWORD từ môi trường làm override để triển khai
  thủ công, nhưng không tự import .env của dự án tham khảo.
- Non-secret và password cập nhật như một cấu hình versioned; nếu ghi secret lỗi,
  không công bố cấu hình mới là hoàn chỉnh.
- Với settings/autostart/email là ba miền lưu, UI phải báo rõ miền nào đã lưu,
  miền nào lỗi và chỉ retry phần còn thiếu.

## 6. Transport Node

Đề xuất Nodemailer với SMTP transport; thêm dependency và types tại bước triển khai,
chọn phiên bản tương thích Node/dependency hiện tại sau audit.

- TLS trực tiếp: secure=true; STARTTLS: secure=false, requireTLS=true.
- Không mặc định tắt kiểm tra certificate hoặc cho downgrade sang plaintext.
- Connection/greeting/socket timeout và deadline tổng có giới hạn; đề xuất một
  attempt tối đa 60 giây, worker concurrency=1.
- verify() chỉ xác minh kết nối/auth, không bảo đảm provider chấp nhận mọi From/To.
- Tắt raw SMTP debug; lỗi trả về phải redact.

Các lựa chọn TLS, timeout và verify theo [Nodemailer SMTP transport](https://nodemailer.com/smtp).
Attachment dùng Buffer/content thay vì path/URL do client cung cấp;
có thể bật disableFileAccess và disableUrlAccess. [Nodemailer attachments](https://nodemailer.com/message/attachments)

Không kế thừa cờ USE_SSL mơ hồ của dự án cũ: UI phải phân biệt TLS trực tiếp
và STARTTLS, không ánh xạ port 587 thành secure=true.

## 7. Nội dung email và file logs

### 7.1. Body

Dùng text/plain UTF-8 ở MVP:

```text
Công việc: Kiểm tra ứng dụng
Trạng thái: Hoàn thành / Thất bại / Đã hủy
Bắt đầu: <giờ theo timezone job>
Kết thúc: <giờ theo timezone job>
Thời lượng: ...
Số bước đã ghi nhận: ...
Lần chạy: <occurrenceId>

Kết quả:
<run.result hoặc errorMessage>

File đính kèm: nhật ký các bước của lần chạy này.
```

- Không dùng raw HTML từ model.
- Không dùng localhost link như cách duy nhất để xem kết quả, vì người nhận có
  thể đọc mail trên máy khác.
- Có thể kèm runId/conversationId dạng text để đối chiếu.

### 7.2. Attachment độc lập mỗi occurrence

Tên do server sinh: `job_<scheduleId>_<occurrenceId>_steps.txt`, MIME
`text/plain; charset=utf-8`.

Nội dung:

1. Job name/ID, occurrence/run ID, timezone, thời điểm dự kiến/bắt đầu/kết thúc.
2. Kết quả terminal và lỗi nếu có.
3. Từng RunStep theo stepNo: thời gian, loại action, summary hiển thị trong chat,
   tọa độ/keycode/wait duration không nhạy cảm, durationMs.
4. Bước finish và lý do dừng khi chạm giới hạn bước.
5. Nếu lỗi giữa chừng: có thể ghi action đã planned nhưng chưa có kết quả,
   phải đánh dấu “chưa xác nhận thực thi”, không coi đó là bước đã hoàn thành.

Chỉ sử dụng summary/thought vốn đã lưu và hiển thị trong ứng dụng; không yêu cầu
model cung cấp suy luận nội bộ bổ sung.

An toàn và giới hạn:

- Không kèm screenshot/base64, raw UI hierarchy hoặc toàn bộ stdout/server.log.
- Không kèm toàn bộ prompt mặc định; không gửi nội dung action.text có thể là
  mật khẩu/OTP. Che bằng marker và nêu trong báo cáo.
- Redact secret được cấu hình (SMTP/API credentials) trước snapshot; redaction
  regex không thể bảo đảm loại hết dữ liệu cá nhân nên UI cần cảnh báo.
- Attachment bất biến sau terminal, không đọc lại file gộp ngày tại lần retry.
- Xây Buffer từ snapshot server-owned; không cho request chọn file tùy ý,
  không follow symlink hoặc URL để gửi dữ liệu ngoài phạm vi.
- Đề xuất tối đa 5 MiB dữ liệu log trước MIME encoding; nếu lớn hơn, gzip thành
  .txt.gz. Nếu vẫn quá giới hạn, đánh dấu attachment_failed, không gửi thiếu log
  một cách âm thầm. UI giải thích và cho retry sau khi xử lý.
- Lỗi lưu log vào thư mục người dùng không nhất thiết ngăn gửi: nếu vẫn tạo được
  snapshot đầy đủ trong SQLite thì attach từ snapshot và ghi chú lỗi file cục bộ.
- Nếu không thể tạo đủ snapshot bước, giữ bản ghi lỗi để retry, không coi email
  “đã gửi đầy đủ” với attachment rỗng.

## 8. Luồng xử lý và outbox

```text
Run kết thúc
  → đọc kết quả + steps + cấu hình email snapshot
  → transaction cập nhật occurrence terminal và tạo outbox/snapshot
  → ghi log cục bộ từ snapshot
  → worker tạo MIME body + attachment
  → SMTP send
  → cập nhật email status và phát schedule.updated
```

### Yêu cầu quan trọng

- Không gửi mail trực tiếp trong event listener đang giữ luồng scheduler.
- Một outbox cho mỗi occurrence: UNIQUE(occurrence_id, notification_type).
- onEvent hiện bỏ qua occurrence đã terminal; phải sửa recovery để vẫn tìm
  outbox pending/missing đối với occurrence có snapshot đủ điều kiện.
- Kết quả terminal và outbox phải được persist cùng transaction trước thao tác
  SMTP, tránh crash giữa hai bước làm mất thông báo.
- Nếu serialize/report snapshot lỗi, transaction vẫn cần lưu terminal cùng
  record attachment_failed và dữ liệu nguồn để có thể chuẩn bị lại.
- Không mở transaction SQLite trong lúc chờ SMTP/file IO.
- Reconcile lúc startup chỉ xử lý các run đã opted-in qua snapshot version mới;
  không quét và gửi lại toàn bộ lịch sử.

### Retry và chống trùng

- Lỗi tạm thời trước khi server SMTP chấp nhận mail: backoff 1/5/15 phút,
  tối đa bốn attempt tính cả lần đầu.
- Lỗi auth/certificate/recipient cố định: failed hoặc blocked_config, không
  retry liên tục; cho thử lại sau khi sửa cấu hình.
- Persist attempts, nextAttemptAt, lease owner/expiry; worker claim atomic.
- Khi timeout/disconnect sau DATA hoặc crash sau SMTP accept nhưng trước commit,
  trạng thái gửi có thể **không xác định**. Dùng delivery_unknown, không tự
  gửi lại mù quáng; retry thủ công cảnh báo khả năng trùng.
- Message-ID ổn định theo outbox hỗ trợ đối chiếu nhưng không bảo đảm dedupe
  phía SMTP. Không cam kết exactly-once delivery.
- Status sent nghĩa là SMTP đã chấp nhận recipient, không chứng minh đã vào inbox;
  bounce/spam không xử lý trong MVP.
- Interval có thể tính bằng giây: giới hạn tốc độ toàn cục, cảnh báo số mail
  ước tính trong form, giới hạn queue/dung lượng và backlog hiển thị rõ.
- Khi quá quota, không dừng job; ghi throttled/failed có nguyên nhân, không
  tăng queue không giới hạn. Đề xuất mặc định 30 email/giờ, chốt ở Phase 0.

## 9. Contracts và migration

### Job

```ts
type ScheduleEmailNotification =
  | { enabled: false }
  | { enabled: true; to: string; subject: string };

// Thêm vào Schedule
emailNotification: ScheduleEmailNotification;
```

Cột schedules dự kiến:

- email_enabled INTEGER NOT NULL DEFAULT 0.
- email_to TEXT NULL.
- email_subject TEXT NULL.

Occurrence thêm email_config_snapshot_json nullable, chứa version,
enabled/to/subject/accountIdentity; không chứa password.

### Outbox

```text
schedule_email_outbox
  id
  occurrence_id
  notification_type = "job-result"
  config_snapshot_json
  result_snapshot_json
  attachment_content / attachment_blob
  attachment_name, attachment_encoding, attachment_sha256
  status: pending | preparing | sending | retry_wait | sent |
          failed | blocked_config | attachment_failed | delivery_unknown | cancelled
  attempts, next_attempt_at
  lease_owner, lease_expires_at
  message_id, sent_at
  error_code, redacted_error_message
  created_at, updated_at
  UNIQUE(occurrence_id, notification_type)
```

- Settings email non-secret lưu trong namespace riêng, credential store riêng.
- Migration idempotent; lịch cũ email_enabled=0; occurrence cũ không có snapshot.
- Dùng INSERT/UPDATE có tên cột rõ ràng, không phụ thuộc thứ tự cột.
- Outbox snapshot giúp xóa conversation/run không làm thiếu logs mail đang chờ.
- Xóa job phải cancel pending outbox trước khi cascade; đã sending thì cảnh báo
  không thể hứa thu hồi. Nếu chọn giữ audit, dùng FK SET NULL + snapshot ID.
- Prune không xóa snapshot/outbox đang chờ hoặc chưa rõ kết quả.
- Retention đề xuất: sent/cancelled 7 ngày, failed/unknown 30 ngày; dữ liệu email
  là bản sao nhạy cảm nên giới hạn dung lượng và ACL database/spool.

## 10. API

| Endpoint đề xuất | Chức năng |
|---|---|
| GET /api/settings/email | Public config + passwordConfigured, không trả password |
| PATCH /api/settings/email | Lưu cấu hình và password write-only |
| POST /api/settings/email/verify | Kiểm tra SMTP config đã lưu, không gửi mail |
| POST /api/settings/email/test | Gửi mail mẫu sau xác nhận recipient |
| POST/PATCH /api/schedules[/id] | Nhận emailNotification strict |
| GET /api/schedules[/id] | Hiển thị email status mới nhất/chi tiết occurrence |
| POST /api/schedules/:id/occurrences/:occurrenceId/email/retry | Retry đúng thông báo thuộc job |

API chỉ nhận intent/config, không nhận attachment path, HTML tùy ý hoặc command.
Recipient/subject/from cấm CRLF/null; validate email và giới hạn body.

Settings SMTP/test/retry dùng guard loopback + same-origin/CSRF hiện có; không
cho ALLOW_LAN tự mở quyền quản trị email. Test connection cũng là network action:
chỉ gọi host/port SMTP đã cấu hình, có rate limit/timeout, không biến thành proxy
scan địa chỉ tùy ý. Nếu hỗ trợ SMTP nội bộ, cho phép có chủ đích, không suy diễn
localhost là luôn an toàn.

Không trả credential/raw SMTP transcript trong response lỗi. Khi SMTP lỗi,
schedule status vẫn phản ánh kết quả chạy thực tế.

## 11. UI lịch chạy và đồng ý chia sẻ dữ liệu

Trong dialog tạo/sửa:

- Switch **Gửi email sau khi chạy xong**.
- Khi bật: Người nhận, Tiêu đề email, ghi chú file logs sẽ được đính kèm.
- Hiển thị rõ email nhận và cảnh báo “Kết quả và nhật ký các bước có thể chứa
  dữ liệu trên thiết bị. Chỉ bật khi bạn đồng ý gửi tới địa chỉ này.”
- Người dùng tự bật và Lưu là sự đồng ý cho các lần chạy tương lai của job,
  không tự bật từ nội dung prompt hoặc chỉ vì đã cấu hình SMTP.
- Đổi tài khoản, recipient hoặc sửa chính sách áp dụng sau khi Lưu; không để
  model thay recipient, subject hay attachment.
- Giữ lựa chọn khi đổi Interval/Daily/Weekly; job không chọn email giữ hành vi cũ.
- Cảnh báo tần suất cao cho Interval, không giấu cảnh báo sau tab.

Trong danh sách/chi tiết:

- Phân biệt trạng thái job và trạng thái email: “Hoàn thành · Email đang chờ”,
  “Email đã được SMTP chấp nhận”, “Gửi email thất bại”, “Chưa xác định đã gửi”.
- Tooltip/chi tiết có recipient, subject, số attempt, lỗi đã redact, thời gian gửi.
- Retry thủ công không chạy lại job hoặc tạo lại conversation.
- SSE schedule.updated làm mới badge, không reload trang hay mở lại chat.

## 12. Shutdown, startup và background

- Worker email do application lifecycle quản lý, chỉ một worker trên instance.
- Shutdown dừng claim mới, cho SMTP attempt hiện tại kết thúc trong deadline
  chung, đóng transport; không để một socket SMTP giữ server vô hạn.
- Nếu chưa đủ thời gian hoàn tất, persist retry_wait hoặc delivery_unknown đúng
  giai đoạn, không tự đánh dấu sent.
- Scheduler/event/log drain tạo xong outbox trước khi đóng SQLite.
- Background chạy cùng Windows user có thể giải mã credential; thiếu credential
  sau đổi user/password-store thì blocked_config, không crash server.
- Khi restart, phục hồi queue bằng lease/outbox; không gửi lại mail đã sent.
- Không tự gửi test mail lúc startup hoặc mở Settings.

## 13. File dự kiến thay đổi/thêm

```text
components/settings-dialog.tsx
components/app-shell.tsx
components/schedule-panel.tsx
app/settings.css
app/schedule.css
lib/contracts/email.ts
lib/contracts/types.ts
lib/contracts/schemas.ts
lib/server/email/email-settings.ts
lib/server/email/email-secret-store.ts
lib/server/email/email-transport.ts
lib/server/email/job-email-report.ts
lib/server/email/email-outbox-repository.ts
lib/server/email/email-worker.ts
lib/server/persistence/session-repository.ts
lib/server/schedule/schedule-repository.ts
lib/server/schedule/schedule-service.ts
lib/server/schedule/schedule-log-writer.ts
lib/server/logging/redaction.ts
lib/server/application-lifecycle.ts
app/api/settings/email/route.ts
app/api/settings/email/verify/route.ts
app/api/settings/email/test/route.ts
app/api/schedules/[id]/occurrences/[occurrenceId]/email/retry/route.ts
package.json
.env.example
docs/setup-windows.md
```

Không đưa mật khẩu thật, địa chỉ recipient thật hoặc log thiết bị vào fixture/test/docs.

## 14. Các giai đoạn triển khai

### Phase 0 — Chốt quy ước và spike

- Chốt gửi completed/failed/cancelled, người nhận theo job, run-now áp dụng policy.
- Chốt account identity/version, secret store, quota và giới hạn attachment.
- Spike SMTP bằng transport giả hoặc SMTP local test, không gửi tới tài khoản thật.
- Xác nhận stream log/step của run có đủ thông tin để tạo report và điểm transaction.

### Phase 1 — Email settings

- Contracts strict, secret adapter, tab Email, API GET/PATCH.
- Kiểm tra TLS/auth config, password giữ nguyên/xóa rõ ràng.
- Verify/test có consent và rate limit.

### Phase 2 — Job policy và migration

- Job email toggle/to/subject, persistence và occurrence snapshot.
- Lịch cũ không gửi email; update job không làm đổi snapshot run đang chạy.

### Phase 3 — Report và attachment

- Tạo báo cáo UTF-8 riêng từng occurrence từ result + steps.
- Redaction, boundaries, oversized/gzip, lỗi log cục bộ và immutable snapshot.

### Phase 4 — Outbox và worker

- Atomic terminal/outbox, claim/lease, retry, unknown delivery, quota.
- Tích hợp terminal, reconcile, pruning, shutdown và background.

### Phase 5 — UI trạng thái và nghiệm thu

- Badge SSE, chi tiết lỗi và retry thủ công.
- Typecheck/test/build và test migration bằng database tạm.
- Gửi email thật với tài khoản/recipient người dùng chọn chỉ sau khi được phép;
  kiểm tra hộp thư và attachment thực tế.

## 15. Kiểm thử và tiêu chí hoàn thành

| Nhóm | Trường hợp |
|---|---|
| Settings | Save/cancel/tabs; GET không lộ password; để trống giữ secret; credential store lỗi; partial save |
| Validation | Email/subject injection; port/TLS sai; thiếu config; job email tắt không cần SMTP |
| Báo cáo | Thành công/lỗi/hủy; bước theo thứ tự; finish; planned chưa thực thi; UTF-8; max steps 100; che action.text |
| Attachment | Chỉ một occurrence; không lẫn job/ngày; log file mất; gzip/quá dung lượng; không đọc arbitrary path/URL |
| Lifecycle | Terminal trùng; crash trước/sau enqueue; restart lease; kết thúc trong shutdown; không block scheduler |
| SMTP | Auth/certificate lỗi; offline/timeout; accepted/rejected; unknown sau DATA; không claim inbox delivery |
| Retry | Backoff/quota; dedupe outbox; account identity đổi; manual retry không chạy lại job |
| Dữ liệu | Migration lịch cũ disabled; xóa conversation giữ snapshot; xóa job cancel pending; retention không mất queue |
| UI | Toggle mặc định off; required subject/to; giữ policy khi đổi loại; recipient/consent; trạng thái job khác email |
| Background | Không browser vẫn gửi; same-user credential; log không secret; không gửi thử tự động khi startup |

Nghiệm thu:

- [ ] Settings cấu hình được email an toàn, không lộ SMTP password.
- [ ] Job cho phép chọn gửi email và tiêu đề tự nhập.
- [ ] Email có đúng kết quả và attachment các bước của đúng lần chạy.
- [ ] SMTP thất bại không làm thay đổi kết quả job hoặc chạy lại agent.
- [ ] Lịch cũ không gửi mail; không gửi thật trong test tự động mặc định.
- [ ] Trạng thái/attempt và retry quan sát được qua UI/SSE.
- [ ] Hoạt động trong background, phục hồi sau restart và shutdown có giới hạn.
- [ ] Gửi/nhận thực tế và nội dung attachment đã được người dùng xác nhận.

## 16. Ngoài phạm vi MVP

- IMAP/đọc inbox, tracking pixel, read receipt, xử lý bounce tự động.
- OAuth2 provider-specific, nhiều tài khoản gửi và routing tự động.
- CC/BCC/danh sách nhiều recipient, HTML template tùy biến.
- Đính kèm ảnh màn hình hoặc file người dùng chỉ định.
- Gửi nội dung từ mọi chat thủ công hoặc gửi lại toàn bộ lịch sử.
- Cam kết exactly-once SMTP hoặc bảo đảm email vào inbox.
