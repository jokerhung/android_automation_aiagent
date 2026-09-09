# Windows background và system tray

## Phạm vi

Autostart mặc định tắt, chỉ đăng ký cho Windows user hiện tại. Đây là khởi chạy **sau đăng nhập**, không phải Windows Service. Cần desktop tương tác và production build. Không cần Administrator, không hạ execution policy, không tự cài dependency hoặc build khi đăng nhập.

## Cấu hình

- Cài dependencies đầy đủ, bao gồm runtime TypeScript loader `tsx`, SQLite native binding và vendor scrcpy theo hướng dẫn dự án.
- Chạy `npm run build`; đảm bảo Node và ADB resolve được ngoài terminal/venv.
- Mở **Cấu hình → Chung → Khởi động cùng Windows**, chọn trạng thái rồi **Lưu thay đổi**.
- Hủy/Escape không thay đổi Startup. Tắt công tắc không dừng job hiện tại. Thoát tray không gỡ autostart.
- Settings SQLite được lưu trước, Startup sau. Nếu Startup lỗi, dialog báo rõ settings đã lưu, giữ draft để thử lại.
- Trạng thái unknown/invalid không được coi là enabled: kiểm tra Windows Settings → Apps → Startup và đăng ký lại khi đường dẫn repo/Node thay đổi.

## Vận hành

```powershell
npm run background:start
npm run background:status
npm run background:stop
```

Start chỉ thành công khi host và tray đều ready. Status/stop dùng IPC nội bộ của installation, không có HTTP shutdown công khai. Log nằm trong `%LOCALAPPDATA%\AndroidAgent\<installationId>`.

`npm run dev` và `npm start` giữ chế độ foreground; không tự tạo tray hoặc tự chuyển instance đang chạy thành background. Dừng foreground đúng cách trước khi mở background.

Background có một icon **A** nền cam, menu **Mở trang chủ**, **Thoát Android Agent**. Double-click mở trang chủ. Không tự mở browser lúc đăng nhập. Đóng browser không dừng scheduler. Thoát khi có job đang chạy cần xác nhận và dừng các tác vụ do instance sở hữu. Không tắt ADB daemon dùng chung.

Không chạy thêm task/service tự tạo trên cùng database. Ứng dụng không tự xóa task/service của người dùng, không takeover instance khác, không kill theo tên process hoặc port.

## Lỗi thường gặp

- **BUILD_MISSING**: chạy production build trước; không dùng dev cache thay thế.
- **NODE_MISSING** / dependency thiếu: sửa môi trường cài đặt rồi đăng ký lại.
- **STARTUP_BLOCKED / STARTUP_WRITE_FAILED**: kiểm tra policy/quyền user; không dùng bypass hoặc đổi policy toàn máy.
- **REGISTRATION_INVALID**: shortcut không khớp installation hiện tại, Node hoặc repo đã di chuyển.
- **ALREADY_RUNNING / PORT_IN_USE**: dừng instance/ứng dụng đang chiếm tài nguyên bằng cách của chính nó.
- **TRAY_START_FAILED**: desktop tương tác/WinForms/tray chưa ready; không coi server ẩn không icon là chạy nền thành công.
- **SHUTDOWN_TIMEOUT**: xem lifecycle log; lần khởi động sau reconcile run gián đoạn, không phát lại Android action không rõ kết quả.

## Database cô lập khi kiểm thử

Biến `ANDROID_AGENT_DATABASE_PATH` cho phép chỉ định database riêng; lock phải cùng định danh database đã chuẩn hóa, kể cả đường dẫn junction/symlink. Khi kiểm thử production, đặt đường dẫn tuyệt đối vào thư mục tạm và đặt `LOCALAPPDATA` riêng trước khi khởi động. Không dùng database thật cho smoke test. Thay database cũng thay installation identity; không đổi tùy tiện khi đã đăng ký autostart.

## Kiểm thử không gây side effect

### Chẩn đoán Startup và mở trang chủ (2026-09-09)

- Shortcut hợp lệ nhưng chưa có bản ghi Explorer StartupApproved được coi là đã bật;
  không cần tự ghi Registry để tạo trạng thái giả. Bản ghi disabled vẫn được tôn trọng.
- Nếu đọc Registry bị từ chối hoặc gặp định dạng lạ, trạng thái vẫn là unknown và UI
  nói rõ đã đăng ký nhưng chưa xác minh, không đồng nhất với lỗi tạo shortcut.
- Đăng ký thành công không đồng nghĩa production build sẵn sàng. Nếu thiếu
  `.next/BUILD_ID`, dừng phiên dev trước, chạy `npm run build`, rồi
  `npm run background:start`. Không build vào cùng .next khi dev server đang hoạt động.
- Tray mở URL đúng cổng cấu hình bằng Windows HTTP association; helper phải trả
  `HOME_OPENED`. Host ghi request, acknowledgement hoặc stderr/exit failure.
- Lỗi mở homepage hiện thông báo ở tray với URL mở thủ công; log ở
  `%LOCALAPPDATA%/AndroidAgent/<installationId>/background.log`.
- Thay đổi Node host cần khởi động lại instance; đổi source khi host production
  đang chạy không tự cập nhật callback tray. Không tự restart khi còn job.

- `npm run typecheck`, `npm test`, `npm run build`.
- `powershell -NoProfile -File scripts/verify-windows-script-syntax.ps1`: chỉ parse các helper, không thực thi Startup.
- `npx tsx scripts/verify-windows-tray.ts`: tạo tray thử nghiệm ngắn hạn rồi dispose; không mở server/database/browser và không đăng ký Startup. Cần desktop Windows tương tác.
- `node scripts/verify-settings-tabs.cjs`: component mock, keyboard/tabs/draft/save/cancel.
- `node scripts/verify-autostart-settings.cjs`: full shell mock, không gọi server, Startup hoặc ADB; kiểm tra payload strict, thứ tự hai miền, partial failure, retry và unsupported.

## QA desktop bắt buộc trước rollout

Các bài dưới đây cần desktop Windows thật; không thể suy ra từ unit test/build. Đăng ký Startup thật và đăng xuất/reboot chỉ thực hiện sau khi người dùng đồng ý.

- [ ] Windows 10 và 11: đăng nhập tự chạy, không console flash hoặc browser tự mở.
- [ ] Node/app path chứa khoảng trắng/Unicode, cwd ban đầu System32, không venv.
- [ ] Một icon ở DPI 100/150/200%; menu/double-click mở đúng URL; Explorer restart phục hồi.
- [ ] Đóng terminal/browser vẫn sống; tray chết được phục hồi giới hạn hoặc shutdown an toàn.
- [ ] Quit khi idle/có manual run/scheduled run/waiting-device; Hủy xác nhận không dừng job.
- [ ] OS vô hiệu hóa Startup bên ngoài app được phản ánh; bật/tắt lặp lại không ảnh hưởng registration khác.
- [ ] Hai user/instance, foreign port, stale lock/PID reuse fail closed; không ảnh hưởng process khác.
- [ ] Logoff có giới hạn thời gian, dữ liệu/log được giữ; mở lại không tự phát lại job.

Không đánh dấu các mục QA chưa chạy là đã pass.

### Nhật ký triển khai

- UI offline: đã chạy component và full-shell mock; draft/Cancel/Escape, keyboard, partial save, retry và unsupported pass.
- API mock: strict payload và loopback/CSRF được kiểm tra, không chạm Startup.
- Desktop logon/Explorer/DPI/no-console-flash: chưa nghiệm thu; cần người dùng đồng ý trước bài đăng nhập thật.
- Kết quả cuối về tray readiness, launcher và shutdown cần đối chiếu báo cáo kiểm thử, không suy ra từ production build.
