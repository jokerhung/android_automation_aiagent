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

Timer schedule chỉ hoạt động khi tiến trình Node đang chạy. Chế độ tray sử dụng phiên desktop **sau khi đăng nhập**, không phải Windows Service hoặc Session 0.

1. Cài dependencies đầy đủ và chạy `npm run build` trước khi sử dụng chạy nền.
2. Trong **Cấu hình → Chung**, bật **Khởi động cùng Windows** rồi bấm **Lưu thay đổi**. Mặc định tắt. Hủy hoặc Escape không đăng ký Startup.
3. Shortcut chỉ thuộc tài khoản hiện tại và installation này, không cần Administrator. Khi đăng nhập, không tự mở trang chủ.
4. Đóng tab browser không dừng lịch chạy. Dùng icon **A** nền cam ở system tray để mở trang chủ hoặc thoát ứng dụng.
5. Tắt công tắc không dừng instance hiện tại. Thoát từ tray không gỡ autostart.

Không cấu hình thêm Scheduled Task `Run whether user is logged on or not` cho tray: phiên không tương tác không hiển thị icon. Task/service do bạn tạo thủ công trước đây không được ứng dụng tự xóa; hãy tự dừng/gỡ nếu chúng gây trùng instance. Không bật tự restart server vì có thể phát lại tác vụ không rõ kết quả.

Xem `docs/windows-background.md` để biết lệnh vận hành, lỗi readiness và checklist kiểm thử Windows.
