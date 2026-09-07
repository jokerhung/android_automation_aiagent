# Cài đặt và chạy trên Windows

## Yêu cầu
- Node.js 22+ (đã kiểm tra với Node 24)
- Android Platform Tools và lệnh `adb` trong PATH
- Điện thoại bật Developer options, USB debugging và đã xác nhận RSA
- API OpenAI-compatible hỗ trợ vision + JSON Schema để chạy agent

## Khởi động
1. Sao chép `.env.example` thành `.env.local`, điền `OPENAI_API_KEY`, model và base URL.
2. Chạy `npm install`.
3. Chạy `npm run preflight` để kiểm tra Node, ADB, API key và thư mục dữ liệu.
4. Chạy `npm run dev`.
4. Mở http://127.0.0.1:3000.

## Trạng thái tích hợp màn hình
MVP hiện dùng snapshot PNG qua ADB cho giao diện (tự refresh); ảnh gửi model được nén JPEG quality 80 và ánh xạ tap/swipe trực tiếp. Adapter scrcpy chưa được vendored vì kế hoạch yêu cầu review license và khóa đồng bộ client/server trước khi tích hợp. Không ghép tùy tiện các phiên bản protocol. Xem `docs/scrcpy-decision.md`.

## Checklist thiết bị thật
- `adb devices -l` hiển thị đúng serial và trạng thái.
- Một thiết bị online được tự chọn; nhiều thiết bị yêu cầu chọn serial.
- Tap tâm/bốn góc, swipe, Back/Home/Recents, Power, Volume +/-.
- Chạy goal; kiểm tra pause/resume/cancel và không có action sau cancel.
- Rút/cắm USB, xoay màn hình, reload trang và restart server.
- Xác minh lịch sử trong SQLite `data/app.db` được phục hồi. Dữ liệu `data/sessions.json` cũ được nhập một lần rồi đổi tên thành `.migrated`.
- Nếu server dừng giữa tác vụ, lần khởi động sau run được đánh dấu `failed/SERVER_RESTARTED`, không tự phát lại thao tác chưa chắc chắn.
## Cài đặt trong giao diện

Nút **Cài đặt** ở cuối sidebar cho phép thay đổi model, base URL, max steps và chu kỳ làm mới. Các giá trị không bí mật này được lưu trong SQLite và có hiệu lực cho request model/run mới. API key vẫn chỉ đọc từ `.env.local` và không được trả về browser.

## Release gate

Sau khi cấu hình `SCRCPY_INTEGRATION`, chạy `npm run verify:release`. Lệnh này kiểm tra môi trường, TypeScript, tests, production build, dependency audit, thiết bị thật và manifest scrcpy. Khi tắt server, runner abort model/ADB đang hoạt động và chờ tối đa 4,5 giây trước khi đóng SQLite.

## Chạy schedule sau khi Windows khởi động

Timer schedule chỉ hoạt động khi tiến trình Node đang chạy. Để tự khởi động, tạo Windows Scheduled Task chạy `npm start` trong thư mục dự án, chọn **Run whether user is logged on or not**, trigger **At startup**, và bật tự khởi động lại khi lỗi. Chạy `npm run build` trước khi cấu hình task. Tài khoản chạy task phải có quyền dùng ADB và ghi vào các thư mục log của schedule.
