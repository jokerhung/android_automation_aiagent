# Checklist thiết bị thật và release local

Ngày kiểm tra: điền khi chạy `npm run verify:device`.

## Tự động

- [ ] `npm run preflight`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm audit --omit=dev`
- [ ] `npm run scrcpy:check` với quyết định đã duyệt
- [ ] `npm run verify:device`
- [ ] `npm run verify:scrcpy-ui` khi dev server đang chạy

## Thiết bị thật

- [ ] USB debugging đã bật và thiết bị ở trạng thái `device`.
- [ ] Snapshot đúng chiều portrait.
- [ ] Snapshot đúng chiều landscape sau khi xoay.
- [ ] Tap bốn góc vùng nội dung và tâm không chạm letterbox.
- [ ] Swipe và nhập text hoạt động.
- [ ] Home, Back, Enter và Recent Apps hoạt động.
- [ ] Pause cho phép thao tác tay; resume quan sát lại màn hình mới.
- [ ] Cancel không để lại lệnh ADB trong queue.
- [ ] Rút cáp chỉ hủy run/session của đúng serial.
- [ ] Cắm lại thiết bị và tạo stream session mới thành công.
- [ ] Khởi động lại server đánh dấu run dở dang `SERVER_RESTARTED`.

## Ma trận bắt buộc

| Thiết bị | Độ phân giải | Orientation | Snapshot | Tap center | Tap corners | Swipe | Keyboard |
|---|---:|---|---|---|---|---|---|
| Chưa ghi | - | portrait | ☐ | ☐ | ☐ | ☐ | ☐ |
| Chưa ghi | - | landscape hoặc thiết bị thứ hai | ☐ | ☐ | ☐ | ☐ | ☐ |

Realtime scrcpy GPLv3 đã được duyệt và kiểm chứng bằng browser smoke: WebSocket nhận frame thật và player tạo canvas trong Chromium. Vẫn cần kiểm tra thủ công touch/keyboard và rotation theo ma trận trên.
