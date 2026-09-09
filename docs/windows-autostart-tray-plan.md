# Kế hoạch khởi động cùng Windows và chạy nền có system tray

Ngày lập: 2026-09-09.
Trạng thái: đề xuất triển khai; chưa đăng ký Startup, tạo tiến trình nền hoặc sửa cấu hình Windows.

## 1. Mục tiêu và phạm vi

1. Trong **Cấu hình → Chung**, có công tắc **Khởi động cùng Windows**.
2. Khi người dùng đăng nhập Windows, ứng dụng khởi chạy ngầm, không mở terminal hoặc homepage.
3. Hiển thị icon chữ **A** nền cam trong system tray:
   - **Mở trang chủ**: mở homepage trong trình duyệt mặc định.
   - **Thoát Android Agent**: dừng server và các tiến trình con do ứng dụng sở hữu.
4. Đóng tab trình duyệt không dừng scheduler hoặc server.
5. Tham khảo implementation Windows của 9router, không sao chép nguyên cơ chế quản lý tiến trình.

### Quy ước quan trọng

- “Khởi động cùng Windows” trong MVP nghĩa là **sau khi người dùng đăng nhập**, không chạy trước màn hình đăng nhập. Tray phải thuộc phiên desktop tương tác của người dùng.
- Phạm vi đăng ký: tài khoản Windows hiện tại, mặc định **tắt**, không yêu cầu quyền Administrator.
- Tắt công tắc không dừng instance hiện tại.
- Thoát từ tray không xóa đăng ký autostart; lần đăng nhập tiếp theo vẫn khởi động nếu công tắc còn bật.
- Không tự mở browser khi autostart. Browser chỉ mở khi người dùng chọn Mở trang chủ hoặc double-click icon.
- Không sử dụng Windows Service trong MVP; không chạy trong Session 0.
- Chỉ dùng production build cho chạy nền. Không đưa `npm run dev` hoặc `tsx watch` vào Startup.
- Việc bật autostart trong một phiên dev chỉ đăng ký cho lần đăng nhập sau; không tự dừng hoặc chuyển phiên dev thành background.

## 2. Khảo sát mã nguồn hiện tại

Các điểm tích hợp đã kiểm tra:

- `server.ts`: chuẩn bị Next.js, khởi chạy device monitor/scheduler/scrcpy; chỉ có SIGINT/SIGTERM shutdown. Chưa có lifecycle dùng lại từ tray.
- `package.json`: dev dùng `cross-env NODE_ENV=development tsx watch server.ts`; production dùng `cross-env NODE_ENV=production tsx server.ts`.
- `components/settings-dialog.tsx`: có tab Chung, AI Model, Giới thiệu; form giữ draft và lưu khi bấm Lưu thay đổi.
- `components/app-shell.tsx`: nạp và lưu settings qua API; cần giữ cách đóng/hủy dialog và thông báo lỗi.
- `app/api/settings/route.ts`: schema strict, hiện chưa có autostart.
- `lib/server/runtime-settings.ts`: cấu hình agent, không nên trộn trạng thái đăng ký Windows vào các mặc định số học.
- `lib/server/persistence/session-repository.ts`: database mặc định phụ thuộc `process.cwd()/data/app.db`.
- `lib/server/request-security.ts`: có chế độ ALLOW_LAN; endpoint thay đổi startup cần kiểm soát chặt hơn.
- `docs/setup-windows.md`: đang hướng dẫn Scheduled Task “Run whether user is logged on or not”. Cần phân biệt hoặc thay hướng dẫn này cho chế độ tray.

Rủi ro cần giải quyết trước: chạy hai server trên cùng database có thể thực hiện phục hồi run/scheduler trước khi phát hiện trùng port. Chống trùng phải diễn ra **trước khi khởi tạo repository và service**.

Lịch sử lỗi terminal trong workspace cũng cho thấy cần tách chạy nền khỏi vòng đọc bàn phím của PowerShell tương tác; không coi việc giấu cửa sổ là đã xử lý xong lifecycle.

## 3. Tham khảo 9router

Repository được chọn: `decolua/9router` (không dùng fork 9router-extended).
Snapshot đã đọc: commit `eb712ca821f0ba6bc41043fbd14494c5af5daba5`, nhánh master tại thời điểm khảo sát.

| Nguồn đã đọc | Cách 9router thực hiện | Áp dụng cho Android Agent |
|---|---|---|
| [autostart.js](https://github.com/decolua/9router/blob/eb712ca821f0ba6bc41043fbd14494c5af5daba5/cli/src/cli/tray/autostart.js) | Windows ghi file VBS vào Startup, gọi Node và CLI bằng đường dẫn tuyệt đối, cửa sổ ẩn; kiểm tra bật bằng sự tồn tại của file | Giữ đăng ký theo user và kiểm tra đường dẫn; dùng shortcut thay VBS, đọc lại target để xác minh |
| [trayWin.js](https://github.com/decolua/9router/blob/eb712ca821f0ba6bc41043fbd14494c5af5daba5/cli/src/cli/tray/trayWin.js) | Spawn PowerShell ẩn, gửi command qua stdin, đọc click event JSON từ stdout | Tách adapter tray; bổ sung readiness, timeout và lỗi có thể quan sát |
| [tray.ps1](https://github.com/decolua/9router/blob/eb712ca821f0ba6bc41043fbd14494c5af5daba5/cli/src/cli/tray/tray.ps1) | WinForms NotifyIcon, context menu, tooltip; nhận lệnh rồi dispose khi thoát | Dùng NotifyIcon với logo A; đọc IPC không chặn UI thread |
| [tray.js](https://github.com/decolua/9router/blob/eb712ca821f0ba6bc41043fbd14494c5af5daba5/cli/src/cli/tray/tray.js) | Menu mở dashboard, bật/tắt startup, quit; dispatch callback và cleanup tray | MVP chỉ cần trạng thái, Mở trang chủ, Thoát; toggle nằm trong Cấu hình |
| [cli.js](https://github.com/decolua/9router/blob/eb712ca821f0ba6bc41043fbd14494c5af5daba5/cli/cli.js) | Có nhánh tạo background detached, stdio ignore, windowsHide và unref | Tách launcher khỏi terminal, chờ xác nhận khởi động trước khi báo thành công |
| [trayRuntime.js](https://github.com/decolua/9router/blob/eb712ca821f0ba6bc41043fbd14494c5af5daba5/cli/hooks/trayRuntime.js) | Windows dùng PowerShell, không cài systray binary như các nền tảng khác | Không thêm Electron hay tải binary tray ở runtime |
| [LICENSE](https://github.com/decolua/9router/blob/eb712ca821f0ba6bc41043fbd14494c5af5daba5/LICENSE) | MIT | Nếu lấy code, giữ notice và ghi attribution; icon tự dùng thương hiệu ứng dụng |

Không kế thừa những điểm sau:

- Không nuốt lỗi tray hoặc coi spawn thành công là icon đã sẵn sàng.
- Không force-exit sau một khoảng chờ ngắn bất chấp việc agent/database chưa dọn xong.
- Không kill process chỉ dựa trên port hoặc tên `node.exe`, `adb.exe`.
- Không đọc `Console.In.Peek()/ReadLine()` đồng bộ trên UI timer: pipe có thể chặn giao diện.
- Không dùng giá trị phủ định của state cũ để báo toggle thành công; phải xác minh hệ điều hành.

## 4. Kiến trúc đề xuất

```text
Đăng nhập Windows / lệnh mở background thủ công
  → shortcut Startup của user
  → launcher Windows ẩn
  → Node background host (production, độc lập terminal)
      ├─ Next.js + HTTP/SSE + scheduler + agent + scrcpy
      └─ PowerShell WinForms tray helper
            ├─ Mở trang chủ → browser mặc định
            └─ Thoát → IPC → shutdown chung của Node host
```

Node host sở hữu server và helper; helper không tự đọc SQLite hoặc tự chạy agent. Không dựng server mới trong process tray.

### 4.1. Entry point và môi trường

- Tạo entry riêng `scripts/background-host.ts`; dùng lại lifecycle từ server.
- Launcher gọi trực tiếp đường dẫn tuyệt đối của `node.exe`, loader `tsx` và entry, không qua npm/cmd/watch. Chốt cú pháp loader trong spike trên dependency đang cài.
- Đặt `NODE_ENV=production`, `cwd=appRoot` và nạp đúng `.env.local` trước mọi import khởi tạo database/service.
- Giữ database và cấu hình hiện có trong repo; không tự di chuyển `data/` ở MVP.
- Metadata của launcher, lock và log background lưu ở thư mục user-owned, ví dụ `%LOCALAPPDATA%/AndroidAgent/<installationId>/`.
- `installationId` gắn với đường dẫn cài đặt chuẩn hóa; metadata ghi absolute appRoot, nodePath và phiên bản entry.
- Khi autostart, không cần venv Python đã activate. ADB và các executable phụ thuộc phải được resolve/kiểm tra rõ ràng.
- Trước khi đăng ký: kiểm tra production build, dependencies, icon, đường dẫn Node, khả năng ghi log và helper.
- Không tự build, npm install, update dependency hoặc tải code mỗi lần đăng nhập.

### 4.2. Tách chế độ foreground/background

- `npm run dev`: giữ phục vụ phát triển; không tự tạo tray hoặc đăng ký Startup.
- `npm start`: giữ chạy production foreground.
- Dự kiến thêm `npm run background:start`, `background:status`, `background:stop`.
- Lệnh start nền chỉ trả thành công khi host báo sẵn sàng; đóng terminal sau đó không làm server thoát.
- Chế độ background không dùng stdin terminal, không load PSReadLine, không gọi Console.ReadKey.
- Không tuyên bố sửa lỗi terminal Ctrl+C của dev chỉ bằng tính năng này; đó là nhánh lỗi riêng.

## 5. Đăng ký khởi động cùng Windows

### 5.1. Cơ chế mặc định

Đề xuất shortcut `Android Agent - <installationId>.lnk` trong Startup **current user**, trỏ tới launcher ẩn với WorkingDirectory cố định. Windows hỗ trợ ứng dụng khởi chạy lúc đăng nhập qua Startup folder. [Microsoft: Startup applications](https://support.microsoft.com/en-us/windows/experience/startup-boot/configure-startup-applications-in-windows)

Không chọn VBS làm dependency mặc định vì Microsoft đã công bố lộ trình deprecate VBScript. Đây là khác biệt chủ ý với code 9router, không phải giả định VBS luôn khả dụng trên Windows mới. [Microsoft: VBScript deprecation](https://techcommunity.microsoft.com/blog/windows-itpro-blog/vbscript-deprecation-timelines-and-next-steps/4148301)

- Resolve Startup qua Known Folder API/.NET của user, không nối đường dẫn từ APPDATA rỗng.
- Dùng COM tạo shortcut từ script cố định; chỉ truyền tham số đã validation, không nội suy thành shell command tùy ý.
- Launcher PowerShell: `-NoProfile -NonInteractive -WindowStyle Hidden`; spawn Node bằng ProcessStartInfo với `UseShellExecute=false`, `CreateNoWindow=true`, cwd và redirection rõ ràng.
- Không thay execution policy toàn máy. Nếu policy chặn script, báo unsupported/blocked thay vì tự hạ bảo mật.
- Kiểm tra trên Windows 10/11 không có console nháy lên. Nếu shortcut/PowerShell không đạt, dùng launcher nhỏ loại Windows GUI subsystem được build từ source và review/sign trong pipeline; phải chốt ở Phase 0 trước khi rollout.

### 5.2. Bật/tắt và nguồn trạng thái

- Mặc định tắt nếu chưa có registration của chính installation này.
- Bật: preflight → tạo shortcut tạm → replace file riêng của app → đọc lại TargetPath/Arguments/WorkingDirectory.
- Tắt: chỉ xóa shortcut đã xác minh đúng app/installation. Không xóa cả Startup folder, không đụng mục của 9router hay installation khác.
- Serialize enable/disable trong service; thao tác lặp lại phải idempotent.
- UI đọc trạng thái OS, không chỉ dựa trên boolean SQLite. Nếu giữ preference thì phân biệt desired/effective.
- Nếu Windows Startup settings vô hiệu hóa entry bên ngoài app, cần phản ánh nếu đọc được; nếu không xác minh được, trả trạng thái unknown kèm hướng dẫn kiểm tra, không nói chắc enabled.
- Di chuyển repo/đổi Node: hiển thị registration invalid và yêu cầu đăng ký lại, không âm thầm sửa đường dẫn trong lần boot.
- Uninstall/cleanup chỉ gỡ đăng ký và metadata do installation sở hữu; giữ database, prompts và log job.

## 6. UI: Cấu hình → Chung

Thêm hàng theo style hiện tại:

- Nhãn: **Khởi động cùng Windows**.
- Mô tả: “Chạy nền và hiển thị biểu tượng ở khay hệ thống sau khi bạn đăng nhập.”
- Switch có accessible label, keyboard Space, focus ring.
- Ghi chú: “Tắt tùy chọn này không dừng ứng dụng đang chạy.”

Hành vi:

1. Mở dialog: nạp cấu hình hiện tại và status autostart song song.
2. Toggle chỉ sửa draft; áp dụng khi bấm **Lưu thay đổi**.
3. Hủy/Escape không thay đổi Startup.
4. Trong khi apply, khóa toggle/nút lưu để tránh request chồng.
5. Nếu đăng ký lỗi, giữ dialog và thông báo cụ thể; không hiển thị thành công.
6. Nền tảng không phải Windows, thiếu interactive desktop hoặc môi trường remote không được phép: switch disabled và giải thích.
7. Có thể hiển thị trạng thái “Chạy nền / Chạy foreground / Chưa sẵn sàng”, nhưng không tự chuyển foreground đang có job sang nền.

Không thêm autostart thành giá trị gửi nhầm vào schema settings strict hiện tại. Trạng thái runtime/readiness không phải trường editable.

## 7. API và bảo mật

Đề xuất endpoint riêng:

- `GET /api/system/autostart`: status và capability, không trả secret.
- `PATCH /api/system/autostart`: body strict `{ enabled: boolean }`.
- Các lệnh mở trang chủ/thoát dùng IPC nội bộ, **không mở HTTP /shutdown công khai**.

Contract tham khảo:

```ts
type AutostartStatus = {
  supported: boolean;
  enabled: boolean | null; // null khi không thể xác minh
  registration: "absent" | "valid" | "invalid" | "unknown";
  backgroundReady: boolean;
  reason?: string;
};
```

Lưu form có hai miền: settings SQLite và registration OS, không có transaction xuyên hai miền:

- Lưu settings trước; chỉ gọi autostart PATCH nếu người dùng đổi toggle.
- Nếu autostart lỗi sau khi settings thành công, báo rõ phần đã lưu/phần chưa lưu; giữ toggle dirty để retry và refetch status.
- Không báo lỗi chung khiến người dùng tưởng toàn bộ thay đổi được rollback.

Bảo vệ endpoint:

- Chỉ cho quản lý startup trên loopback; không kế thừa ngoại lệ ALLOW_LAN.
- Kiểm tra Host/Origin và địa chỉ peer thực từ HTTP server; không tin X-Forwarded-For do client đặt. Thiết kế cầu nối peer context ở custom server trong Phase 0.
- Yêu cầu Origin same-origin cho mutation từ browser; dùng token phiên quản trị cục bộ chống CSRF, không lưu trong URL hoặc log.
- Schema strict, giới hạn kích thước body, rate limit, timeout lệnh OS.
- Server tự xác định đường dẫn, tên shortcut, port hợp lệ; client không truyền command, PID, exePath hay startupPath.
- IPC chỉ chấp nhận action trong allowlist, xác thực identity của instance. Named pipe/metadata phải giới hạn quyền theo Windows user; localhost không được xem là đủ cho endpoint tắt tiến trình.

## 8. System tray

### 8.1. Helper Windows

Tham khảo adapter Node + WinForms của 9router; NotifyIcon cung cấp icon, context menu và sự kiện double-click. [Microsoft: NotifyIcon](https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.notifyicon?view=windowsdesktop-9.0)

- Helper chạy STA, NoProfile, NonInteractive, WindowStyle Hidden; không tạo cửa sổ terminal.
- Icon A nền cam dạng ICO nhiều kích thước 16/20/24/32/48 để kiểm tra DPI; không dùng icon 9router.
- Menu: trạng thái read-only, **Mở trang chủ**, separator, **Thoát Android Agent**.
- Double-click tương đương Mở trang chủ.
- Browser URL do server sinh: `http://127.0.0.1:<port>/`, không dựa vào dữ liệu click tùy ý.
- Chỉ bật Mở trang chủ khi server sẵn sàng; debounce double-click.
- Browser không mở được: thông báo URL trong lỗi có thể xem được, không crash tray.

### 8.2. IPC và readiness

- Node ↔ helper: JSON-lines trên pipe, giới hạn kích thước message; dùng action ID ổn định thay vì phụ thuộc thứ tự menu.
- Command: initialize, set-status, confirm-quit, dispose.
- Event: ready, open-home, quit-requested, quit-confirmed, error, disposed.
- Reader đọc bất đồng bộ/background rồi marshal sang UI thread; không chặn WinForms message loop.
- Node chỉ báo `backgroundReady=true` khi server-ready **và** tray-ready.
- Tray startup deadline đề xuất 10 giây; host readiness tổng thể 30 giây.
- Lỗi không bị nuốt: log redacted + status rõ ràng; thất bại khởi tạo thì rollback instance mới.
- Helper mất Node pipe/heartbeat: dispose icon và thoát. Node mất helper: thử tạo lại tối đa hai lần có backoff; nếu vẫn lỗi thì graceful shutdown để tránh server chạy ẩn không có đường điều khiển.
- Explorer restart: kiểm tra icon được tái đăng ký; nếu WinForms runtime không tự phục hồi, xử lý TaskbarCreated.

## 9. Single instance và quyền sở hữu tiến trình

- Khóa theo appRoot/database chuẩn hóa trước khi import module mở SQLite, áp dụng cả dev, foreground production và background.
- MVP một installation hoạt động trên một máy tại một thời điểm. Với nhiều user, kiểm tra lock file trong dataDir và identity owner; không chỉ dùng Local mutex theo session.
- Lock file atomic chứa PID, thời điểm khởi tạo process, mode, instance ID; kết hợp IPC liveness để chống PID tái sử dụng.
- Khi trùng instance background: launcher mới trả status instance hiện có; autostart không tự mở browser, không spawn icon thứ hai.
- Khi foreground/dev đang giữ database: không takeover, không dừng tiến trình người dùng; báo conflict.
- Khi port bị ứng dụng khác chiếm: báo lỗi và dọn instance mới; không kill theo port và không tự đổi port âm thầm.
- Lock stale chỉ được thu hồi sau xác minh process/identity không còn; trạng thái không chắc chắn phải fail closed.
- Nếu nâng cấp bản cũ chưa có lock, nhận diện server cũ trên port trước khi động tới database; yêu cầu người dùng dừng bản cũ, không tự chiếm quyền.
- Chỉ terminate process handle/PID+start-time thuộc instance này. Không dùng `taskkill /IM node.exe`, không kill ADB daemon dùng chung, không đóng PowerShell/VS Code của user.

## 10. Shutdown dùng chung

Tách `startApplication()` và `shutdown(reason)` thành lifecycle idempotent, dùng cho SIGINT, SIGTERM, tray Quit, mất helper và logoff.

Trình tự:

1. Khi người dùng chọn Quit và có job đang chạy, tray hiện xác nhận “Thoát sẽ dừng N tác vụ đang chạy”; bấm Hủy không đổi trạng thái ứng dụng. Chỉ bắt đầu shutdown sau khi xác nhận.
2. Chuyển trạng thái stopping; từ chối run mới và lần tick/retry mới.
3. Dừng timer, chờ tick/poll đang xử lý; chặn race tạo run trong lúc shutdown.
4. Abort model/ADB của các run thuộc app, chờ cleanup và ghi trạng thái terminal/log.
5. Đóng SSE, WebSocket và stream do app quản lý; không dừng adb daemon toàn máy.
6. Chờ HTTP đóng và Next.js `app.close()`; quản lý socket persistent/upgraded để không treo.
7. Chờ tác vụ ghi log/persistence, đóng SQLite sau cùng.
8. Yêu cầu tray dispose, chờ ack/exit, xóa lock/metadata thuộc instance và thoát.

Thiết lập deadline tổng đề xuất 10 giây; khi timeout ghi rõ bước còn treo, chỉ force-stop các process của instance. Không clear timeout trước khi việc dọn tài nguyên hoàn tất.

Nếu Windows logoff/shutdown không còn thời gian hiển thị xác nhận, thực hiện dừng có giới hạn thời gian. Lần mở sau reconcile run bị gián đoạn theo logic hiện tại; không tự phát lại hành động Android chưa biết kết quả.

## 11. Log và xử lý lỗi

- Log background theo installation trong LOCALAPPDATA, rotate theo ngày hoặc 5 MB, giữ tối đa 7 file.
- Ghi lifecycle/readiness/exit code, không ghi API key, toàn bộ env hoặc prompt nhạy cảm.
- Không dùng stdio inherit từ terminal; stdout/stderr đi vào log có redaction.
- Các mã lỗi dự kiến: BUILD_MISSING, NODE_MISSING, STARTUP_BLOCKED, STARTUP_WRITE_FAILED, REGISTRATION_INVALID, ALREADY_RUNNING, PORT_IN_USE, TRAY_START_FAILED, SHUTDOWN_TIMEOUT.
- Server lỗi khởi động: đóng helper, release lock của chính mình, lưu lỗi; không restart vô hạn.
- Server lỗi sau khi ready: không tự chạy lại agent; exit có log. Auto-restart server không nằm trong MVP để tránh phát lại job.
- Có lệnh status/stop dự phòng dùng cùng authenticated IPC, cho trường hợp icon bị ẩn trong overflow hoặc Explorer đang phục hồi.

## 12. Các file dự kiến

```text
components/settings-dialog.tsx          # switch + draft + status
components/app-shell.tsx                # load/save hai miền có partial failure
app/settings.css                       # switch phù hợp style tab Chung
app/api/system/autostart/route.ts       # API strict, loopback/admin guard
lib/contracts/system.ts                # status + mutation schema
lib/server/application-lifecycle.ts     # start/stop dùng chung
lib/server/windows/autostart.ts         # registration current-user
lib/server/windows/tray-controller.ts   # helper lifecycle, JSON IPC
lib/server/windows/instance-lock.ts     # ownership, single instance
lib/server/windows/background-status.ts # readiness và metadata
scripts/background-host.ts             # production background entry
scripts/background-cli.cjs             # start/status/stop
scripts/windows/launch-background.ps1   # no-window launcher
scripts/windows/tray.ps1                # STA NotifyIcon
scripts/windows/autostart.ps1           # thao tác shortcut có kiểm soát
assets/tray/android-agent.ico           # icon A
server.ts                              # dùng lifecycle và lock trước side effect
package.json                           # lệnh background và test
docs/setup-windows.md                   # hướng dẫn logon/tray thay task cũ
docs/third-party-notices.md             # nếu có code phái sinh 9router
```

Chưa chốt thêm dependency runtime. Nếu phải dùng native launcher, cập nhật danh sách và quy trình build/sign ở Phase 0.

## 13. Kế hoạch triển khai

### Phase 0 — Spike Windows và chốt lựa chọn

- Chứng minh launcher thực sự không có cửa sổ/console flash và không phụ thuộc terminal.
- Chứng minh NotifyIcon, IPC không block UI, readiness và dispose trên PowerShell không PSReadLine.
- Chốt quyền current-user, đọc trạng thái entry bị Windows disable, peer context cho API, khóa cross-session.
- Chốt packaging production có tsx/better-sqlite3/vendor scrcpy và đường dẫn độc lập cwd.
- Chỉ dùng test app/mock trong spike, chưa đăng ký autostart app thật.

### Phase 1 — Lifecycle và instance safety

- Refactor startup/shutdown, bind/lock trước side effect.
- Shutdown chặn run mới, chờ scheduler/agent/log/database đúng thứ tự.
- Unit test lỗi từng bước, timeout, stale lock, PID reuse, foreign port.

### Phase 2 — Background host và tray

- Hoàn thiện launcher, controller, icon và protocol.
- Thử mở homepage/thoát, đóng terminal vẫn sống, tray chết/Explorer restart.
- Có lệnh status/stop để phục hồi.

### Phase 3 — Autostart service và API

- Đăng ký current-user shortcut idempotent; trả effective status.
- Preflight, readback, rollback, strict local guard.
- Không can thiệp service/task mà người dùng đã tự cấu hình trước đó.

### Phase 4 — Cấu hình → Chung

- Thêm switch, giữ draft, Hủy không side effect.
- Save và lỗi từng miền rõ ràng; refresh effective state sau apply.
- Unsupported/blocked state có hướng dẫn.

### Phase 5 — QA và hướng dẫn vận hành

- Typecheck, unit/integration test, build production.
- UI test bằng mock cho toggle/save/cancel/error.
- Test logon thật cần user đồng ý trước khi thêm Startup hoặc đăng xuất/reboot.
- Cập nhật setup và hướng dẫn xử lý khi repo/Node thay đổi.

## 14. Ma trận kiểm thử và nghiệm thu

| Nhóm | Trường hợp bắt buộc |
|---|---|
| Autostart | Default off; bật/tắt lặp lại; Hủy draft; permission denied; shortcut sai target; thiếu APPDATA/Known Folder; entry disabled bên ngoài |
| Launch | Node/app path có khoảng trắng/Unicode; cwd ban đầu System32; thiếu build/dependency; không có venv; không ADB/không mạng |
| Isolation | Foreground và background cùng port/database; hai lần logon/start; PID reuse; process khác chiếm port; nhiều user |
| Tray | Ready handshake; timeout; mở homepage đúng port; double-click; menu Quit/Hủy; helper crash; Explorer restart; DPI 100/150/200% |
| Shutdown | Idle; job manual/scheduled chạy; waiting_device; đang ghi log; SSE/WS mở; signal lặp; timeout; không kill process ngoài app |
| UI/API | Draft giữ qua tabs; chỉ Save mới áp dụng; partial save; malformed body; LAN request; cross-origin mutation; request giả mạo PID/path |
| Recovery | Đóng browser server vẫn sống; đóng terminal server vẫn sống; shutdown giữ dữ liệu; mở lại không phát lại run cũ; stale metadata |

Tiêu chí hoàn thành:

- [ ] Bật/tắt từ Cấu hình → Chung được xác minh với registration Windows.
- [ ] Đăng nhập tự chạy production background, không mở terminal hoặc browser.
- [ ] Có một tray icon A cho một instance; Mở trang chủ hoạt động.
- [ ] Thoát dừng đúng server/agent/helper, giải phóng port và không ảnh hưởng app khác.
- [ ] Tắt autostart không dừng job hiện tại; Quit không tự bỏ autostart.
- [ ] Không cần Admin, không hạ execution policy toàn máy, không lưu secret vào shortcut/command/log.
- [ ] Khi tray không sẵn sàng, không báo background đã thành công.
- [ ] Dữ liệu SQLite và log được giữ, các test tự động không chạm Startup/database thật.
- [ ] Hoàn thành QA đăng nhập và tray thực tế trên Windows 10/11.

## 15. Ngoài phạm vi

- Windows Service chạy trước đăng nhập hoặc dưới SYSTEM.
- Tự đăng nhập Windows, đánh thức máy, chạy khi máy tắt.
- Autostart macOS/Linux.
- Tự cập nhật ứng dụng/dependency.
- Kill ADB daemon chung hoặc process không thuộc ứng dụng.
- Tự migrate task/service/Startup do người dùng tạo thủ công.
- Đóng browser tab thay người dùng khi Quit.
- Sửa lỗi PSReadLine của phiên dev như điều kiện thay thế cho thiết kế chạy nền.
