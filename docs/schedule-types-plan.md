# Kế hoạch mở rộng loại lịch chạy

## 1. Mục tiêu

Mở rộng tính năng lập lịch hiện tại từ một kiểu chạy hằng ngày sang bốn kiểu:

- `Interval`: chạy định kỳ sau mỗi khoảng thời gian.
- `Daily`: chạy mỗi ngày tại một giờ cố định.
- `Weekdays`: chạy từ Thứ Hai đến Thứ Sáu tại một giờ cố định.
- `Weekly`: chạy mỗi tuần vào một thứ và giờ được chọn.

Sau khi người dùng bấm nút **Tạo**, giao diện hiển thị menu chọn loại lịch. Sau khi chọn, modal tạo công việc mở với các trường phù hợp với loại đó.

Việc mở rộng phải giữ nguyên các chức năng hiện có:

- Pause/resume.
- Chạy ngay.
- Sửa và xóa lịch.
- SSE cập nhật giao diện.
- Khóa thiết bị và chống chạy đồng thời.
- Ghi log kết quả.
- Không tạo occurrence trùng khi scheduler tick lại hoặc server khởi động lại.

## 2. Quy ước nghiệp vụ

### 2.1. Các trường chung

Mọi loại lịch đều có:

- Tên công việc.
- Loại lịch.
- Thời điểm bắt đầu.
- Múi giờ.
- Tổng số lần chạy.
- Prompt.
- Thiết bị Android.
- Thư mục log.

Đổi ý nghĩa trường `repeatDays` hiện tại thành `occurrenceLimit`: tổng số occurrence được tính vào lịch. Lệnh **Chạy ngay** không làm tăng số occurrence đã hoàn thành.

Giới hạn đề xuất:

- `occurrenceLimit`: từ 1 đến 365.
- Interval theo phút: tối thiểu 5 phút.
- Interval theo giờ: từ 1 đến 168 giờ.
- Interval theo ngày: từ 1 đến 365 ngày.

### 2.2. Interval

Người dùng cấu hình:

- Ngày bắt đầu.
- Giờ bắt đầu.
- Giá trị khoảng cách `every`.
- Đơn vị `minutes`, `hours` hoặc `days`.

Ví dụ: bắt đầu lúc 08:00 và chạy mỗi 30 phút.

Quy tắc:

- Interval phút/giờ được tính từ thời điểm occurrence đã lên lịch, không tính từ lúc tác vụ kết thúc.
- Interval ngày được tính theo ngày và giờ địa phương để giữ nguyên giờ hiển thị qua thay đổi DST.
- Nếu server bị tắt lâu, không tạo hàng loạt occurrence để chạy bù. Scheduler ghi nhận occurrence bị lỡ theo chính sách hiện có rồi tính mốc tiếp theo.

### 2.3. Daily

Người dùng cấu hình ngày bắt đầu và giờ chạy.

Lịch chạy mỗi ngày tại cùng giờ địa phương cho đến khi đủ `occurrenceLimit`.

Ví dụ: mỗi ngày lúc 08:00.

### 2.4. Weekdays

Người dùng cấu hình ngày bắt đầu và giờ chạy.

Lịch chỉ chạy từ Thứ Hai đến Thứ Sáu. Thứ Bảy và Chủ Nhật được bỏ qua và không làm tăng số occurrence đã hoàn thành.

Ví dụ: nếu occurrence hiện tại là Thứ Sáu, occurrence kế tiếp là Thứ Hai.

### 2.5. Weekly

Người dùng cấu hình:

- Ngày bắt đầu.
- Thứ trong tuần.
- Giờ chạy.

Quy ước thứ dùng ISO-8601:

| Giá trị | Thứ |
|---:|---|
| 1 | Thứ Hai |
| 2 | Thứ Ba |
| 3 | Thứ Tư |
| 4 | Thứ Năm |
| 5 | Thứ Sáu |
| 6 | Thứ Bảy |
| 7 | Chủ Nhật |

Occurrence đầu tiên là ngày đúng thứ được chọn, không sớm hơn ngày bắt đầu.

## 3. Thiết kế contract

Thêm kiểu rule có discriminator rõ ràng:

```ts
export type ScheduleRule =
  | {
      type: "interval";
      every: number;
      unit: "minutes" | "hours" | "days";
    }
  | {
      type: "daily";
    }
  | {
      type: "weekdays";
    }
  | {
      type: "weekly";
      weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
    };
```

Cập nhật `Schedule`:

```ts
export type Schedule = {
  id: string;
  name: string;
  startDate: string;
  localTime: string;
  timezone: string;
  rule: ScheduleRule;
  occurrenceLimit: number;
  prompt: string;
  deviceSerial: string;
  logDirectory: string;
  status: ScheduleStatus;
  nextRunAt: string | null;
  completedOccurrences: number;
  createdAt: string;
  updatedAt: string;
};
```

Không lưu các thuộc tính không áp dụng. Ví dụ `weekday` chỉ tồn tại trong rule `weekly`.

## 4. Validation

Thay `scheduleInputSchema` bằng schema chung kết hợp discriminated union theo `rule.type`.

Validation chung:

- Tên dài từ 1 đến 120 ký tự.
- Ngày đúng định dạng `YYYY-MM-DD` và phải tồn tại.
- Giờ đúng định dạng `HH:mm`.
- Múi giờ là tên IANA hợp lệ.
- `occurrenceLimit` là số nguyên từ 1 đến 365.
- Prompt dài từ 1 đến 10.000 ký tự.
- Serial thiết bị và thư mục log hợp lệ.
- Thời điểm occurrence đầu tiên không nằm trong quá khứ, cho phép sai số 60 giây như hiện tại.

Validation theo loại:

- `interval` bắt buộc có `every` và `unit`.
- `daily` không nhận `every`, `unit` hoặc `weekday`.
- `weekdays` không nhận `every`, `unit` hoặc `weekday`.
- `weekly` bắt buộc có `weekday` từ 1 đến 7.

Schema phải dùng `.strict()` để từ chối payload có cấu hình thừa hoặc sai loại.

## 5. Migration SQLite

### 5.1. Cột mới

Bổ sung vào bảng `schedules`:

```sql
schedule_type TEXT NOT NULL DEFAULT 'daily',
interval_value INTEGER,
interval_unit TEXT,
weekly_day INTEGER,
occurrence_limit INTEGER
```

Các ràng buộc logic được kiểm tra ở Zod và repository vì SQLite không thể thêm `CHECK` phức tạp bằng `ALTER TABLE` một cách thuận tiện cho database đang tồn tại.

### 5.2. Tương thích dữ liệu cũ

Mọi lịch cũ được hiểu là:

```text
schedule_type = daily
occurrence_limit = repeat_days
```

Quy trình migration:

1. Đọc `PRAGMA table_info(schedules)`.
2. Chỉ `ALTER TABLE ADD COLUMN` với cột chưa tồn tại.
3. Cập nhật `schedule_type = 'daily'` nếu để trống.
4. Sao chép `repeat_days` sang `occurrence_limit` nếu trường mới chưa có giá trị.
5. Giữ `repeat_days` trong ít nhất một phiên bản để rollback và tương thích.
6. Repository chỉ ghi dữ liệu mới vào `occurrence_limit`; không phụ thuộc `repeat_days` sau migration.

Migration phải idempotent và được kiểm thử với database cũ có occurrence, conversation và run liên kết.

## 6. Repository

Cập nhật mapping giữa SQLite và `ScheduleRule`:

```text
schedule_type     -> rule.type
interval_value    -> rule.every
interval_unit     -> rule.unit
weekly_day        -> rule.weekday
occurrence_limit  -> occurrenceLimit
```

Không tiếp tục dùng `INSERT INTO schedules VALUES (...)` vì thêm cột sẽ làm câu lệnh dễ sai. Chuyển sang khai báo tên cột rõ ràng:

```sql
INSERT INTO schedules (
  id,
  name,
  start_date,
  local_time,
  timezone,
  schedule_type,
  interval_value,
  interval_unit,
  weekly_day,
  occurrence_limit,
  prompt,
  device_serial,
  log_directory,
  status,
  next_run_at,
  completed_occurrences,
  created_at,
  updated_at
) VALUES (...)
```

Khi đổi loại lịch bằng PATCH, repository phải đặt các cột không còn áp dụng về `NULL`.

## 7. Bộ tính lịch

Thay calculator hiện tại bằng API tổng quát:

```ts
firstOccurrence(input): string;
nextOccurrence(schedule, previousScheduledFor?): string | null;
previewOccurrences(input, count): string[];
```

### 7.1. First occurrence

- `interval` và `daily`: dùng ngày/giờ bắt đầu.
- `weekdays`: nếu ngày bắt đầu là cuối tuần, chuyển tới Thứ Hai kế tiếp.
- `weekly`: tìm ngày đầu tiên có đúng `weekday`, không sớm hơn `startDate`.

### 7.2. Next occurrence

- Trả về `null` khi `completedOccurrences >= occurrenceLimit`.
- `interval/minutes`: cộng đúng số phút trên UTC instant trước đó.
- `interval/hours`: cộng đúng số giờ trên UTC instant trước đó.
- `interval/days`: cộng ngày lịch theo múi giờ của schedule.
- `daily`: cộng một ngày lịch.
- `weekdays`: cộng ngày và bỏ qua cuối tuần.
- `weekly`: cộng bảy ngày lịch.

Việc cộng lịch phải dựa trên `scheduledFor` của occurrence trước, không dựa trên thời điểm tác vụ kết thúc hoặc thời điểm scheduler tick.

### 7.3. DST và timezone

- Daily, Weekdays, Weekly và Interval theo ngày luôn giữ nguyên `localTime`.
- Interval phút/giờ giữ khoảng cách thời gian thực.
- Nếu giờ địa phương không tồn tại trong ngày đổi DST, validation/calculator trả lỗi rõ ràng thay vì tự âm thầm đổi giờ.

## 8. ScheduleService

Cập nhật `advance()`:

1. Tăng `completedOccurrences` cho occurrence được tính vào lịch.
2. Gọi calculator mới với rule và `scheduledFor` vừa xử lý.
3. Cập nhật `nextRunAt`.
4. Chuyển sang `completed` khi đạt `occurrenceLimit`.

Các trường hợp cần giữ nguyên:

- `run-now` tạo occurrence riêng nhưng không tăng tiến độ.
- Occurrence `missed` vẫn được tính vào giới hạn như hành vi hiện tại.
- `waiting_device` chỉ tăng tiến độ khi occurrence thực sự được launch hoặc kết thúc bằng lỗi timeout theo quy tắc hiện có.
- Unique constraint `(schedule_id, scheduled_for)` tiếp tục là lớp chống trùng cuối cùng.

### 8.1. Tránh bão tác vụ Interval

Khi lịch Interval quá hạn nhiều chu kỳ:

- Chỉ xử lý occurrence đến hạn hiện tại một lần.
- Tính mốc tiếp theo lớn hơn `now` hoặc ghi nhận từng mốc missed theo một giới hạn nhỏ.
- Không loop không giới hạn để tạo toàn bộ occurrence quá khứ.

Đề xuất MVP: ghi một occurrence `missed`, sau đó nhảy tới mốc tương lai gần nhất nhưng vẫn tăng `completedOccurrences` đúng một lần.

## 9. API

Giữ nguyên endpoint:

| Method | Endpoint | Chức năng |
|---|---|---|
| GET | `/api/schedules` | Danh sách lịch |
| POST | `/api/schedules` | Tạo lịch theo rule |
| GET | `/api/schedules/:id` | Chi tiết lịch và occurrences |
| PATCH | `/api/schedules/:id` | Sửa lịch hoặc đổi loại |
| DELETE | `/api/schedules/:id` | Xóa lịch |
| POST | `/api/schedules/:id/pause` | Tạm dừng |
| POST | `/api/schedules/:id/resume` | Tiếp tục và tính lại lần chạy |
| POST | `/api/schedules/:id/run-now` | Chạy ngay, không tính tiến độ |

Payload ví dụ:

```json
{
  "name": "Kiểm tra ứng dụng",
  "startDate": "2026-09-08",
  "localTime": "08:00",
  "timezone": "Asia/Bangkok",
  "rule": {
    "type": "weekdays"
  },
  "occurrenceLimit": 20,
  "prompt": "Mở ứng dụng và kiểm tra trạng thái...",
  "deviceSerial": "QV770X1KE9",
  "logDirectory": "D:\\android-agent-logs"
}
```

PATCH phải hợp nhất dữ liệu hiện tại trước khi validation. Nếu đổi `rule.type`, server xóa cấu hình riêng của rule cũ, giữ `completedOccurrences` không lớn hơn giới hạn mới và tính lại `nextRunAt`.

## 10. Giao diện

### 10.1. Menu sau nút Tạo

Khi bấm **Tạo**, mở popover ngay dưới nút với bốn lựa chọn:

1. Interval — Chạy sau mỗi khoảng thời gian.
2. Daily — Chạy mỗi ngày.
3. Weekdays — Chạy từ Thứ Hai đến Thứ Sáu.
4. Weekly — Chạy mỗi tuần vào một ngày.

Yêu cầu tương tác:

- Đóng khi click ra ngoài.
- Đóng bằng phím Escape.
- Di chuyển lựa chọn bằng phím mũi tên.
- Chọn bằng Enter hoặc Space.
- Có focus ring và ARIA phù hợp.

### 10.2. Modal tạo/sửa

Các trường động:

| Loại | Trường hiển thị |
|---|---|
| Interval | Ngày bắt đầu, giờ bắt đầu, mỗi N, đơn vị |
| Daily | Ngày bắt đầu, giờ chạy |
| Weekdays | Ngày bắt đầu, giờ chạy |
| Weekly | Ngày bắt đầu, thứ trong tuần, giờ chạy |

Các trường chung nằm dưới cấu hình thời gian.

Hiển thị preview ít nhất ba occurrence kế tiếp. Preview sử dụng cùng calculator hoặc cùng quy tắc với server để tránh UI hiển thị khác lịch thực tế.

Trong màn hình sửa, loại lịch hiển thị bằng select hoặc nhóm lựa chọn ở đầu modal. Khi đổi loại, form đặt rule mới về mặc định hợp lệ và yêu cầu người dùng xác nhận các trường thời gian tương ứng.

### 10.3. Danh sách lịch

Mỗi hàng hiển thị mô tả rule:

- `Mỗi 30 phút · Chạy tiếp sau 18 phút`.
- `Hằng ngày lúc 08:00 · Chạy tiếp sau 12 giờ`.
- `Ngày trong tuần lúc 09:00 · Chạy tiếp vào Thứ Hai`.
- `Hằng tuần vào Thứ Sáu lúc 16:00 · Chạy tiếp sau 4 ngày`.

Tiến độ đổi thành `3/20 lần` thay vì `3/20 ngày`.

## 11. Kiểm thử

### 11.1. Unit test calculator

- Interval phút qua ranh giới giờ và ngày.
- Interval giờ qua ranh giới ngày.
- Interval ngày giữ nguyên giờ địa phương.
- Daily qua cuối tháng, cuối năm và năm nhuận.
- Weekdays bỏ qua Thứ Bảy và Chủ Nhật.
- Weekdays từ Thứ Sáu chuyển sang Thứ Hai.
- Weekly tìm đúng occurrence đầu tiên.
- Weekly cộng đúng bảy ngày lịch.
- Các loại lịch qua thời điểm DST.
- Dừng đúng `occurrenceLimit`.
- Preview và next occurrence cho cùng kết quả.

### 11.2. Validation test

- Từ chối interval thiếu `every` hoặc `unit`.
- Từ chối interval nhỏ hơn giới hạn.
- Từ chối weekday ngoài 1–7.
- Từ chối trường riêng không thuộc rule.
- Từ chối occurrence đầu tiên trong quá khứ.
- Chấp nhận đầy đủ bốn loại lịch.

### 11.3. Migration/repository test

- Database cũ được migrate thành Daily.
- `repeat_days` được sao chép sang `occurrence_limit`.
- Không mất schedule hoặc occurrence cũ.
- Migration chạy nhiều lần không lỗi.
- Create/update map đúng từng loại rule.
- Đổi loại lịch đặt cột cũ về `NULL`.

### 11.4. Service/API test

- Mỗi loại tạo đúng occurrence tiếp theo.
- Pause/resume không sinh trùng.
- Sửa hoặc đổi loại tính lại `nextRunAt`.
- Run-now không tăng tiến độ.
- Interval quá hạn không tạo bão tác vụ.
- Restart không chạy lại occurrence đã tồn tại.

### 11.5. UI test

- Bấm Tạo mở đủ bốn lựa chọn.
- Mỗi lựa chọn mở đúng form.
- Trường động thay đổi đúng theo loại.
- Preview hiển thị đúng.
- Danh sách mô tả đúng rule.
- Sửa lịch giữ đúng cấu hình đã lưu.
- Menu và modal dùng được bằng bàn phím.
- Responsive ở desktop và mobile.

## 12. Thứ tự triển khai

### Phase 1 — Contract và calculator

1. Thêm `ScheduleRule` và `occurrenceLimit`.
2. Viết test cho bốn loại lịch.
3. Xây `firstOccurrence`, `nextOccurrence` và preview.

### Phase 2 — Persistence

1. Thêm migration idempotent.
2. Cập nhật row types và mapper.
3. Đổi câu lệnh insert/update sang danh sách cột rõ ràng.
4. Viết test tương thích dữ liệu cũ.

### Phase 3 — Service và API

1. Cập nhật validation.
2. Cập nhật create/PATCH/resume.
3. Cập nhật `ScheduleService.advance()`.
4. Thêm bảo vệ backlog Interval.

### Phase 4 — UI

1. Thêm popover chọn loại sau nút Tạo.
2. Chuyển modal sang form động theo rule.
3. Thêm preview occurrence.
4. Cập nhật mô tả và tiến độ trong danh sách.

### Phase 5 — Hardening

1. Chạy typecheck và toàn bộ unit/integration test.
2. Chạy build production.
3. Chạy UI smoke test cho bốn loại.
4. Kiểm tra thủ công một lịch ngắn trên thiết bị thật.
5. Xác nhận migration bằng bản sao database đang sử dụng.

## 13. Các file dự kiến thay đổi

```text
lib/contracts/types.ts
lib/contracts/schemas.ts
lib/server/persistence/session-repository.ts
lib/server/schedule/schedule-calculator.ts
lib/server/schedule/schedule-validation.ts
lib/server/schedule/schedule-repository.ts
lib/server/schedule/schedule-service.ts
app/api/schedules/route.ts
app/api/schedules/[id]/route.ts
app/api/schedules/[id]/resume/route.ts
components/schedule-panel.tsx
app/schedule.css
tests/schedule.test.ts
tests/schedule-service.test.ts
scripts/verify-schedule-ui.cjs
scripts/verify-schedule-crud.cjs
scripts/verify-schedule-sse.cjs
```

## 14. Tiêu chí hoàn thành

- Nút **Tạo** mở menu gồm đúng bốn loại lịch.
- Tạo, sửa, pause, resume, run-now và xóa hoạt động với mọi loại.
- Lịch cũ tiếp tục hoạt động như Daily và không mất dữ liệu.
- Mỗi rule tính đúng occurrence kế tiếp theo timezone.
- Weekdays không chạy cuối tuần.
- Weekly chạy đúng thứ được chọn.
- Interval không tạo backlog không kiểm soát sau downtime.
- Progress được tính theo tổng số lần chạy.
- SSE cập nhật danh sách mà không polling liên tục.
- Không tạo occurrence trùng khi tick đồng thời hoặc restart.
- Typecheck, test, build và UI smoke test đều đạt.

## 15. Ngoài phạm vi

- Cron expression tùy chỉnh.
- Chọn nhiều thứ trong một lịch Weekly.
- Nhiều giờ chạy trong cùng một ngày.
- Lịch theo ngày cụ thể trong tháng.
- Lịch vô hạn không có giới hạn occurrence.
- Tự động xử lý ngày lễ.
