# Quyết định kỹ thuật scrcpy

Trạng thái: **GPLv3 đã được người dùng chấp thuận và realtime scrcpy đã được tích hợp**.

## Bộ phiên bản đã xác minh

- ws-scrcpy-web: tag `v0.1.30-beta.103`
- Commit: `269c97b9373b17ff6fdd53a377394cdf256222cb`
- License: **GPL-3.0-only**
- Node: `>=24` (máy hiện tại dùng Node 24)
- WebSocket dependency: `ws 8.21.3`
- Genymobile scrcpy-server: `4.1`, Apache-2.0
- SHA-256 scrcpy-server JAR: `deacb991ed2509715160ffdc7907e47b4160eb30d1566217e9047fd5b8850cae`

Nguồn tham chiếu:

- https://github.com/bilbospocketses/ws-scrcpy-web/releases/tag/v0.1.30-beta.103
- https://github.com/bilbospocketses/ws-scrcpy-web/commit/269c97b9373b17ff6fdd53a377394cdf256222cb
- https://github.com/Genymobile/scrcpy/releases/tag/v4.1

## Kết luận

API `WsScrcpy.startStream(container, deviceId, options)`, WebCodecs, relay Node và vanilla scrcpy-server phù hợp với kiến trúc trong plan. Tuy nhiên dự án không có package npm cài trực tiếp; cần build browser artifact và port relay từ source đã pin.

Nếu copy/link/bundle client và relay vào ứng dụng này rồi phân phối, toàn bộ distribution kết hợp nhiều khả năng phải đáp ứng GPLv3: cung cấp corresponding source, build scripts, license text và notices, đồng thời không áp thêm hạn chế không tương thích GPLv3.

## Hai hướng được phép triển khai

### A. Chấp nhận GPLv3

1. Pin tag/commit nêu trên, không dùng nhánh `main`.
2. Vendor source cần thiết cùng GPLv3 và third-party notices.
3. Vendor đúng scrcpy-server 4.1 và kiểm tra SHA-256 khi khởi động.
4. Thêm `/ws/scrcpy` vào custom server với token ngắn hạn gắn serial, kiểm tra Origin/Host.
5. Client adapter gọi `startStream`; H.264, video-only trước.
6. Test rotation, năm điểm tap, swipe, reconnect, hai serial và cleanup tunnel/process.

### B. Không chấp nhận GPLv3

Không copy/link `ws-scrcpy-web`. Chọn một trong các hướng:

- Xin giấy phép riêng từ các chủ sở hữu copyright cần thiết.
- Clean-room adapter cho vanilla scrcpy 4.1 dựa trên tài liệu Apache-2.0.
- Sidecar độc lập sau khi legal review; hướng này không còn đúng yêu cầu “một server, không iframe” của plan.

Không dùng NetrisTV/ws-scrcpy 0.8.1 làm fallback mặc định dù là MIT vì nó dựa trên scrcpy-server fork 1.19-ws5 cũ, thiếu các đảm bảo lifecycle/security cần thiết.

## Trạng thái hiện tại

Ứng dụng dùng ws-scrcpy-web đã pin cho realtime UI, video H.264 và control channel; snapshot ADB vẫn giữ làm fallback/AI capture. `DeviceControlService` vẫn là cổng thao tác agent và fallback ADB. Corresponding source và build instructions nằm trong `vendor/ws-scrcpy-web` và `docs/GPL-DISTRIBUTION.md`.
## Kiểm tra tự động

Chạy `npm run scrcpy:check`. `gplv3` và `snapshot` hiện operational. `clean-room` vẫn trả exit code 3 vì chưa triển khai. Manifest pin nằm ở `vendor/scrcpy/manifest.json`.

