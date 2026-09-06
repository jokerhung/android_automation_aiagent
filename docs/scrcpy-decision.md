# Quyết định kỹ thuật scrcpy

Trạng thái: **chưa tích hợp, đang bị chặn bởi cổng license/protocol của kế hoạch**.

Ứng dụng cô lập phần điều khiển trong `DeviceControlService`; UI snapshot là fallback hoạt động đầy đủ cho ADB/manual/agent. Trước khi thay bằng stream realtime phải:

1. Review license của ws-scrcpy-web và dependencies.
2. Pin một commit client/relay và đúng binary scrcpy-server tương ứng.
3. Ghi checksum, license và protocol metadata trong `vendor/scrcpy`.
4. Test H.264/WebCodecs, rotation, tap năm điểm, swipe, reconnect, hai serial và cleanup tunnel.
5. Chỉ sau đó thêm namespace `/ws/scrcpy`; không tự phát minh frame protocol.

Ứng viên ưu tiên theo plan: https://github.com/bilbospocketses/ws-scrcpy-web
