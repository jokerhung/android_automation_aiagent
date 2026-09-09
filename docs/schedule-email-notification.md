# Schedule email notifications

## Cấu hình an toàn

Mở **Cấu hình → Email**, nhập SMTP server, port, STARTTLS hoặc TLS trực tiếp, tài khoản, địa chỉ gửi và người nhận mặc định. Mật khẩu/App Password là write-only: API chỉ trả `passwordConfigured`, không trả plaintext. Trên Windows, mật khẩu được mã hóa bằng DPAPI CurrentUser và file có ACL chỉ cho user hiện tại. Biến môi trường `EMAIL_SMTP_PASSWORD` có thể thay mật khẩu lưu; tuyệt đối không commit biến này.

Nút **Kiểm tra kết nối** chỉ gọi SMTP verify và không gửi thư. Nút **Gửi email thử** luôn hiển thị recipient, yêu cầu xác nhận, chỉ gửi nội dung generic và attachment do server tạo. Không có email nào được gửi khi mở Settings, startup, build hoặc test tự động.

## Dùng với schedule

Email mặc định tắt. Bật **Gửi email sau khi chạy xong**, kiểm tra recipient và subject. Mỗi occurrence snapshot recipient, subject và account identity trước khi chạy; password không nằm trong schedule, occurrence, outbox, log hoặc API. Email terminal có kết quả job và attachment UTF-8 bất biến tối đa 100 bước/5 MiB; screenshot, base64, Bearer/API/SMTP secret và action.text được che.

Job và email có trạng thái độc lập. Lỗi SMTP không fail/re-run job và không chặn scheduler. `sent` chỉ có nghĩa SMTP chấp nhận recipient, không bảo đảm vào inbox. `delivery_unknown` không tự retry; manual retry cảnh báo khả năng trùng. Đổi account identity khiến email cũ `blocked_config`; cập nhật password cho cùng identity cho phép retry.

## Delivery và giới hạn

Outbox SQLite durable có uniqueness theo occurrence/type, lease claim atomic, restart recovery, backoff 1/5/15 phút và tối đa bốn attempt. Worker concurrency 1, giới hạn 30 SMTP accepts/giờ và backlog active 500. Khi backlog đầy, job vẫn hoàn thành và email được ghi `failed / EMAIL_BACKLOG_LIMIT`. Xóa schedule hủy email chưa gửi; email đang gửi/đã accept không thể thu hồi.

Ứng dụng foreground, background và autostart dùng cùng worker. Shutdown dừng claim mới, drain attempt hiện tại trong lifecycle deadline rồi mới đóng SQLite.

## Quan sát và khắc phục

Danh sách schedule cập nhật qua SSE, hiển thị trạng thái email, attempt count; tooltip có recipient, subject, retry/sent timestamp và lỗi đã redact. Retry chỉ retry outbox, không tạo conversation và không chạy lại job.

- `blocked_config`: sửa cấu hình hoặc password, giữ nguyên sender identity nếu muốn retry snapshot cũ.
- `attachment_failed`: xem lỗi snapshot; attachment không được đọc lại từ đường dẫn tùy ý.
- `delivery_unknown`: kiểm tra mailbox/SMTP log trước khi chấp nhận nguy cơ gửi trùng.
- `EMAIL_BACKLOG_LIMIT`: xử lý backlog terminal hoặc giảm tần suất schedule.

## Kiểm chứng không gửi mail thật

`npm run verify:email` chạy typecheck và test email bằng fake sender/in-memory SQLite. `npm run build` không gửi mail. Chỉ test thủ công từ UI sau khi người dùng xác nhận recipient mới có thể gửi email thật.
