# Cài đặt và chạy trên Windows

## Yêu cầu
- Node.js 22+ (đã kiểm tra với Node 24)
- Android Platform Tools và lệnh `adb` trong PATH
- Điện thoại bật Developer options, USB debugging và đã xác nhận RSA
- API OpenAI-compatible hỗ trợ vision + JSON Schema để chạy agent

## Khởi động
1. Sao chép `.env.example` thành `.env.local`, điền `OPENAI_API_KEY`, model và base URL.
2. Chạy `npm install`.
3. Chạy `npm run dev`.
4. Mở http://127.0.0.1:3000.

## Trạng thái tích hợp màn hình
MVP hiện dùng snapshot PNG qua ADB (tự refresh) và ánh xạ tap/swipe trực tiếp. Adapter scrcpy chưa được vendored vì kế hoạch yêu cầu review license và khóa đồng bộ client/server trước khi tích hợp. Không ghép tùy tiện các phiên bản protocol. Xem `docs/scrcpy-decision.md`.

## Checklist thiết bị thật
- `adb devices -l` hiển thị đúng serial và trạng thái.
- Một thiết bị online được tự chọn; nhiều thiết bị yêu cầu chọn serial.
- Tap tâm/bốn góc, swipe, Back/Home/Recents, Power, Volume +/-.
- Chạy goal; kiểm tra pause/resume/cancel và không có action sau cancel.
- Rút/cắm USB, xoay màn hình, reload trang và restart server.
- Xác minh lịch sử ở `data/sessions.json` được phục hồi.
