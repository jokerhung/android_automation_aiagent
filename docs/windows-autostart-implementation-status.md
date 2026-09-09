# Windows autostart/tray — implementation status

This is a working verification record, not completion approval.

Round 20 status: typecheck passed and full suite 149/149 tests in 33 files passed. Absolute-only ANDROID_AGENT_DATABASE_PATH contract is enforced. Production build previously passed using a temporary database. Real isolated tray, disconnect, launcher and ACL smoke tests passed. Full production host HTTP/shutdown smoke has NOT been performed. Lifecycle still needs bind-before-service-import, scheduler/event/log drain and integrated total shutdown deadline. Do not deploy autostart as complete until these are implemented and verified.

## Implemented and tested so far

- General settings draft-only accessible switch; unsupported state and status guidance.
- Separate autostart API payload; settings saved first with explicit partial failure and retry.
- Offline component + full-shell browser mock tests pass, no Startup/database/ADB effects.
- Strict local-peer/Host/Origin/CSRF guard; shared process security state across Next bundles.
- Unit tests for spoofed peer, DNS rebinding host, wrong port, separate bundle state, metadata ownership and live lock conflict.
- Package background commands wired; operation guide replaces noninteractive Scheduled Task recommendation.

## Must verify/fix before completion

- Tray isolated real readiness/dispose smoke now PASS after font constructor and unbuffered Console.Out protocol fixes.
- Hidden launcher isolated real mock-host smoke PASS with Unicode/spaces and unrelated cwd after converting tsx loader path to file URI. No Startup/database used.
- Launcher loader URI and stdio/logging; no production background success until server + tray ready.
- Exact Windows ACL real+mock tests now pass: seeded foreign ACE removal, current-user-only file, parent ACL unchanged. Shared lock regression confirms private IPC token not serialized. Integration cleanup still to verify.
- Bind/lock before database side effects, stale lock identity safety.
- Shutdown deadline, drain scheduler/event/log writes, admission gate for new runs, helper loss handling.
- Autostart current-user shortcut temp .lnk/readback/rollback, effective disabled status, policy handling and abort signal propagation.
- Isolated production HTTP trust bridge smoke without real database or Startup writes.
- Round 2: full test suite 122/122 across 24 files passed after registration hardening; PowerShell syntax passed. Final build and production integration still pending backend lifecycle fixes.
- Registration enable now preflights desktop/dependency files/log writability, validates temporary .lnk before installation, and restores prior owned shortcut on readback failure. Real Startup mutation not tested or enabled.

## Tray disconnect verification

`node scripts/verify-windows-tray-disconnect.cjs` passed using the real WinForms helper: close parent input after ready, receive disposed, helper exits code 0. No server/database/Startup/browser is opened.

## Read-only OS verification

`npx tsx scripts/verify-autostart-status.ts` passed strict status schema against current Windows: supported=true, enabled=false, registration=absent, backgroundReady=false. This only reads current-user registration and does not create/remove shortcuts.

## Manual QA remaining

Actual Startup registration/logon requires separate user consent. No real Startup registration, logoff, reboot, Windows policy change or production database smoke has been performed. Windows 10/11 no-console-flash, Explorer restart, DPI, actual tray menu and logon are not yet verified.
