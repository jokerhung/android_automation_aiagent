# Schedule email notification implementation status

Status: **Implemented and automatically verified**.

## Acceptance coverage

- [x] SMTP Settings UI/API with write-only password, explicit clear and Windows DPAPI CurrentUser storage.
- [x] Per-schedule opt-in, default recipient, custom recipient/subject and immutable per-occurrence account snapshot.
- [x] Terminal completed/failed/cancelled report with server-owned UTF-8 attachment, max 100 steps/5 MiB and secret/input redaction.
- [x] Atomic terminal result plus durable outbox insertion; SMTP never runs inside the SQLite transaction.
- [x] Unique occurrence/type delivery, leases, restart reconciliation, 1/5/15-minute retries, four-attempt maximum and stable Message-ID.
- [x] Safe ambiguity handling: expired sending lease and post-DATA uncertainty become delivery_unknown, never automatic blind resend.
- [x] Account identity mismatch becomes blocked_config; same-identity password replacement supports retry.
- [x] Job outcome and scheduler remain independent from report/SMTP/backlog failures.
- [x] Worker runs in foreground/background/autostart and is integrated into bounded shutdown before SQLite close.
- [x] Schedule API/UI/SSE exposes independent email status, recipient, subject, attempts, timestamps and redacted errors; retry never reruns the job.
- [x] Delete warning and cancellation for unsent messages; SMTP-accepted mail is not claimed retractable.
- [x] Global 30 accepted mails/hour and active backlog cap 500; overflow records EMAIL_BACKLOG_LIMIT without failing the job.
- [x] Old schedules default email-off; startup reconciliation is limited to version-1 opted-in terminal snapshots missing an outbox.
- [x] Retention cannot delete occurrences with active or uncertain outbox records.
- [x] Mutation guards enforce loopback peer, exact origin/CSRF and rate limits; Nodemailer disables file/URL attachment access and requires trusted TLS.
- [x] Automated checks use fake senders/in-memory SQLite and do not send real email.

## Verification evidence

- `npm run verify:email`: DPAPI temporary roundtrip, plaintext absence, typecheck, 39 email/schedule tests.
- `npm run verify:windows-syntax`: all six Windows helpers parse, including email-secret.ps1.
- `npm run check`: typecheck, 211/211 tests, production Next.js build.
- `npm audit --omit=dev`: 0 vulnerabilities.

A real SMTP test was intentionally **not** triggered automatically. It remains a user-consented operational check from **Settings → Email → Gửi email thử**, where the recipient is shown and confirmation is required. This preserves the requirement to avoid unintended real email.
