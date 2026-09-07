"use client";

import { useEffect, useMemo, useState } from "react";
import type { DeviceSummary, Schedule, ScheduleStatus } from "@/lib/contracts/types";

type Api<T> = { ok: boolean; data: T; error?: { message: string } };
type Form = Pick<
  Schedule,
  "name" | "startDate" | "localTime" | "timezone" | "repeatDays" | "prompt" | "deviceSerial" | "logDirectory"
>;
type Filter = "all" | "active" | "paused" | "completed";
type Feedback = { kind: "error" | "success"; message: string } | null;

const filters: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "Tất cả" },
  { value: "active", label: "Đang hoạt động" },
  { value: "paused", label: "Tạm dừng" },
  { value: "completed", label: "Hoàn thành" },
];

const statusLabels: Record<ScheduleStatus, string> = {
  active: "Đang hoạt động",
  paused: "Tạm dừng",
  completed: "Hoàn thành",
  disabled: "Đã vô hiệu hóa",
};

function initialForm(serial = ""): Form {
  const date = new Date(Date.now() + 86_400_000);
  return {
    name: "",
    startDate: date.toISOString().slice(0, 10),
    localTime: "08:00",
    timezone: "Asia/Bangkok",
    repeatDays: 1,
    prompt: "",
    deviceSerial: serial,
    logDirectory: "D:\\android-agent-logs",
  };
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function relativeNextRun(nextRunAt: string | null) {
  if (!nextRunAt) return "Không còn lần chạy tiếp theo";
  const diff = new Date(nextRunAt).getTime() - Date.now();
  if (diff <= 0) return "Đang đến hạn";
  const minutes = Math.max(1, Math.round(diff / 60_000));
  if (minutes < 60) return `Chạy tiếp sau ${minutes} phút`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Chạy tiếp sau ${hours} giờ`;
  return `Chạy tiếp sau ${Math.round(hours / 24)} ngày`;
}

export default function SchedulePanel({ devices, onClose }: { devices: DeviceSummary[]; onClose: () => void }) {
  const defaultSerial = devices.find((device) => device.state === "device")?.serial ?? "";
  const [items, setItems] = useState<Schedule[]>([]);
  const [form, setForm] = useState<Form>(() => initialForm(defaultSerial));
  const [editing, setEditing] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [directoryMessage, setDirectoryMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState("");

  async function load() {
    try {
      const response = await fetch("/api/schedules", { cache: "no-store" });
      const payload = (await response.json()) as Api<Schedule[]>;
      if (!response.ok || !payload.ok) throw new Error(payload.error?.message || "Không thể tải danh sách lịch");
      setItems(payload.data);
    } catch (cause) {
      setFeedback({ kind: "error", message: cause instanceof Error ? cause.message : String(cause) });
    }
  }

  useEffect(() => {
    void load();
    const source = new EventSource("/api/schedules/events");
    for (const type of ["schedule.created", "schedule.updated", "schedule.deleted"]) {
      source.addEventListener(type, () => void load());
    }
    return () => source.close();
  }, []);

  useEffect(() => {
    if (!editorOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) setEditorOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [editorOpen, saving]);

  const endDate = useMemo(() => {
    const [year, month, day] = form.startDate.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + Math.max(0, form.repeatDays - 1)));
    return Number.isNaN(date.getTime()) ? "—" : date.toISOString().slice(0, 10);
  }, [form.startDate, form.repeatDays]);

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("vi");
    return items.filter((item) => {
      const matchesFilter = filter === "all" || item.status === filter;
      const searchable = `${item.name} ${item.deviceSerial} ${item.prompt}`.toLocaleLowerCase("vi");
      return matchesFilter && (!normalizedQuery || searchable.includes(normalizedQuery));
    });
  }, [filter, items, query]);

  function openCreate() {
    setEditing(null);
    setForm(initialForm(defaultSerial));
    setDirectoryMessage("");
    setFeedback(null);
    setEditorOpen(true);
  }

  function openEdit(item: Schedule) {
    setEditing(item.id);
    setForm({
      name: item.name,
      startDate: item.startDate,
      localTime: item.localTime,
      timezone: item.timezone,
      repeatDays: item.repeatDays,
      prompt: item.prompt,
      deviceSerial: item.deviceSerial,
      logDirectory: item.logDirectory,
    });
    setDirectoryMessage("");
    setFeedback(null);
    setEditorOpen(true);
  }

  async function save() {
    setSaving(true);
    setFeedback(null);
    try {
      const response = await fetch(editing ? `/api/schedules/${editing}` : "/api/schedules", {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = (await response.json()) as Api<Schedule>;
      if (!response.ok || !payload.ok) throw new Error(payload.error?.message || "Không thể lưu lịch");
      setEditorOpen(false);
      setEditing(null);
      setFeedback({ kind: "success", message: editing ? "Đã cập nhật lịch." : "Đã tạo lịch mới." });
      await load();
    } catch (cause) {
      setFeedback({ kind: "error", message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setSaving(false);
    }
  }

  async function validateDirectory() {
    setDirectoryMessage("");
    setFeedback(null);
    try {
      const response = await fetch("/api/schedules/validate-log-directory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ logDirectory: form.logDirectory }),
      });
      const payload = (await response.json()) as Api<{ logDirectory: string }>;
      if (!response.ok || !payload.ok) throw new Error(payload.error?.message || "Thư mục không hợp lệ");
      setForm((current) => ({ ...current, logDirectory: payload.data.logDirectory }));
      setDirectoryMessage("Thư mục hợp lệ và có thể ghi.");
    } catch (cause) {
      setFeedback({ kind: "error", message: cause instanceof Error ? cause.message : String(cause) });
    }
  }

  async function command(item: Schedule, action: "pause" | "resume" | "run-now") {
    const actionKey = `${item.id}:${action}`;
    setPendingAction(actionKey);
    setFeedback(null);
    try {
      const response = await fetch(`/api/schedules/${item.id}/${action}`, { method: "POST" });
      const payload = (await response.json()) as Api<unknown>;
      if (!response.ok || !payload.ok) throw new Error(payload.error?.message || "Thao tác thất bại");
      await load();
    } catch (cause) {
      setFeedback({ kind: "error", message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setPendingAction("");
    }
  }

  async function remove(item: Schedule) {
    if (!window.confirm(`Xóa lịch “${item.name}”?`)) return;
    const actionKey = `${item.id}:delete`;
    setPendingAction(actionKey);
    setFeedback(null);
    try {
      const response = await fetch(`/api/schedules/${item.id}`, { method: "DELETE" });
      const payload = (await response.json()) as Api<unknown>;
      if (!response.ok || !payload.ok) throw new Error(payload.error?.message || "Không thể xóa lịch");
      setFeedback({ kind: "success", message: "Đã xóa lịch." });
      await load();
    } catch (cause) {
      setFeedback({ kind: "error", message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setPendingAction("");
    }
  }

  return (
    <section className="schedulePanel">
      <header className="scheduleHeader">
        <div className="scheduleHeading">
          <button className="scheduleBack" type="button" onClick={onClose} aria-label="Về hội thoại" title="Về hội thoại">←</button>
          <div>
            <h1>Công việc đã lên lịch</h1>
            <p>Tự động chạy tác vụ Android, đặt lời nhắc và theo dõi tiến độ.</p>
          </div>
        </div>
        <button className="scheduleCreate" type="button" onClick={openCreate}>Tạo</button>
      </header>

      <div className="scheduleContent">
        <label className="scheduleSearch">
          <SearchIcon />
          <span className="srOnly">Tìm kiếm công việc đã lên lịch</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm kiếm công việc đã lên lịch" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Xóa nội dung tìm kiếm">×</button>}
        </label>

        <nav className="scheduleFilters" aria-label="Lọc công việc theo trạng thái">
          {filters.map((option) => (
            <button key={option.value} type="button" className={filter === option.value ? "selected" : ""} aria-pressed={filter === option.value} onClick={() => setFilter(option.value)}>{option.label}</button>
          ))}
        </nav>

        {feedback && !editorOpen && <p className={`scheduleFeedback ${feedback.kind}`} role="status">{feedback.message}</p>}

        <div className="scheduleList" aria-live="polite">
          {visibleItems.map((item) => {
            const isRunning = item.latestOccurrence?.status === "running";
            const isBusy = pendingAction.startsWith(`${item.id}:`);
            return (
              <article className="scheduleRow" key={item.id}>
                <span className={`scheduleDot ${isRunning ? "running" : item.status}`} title={isRunning ? "Đang chạy" : statusLabels[item.status]}>{isRunning && <i className="scheduleDotSpinner" />}</span>
                <div className="scheduleRowContent">
                  <h3>{item.name}</h3>
                  <p>Hằng ngày lúc {item.localTime} <span>·</span> {relativeNextRun(item.nextRunAt)}</p>
                  <small>{item.deviceSerial} <span>·</span> {item.completedOccurrences}/{item.repeatDays} lần <span>·</span> {item.logDirectory}</small>
                </div>
                <div className="scheduleRowActions">
                  <button type="button" onClick={() => openEdit(item)} disabled={isBusy}>Sửa</button>
                  <button type="button" onClick={() => void command(item, item.status === "paused" ? "resume" : "pause")} disabled={isBusy || item.status === "completed" || item.status === "disabled"}>{item.status === "paused" ? "Tiếp tục" : "Tạm dừng"}</button>
                  <button type="button" onClick={() => void command(item, "run-now")} disabled={isBusy}>Chạy ngay</button>
                  <button className="danger" type="button" onClick={() => void remove(item)} disabled={isBusy}>Xóa</button>
                </div>
              </article>
            );
          })}

          {!visibleItems.length && (
            <div className="scheduleEmpty">
              <span aria-hidden="true">◷</span>
              <h2>{items.length ? "Không tìm thấy công việc" : "Chưa có công việc nào"}</h2>
              <p>{items.length ? "Thử từ khóa hoặc trạng thái khác." : "Tạo lịch đầu tiên để Android Agent tự động làm việc cho bạn."}</p>
              {!items.length && <button type="button" onClick={openCreate}>Tạo công việc</button>}
            </div>
          )}
        </div>
      </div>

      {editorOpen && (
        <div className="scheduleModalBackdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setEditorOpen(false); }}>
          <form className="scheduleEditor" role="dialog" aria-modal="true" aria-labelledby="schedule-editor-title" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <header>
              <div><h2 id="schedule-editor-title">{editing ? "Sửa công việc" : "Tạo công việc mới"}</h2><p>Thiết lập thời gian và nội dung Android Agent sẽ thực hiện.</p></div>
              <button type="button" onClick={() => setEditorOpen(false)} disabled={saving} aria-label="Đóng">×</button>
            </header>

            <div className="scheduleEditorBody">
              <label className="scheduleWide">Tên công việc<input autoFocus required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
              <label>Ngày bắt đầu<input type="date" required value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label>
              <label>Giờ chạy<input type="time" required value={form.localTime} onChange={(event) => setForm({ ...form, localTime: event.target.value })} /></label>
              <label>Số ngày lặp lại<input type="number" min="1" max="365" required value={form.repeatDays} onChange={(event) => setForm({ ...form, repeatDays: Number(event.target.value) })} /></label>
              <label>Múi giờ<input required value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} /></label>
              <p className="schedulePreview scheduleWide">Chạy mỗi ngày từ {form.startDate} đến {endDate}, lúc {form.localTime} ({form.timezone}).</p>
              <label className="scheduleWide">Prompt<textarea required maxLength={10_000} value={form.prompt} onChange={(event) => { const prompt = event.target.value; setForm({ ...form, prompt, name: form.name || prompt.split(/\r?\n/)[0].trim().slice(0, 120) }); }} /></label>
              <p className="scheduleHint scheduleWide">Prompt được lưu trong SQLite. Không nhập API key hoặc bí mật dài hạn nếu không cần thiết.</p>
              <label className="scheduleWide">Thiết bị<select required value={form.deviceSerial} onChange={(event) => setForm({ ...form, deviceSerial: event.target.value })}><option value="" disabled>Chọn thiết bị</option>{devices.map((device) => <option key={device.serial} value={device.serial}>{device.displayName} · {device.state}</option>)}</select></label>
              <label className="scheduleWide">Thư mục log<div className="scheduleDirectory"><input required value={form.logDirectory} onChange={(event) => { setDirectoryMessage(""); setForm({ ...form, logDirectory: event.target.value }); }} /><button type="button" onClick={() => void validateDirectory()}>Kiểm tra</button></div></label>
              {directoryMessage && <p className="scheduleDirectoryOk scheduleWide">✓ {directoryMessage}</p>}
              {feedback && <p className={`scheduleFeedback ${feedback.kind} scheduleWide`} role="alert">{feedback.message}</p>}
            </div>

            <footer>
              <button type="button" onClick={() => setEditorOpen(false)} disabled={saving}>Hủy</button>
              <button className="primary" type="submit" disabled={saving}>{saving ? "Đang lưu…" : editing ? "Lưu thay đổi" : "Tạo lịch"}</button>
            </footer>
          </form>
        </div>
      )}
    </section>
  );
}
