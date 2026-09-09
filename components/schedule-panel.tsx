"use client";

import { useEffect, useMemo, useState } from "react";
import type { DeviceSummary, Schedule, ScheduleRule, ScheduleStatus } from "@/lib/contracts/types";

type Api<T> = { ok: boolean; data: T; error?: { message: string } };
type Form = Pick<
  Schedule,
  "name" | "startDate" | "localTime" | "timezone" | "rule" | "occurrenceLimit" | "prompt" | "deviceSerial" | "logDirectory" | "emailNotification"
>;
type Filter = "all" | "active" | "paused" | "completed";
type Feedback = { kind: "error" | "success"; message: string } | null;

const filters: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "Tất cả" },
  { value: "active", label: "Đang hoạt động" },
  { value: "paused", label: "Tạm dừng" },
  { value: "completed", label: "Hoàn thành" },
];

const emailLabels:Record<string,string>={pending:"Email đang chờ",preparing:"Đang chuẩn bị email",sending:"Đang gửi email",retry_wait:"Email sẽ thử lại",sent:"SMTP đã chấp nhận email",failed:"Gửi email thất bại",blocked_config:"Email bị chặn do cấu hình",attachment_failed:"Không tạo được attachment",delivery_unknown:"Chưa xác định email đã được nhận",cancelled:"Email đã hủy"};
const statusLabels: Record<ScheduleStatus, string> = {
  active: "Đang hoạt động",
  paused: "Tạm dừng",
  completed: "Hoàn thành",
  disabled: "Đã vô hiệu hóa",
};

function initialForm(serial = "", type: ScheduleRule["type"] = "daily"): Form {
  const now=new Date(),zone="Asia/Bangkok",date=type==="interval"||type==="weekly"?new Date():new Date(Date.now()+86_400_000),intervalDate=new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"}).format(now),intervalTime=new Intl.DateTimeFormat("en-GB",{timeZone:zone,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(now);
  return {
    name: "",
    startDate: type==="interval"||type==="weekly"?intervalDate:date.toISOString().slice(0,10),
    localTime: type==="interval"?intervalTime:"08:00",
    timezone: "Asia/Bangkok",
    rule: type === "interval" ? { type, every: 30, unit: "minutes" } : type === "weekly" ? { type, weekdays: [1] } : { type },
    occurrenceLimit: type === "interval" || type === "daily" || type === "weekly" ? null : 1,
    prompt: "",
    deviceSerial: serial,
    logDirectory: "D:\\android-agent-logs",
    emailNotification: {enabled:false},
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
  const [defaultRecipient,setDefaultRecipient]=useState("");
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
    void fetch("/api/settings/email",{cache:"no-store"}).then(response=>response.json()).then(payload=>setDefaultRecipient(payload.data?.settings?.defaultRecipient??"")).catch(()=>{});
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

  const preview = useMemo(() => {
    const values:string[]=[];let date=form.startDate;const add=(value:string,days:number)=>{const d=new Date(value+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)};const weekday=(value:string)=>{const d=new Date(value+"T00:00:00Z").getUTCDay();return d===0?7:d};if(form.rule.type==="weekly")while(!form.rule.weekdays.includes(weekday(date) as 1|2|3|4|5|6|7))date=add(date,1);for(let i=0;i<Math.min(3,form.occurrenceLimit??3);i++){values.push(date+" "+form.localTime);if(form.rule.type==="weekly"){date=add(date,1);while(!form.rule.weekdays.includes(weekday(date) as 1|2|3|4|5|6|7))date=add(date,1);}else date=add(date,1)}return values;
  }, [form]);

  const endDate = useMemo(() => {
    const [year, month, day] = form.startDate.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + Math.max(0, (form.occurrenceLimit??1) - 1)));
    return Number.isNaN(date.getTime()) ? "—" : date.toISOString().slice(0, 10);
  }, [form.startDate, form.occurrenceLimit]);

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
      rule: item.rule,
      occurrenceLimit: item.occurrenceLimit,
      prompt: item.prompt,
      deviceSerial: item.deviceSerial,
      logDirectory: item.logDirectory,
      emailNotification: item.emailNotification??{enabled:false},
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
    if (!window.confirm(`Xóa lịch “${item.name}”?${item.emailNotification?.enabled?" Email chưa gửi sẽ bị hủy; email đang gửi hoặc đã được SMTP chấp nhận không thể thu hồi.":""}`)) return;
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
        <button className="scheduleCreate" type="button" aria-haspopup="dialog" onClick={openCreate}>Tạo</button>
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
                  <p>{item.rule.type === "interval" ? `Mỗi ${item.rule.every} ${item.rule.unit}` : item.rule.type === "weekly" ? `Hằng tuần các thứ ${item.rule.weekdays.join(", ")} lúc ${item.localTime}` : `Hằng ngày lúc ${item.localTime}`} <span>·</span> {relativeNextRun(item.nextRunAt)}</p>
                  {item.latestOccurrence?.emailStatus&&<p className="scheduleEmailStatus" title={item.latestOccurrence.emailDelivery?`Người nhận: ${item.latestOccurrence.emailDelivery.recipient}
Tiêu đề: ${item.latestOccurrence.emailDelivery.subject}
Số lần thử: ${item.latestOccurrence.emailDelivery.attempts}${item.latestOccurrence.emailDelivery.nextAttemptAt?`
Thử lại: ${item.latestOccurrence.emailDelivery.nextAttemptAt}`:""}${item.latestOccurrence.emailDelivery.sentAt?`
SMTP chấp nhận: ${item.latestOccurrence.emailDelivery.sentAt}`:""}${item.latestOccurrence.emailDelivery.errorMessage?`
Lỗi: ${item.latestOccurrence.emailDelivery.errorMessage}`:""}`:undefined}>{emailLabels[item.latestOccurrence.emailStatus]??item.latestOccurrence.emailStatus}{item.latestOccurrence.emailDelivery?` · ${item.latestOccurrence.emailDelivery.attempts} lần thử`:""}</p>}
                  <small>{item.deviceSerial} <span>·</span> {item.emailNotification?.enabled?"Có email":"Không email"} <span>·</span> {(item.rule.type==="interval"||item.rule.type==="daily"||item.rule.type==="weekly")?`${item.completedOccurrences} lần · chạy đến khi tạm dừng hoặc xóa`:`${item.completedOccurrences}/${item.occurrenceLimit} lần`} <span>·</span> {item.logDirectory}</small>
                </div>
                <div className="scheduleRowActions">
                  <button type="button" onClick={() => openEdit(item)} disabled={isBusy}>Sửa</button>
                  <button type="button" onClick={() => void command(item, item.status === "paused" ? "resume" : "pause")} disabled={isBusy || item.status === "completed" || item.status === "disabled"}>{item.status === "paused" ? "Tiếp tục" : "Tạm dừng"}</button>
                  <button type="button" onClick={() => void command(item, "run-now")} disabled={isBusy}>Chạy ngay</button>
                  {item.latestOccurrence?.emailStatus&&["failed","blocked_config","attachment_failed","delivery_unknown"].includes(item.latestOccurrence.emailStatus)&&<button type="button" onClick={async()=>{if(item.latestOccurrence?.emailStatus==="delivery_unknown"&&!window.confirm("SMTP có thể đã nhận email. Thử lại có thể gửi trùng. Bạn vẫn muốn tiếp tục?"))return;setPendingAction(item.id+":email-retry");try{const csrf=await fetch("/api/settings/email",{cache:"no-store"}).then(response=>response.json());const response=await fetch("/api/schedules/"+item.id+"/occurrences/"+item.latestOccurrence!.id+"/email/retry",{method:"POST",headers:{"x-autostart-token":csrf.data?.csrfToken??""}});const payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error?.message||"Không thể thử lại email");await load()}catch(cause){setFeedback({kind:"error",message:cause instanceof Error?cause.message:String(cause)})}finally{setPendingAction("")}}}>Thử lại email</button>}
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
              <label className="scheduleWide">Loại lịch<select value={form.rule.type} onChange={(event)=>setForm({...form,occurrenceLimit:event.target.value==="interval"||event.target.value==="daily"||event.target.value==="weekly"?null:(form.occurrenceLimit??1),rule:event.target.value==="interval"?{type:"interval",every:30,unit:"minutes"}:event.target.value==="weekly"?{type:"weekly",weekdays:[1]}:{type:"daily"}})}><option value="interval">Interval</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
              <label className="scheduleWide">Tên công việc<input autoFocus required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
              {form.rule.type === "daily" && <label>Giờ chạy<input type="time" required value={form.localTime} onChange={(event) => setForm({ ...form, localTime: event.target.value })} /></label>}
              {form.rule.type === "interval" && <><label data-rule-field="interval">Mỗi<input type="number" min={1} required value={form.rule.every} onChange={(event) => setForm({ ...form, rule: { type: "interval", every: Number(event.target.value), unit: form.rule.type === "interval" ? form.rule.unit : "minutes" } })} /></label><label>Đơn vị<select value={form.rule.unit} onChange={(event) => setForm({ ...form, rule: { type: "interval", every: form.rule.type === "interval" ? form.rule.every : 30, unit: event.target.value as "seconds" | "minutes" | "hours" } })}><option value="seconds">giây</option><option value="minutes">phút</option><option value="hours">giờ</option></select></label></>}
              {form.rule.type === "weekly" && <div className="scheduleWeeklyRow"><fieldset data-rule-field="weekly" className="scheduleWeekdays"><legend>Ngày trong tuần</legend>{[[1,"T2"],[2,"T3"],[3,"T4"],[4,"T5"],[5,"T6"],[6,"T7"],[7,"CN"]].map(([day,label])=><label key={day}><input type="checkbox" checked={form.rule.type==="weekly"&&form.rule.weekdays.includes(day as 1|2|3|4|5|6|7)} onChange={()=>{if(form.rule.type!=="weekly")return;const value=day as 1|2|3|4|5|6|7,current=form.rule.weekdays,next=current.includes(value)?current.filter(item=>item!==value):[...current,value].sort();if(next.length)setForm({...form,rule:{type:"weekly",weekdays:next as (1|2|3|4|5|6|7)[]}})}}/>{label}</label>)}</fieldset><label className="scheduleWeeklyTime">Giờ chạy<input type="time" required value={form.localTime} onChange={(event) => setForm({ ...form, localTime: event.target.value })} /></label></div>}
              {false && <label>Tổng số lần<input type="number" min="1" max="365" required value={form.occurrenceLimit??1} onChange={(event) => setForm({ ...form, occurrenceLimit: Number(event.target.value) })} /></label>}{(form.rule.type === "interval" || form.rule.type === "daily" || form.rule.type === "weekly") && <p className="scheduleHint">{form.rule.type === "interval" ? "Interval" : form.rule.type === "daily" ? "Daily" : "Weekly"} sẽ chạy liên tục đến khi bạn tạm dừng hoặc xóa công việc.</p>}
              <label className={form.rule.type === "interval" || form.rule.type === "weekly" ? "scheduleTimezoneLeft" : undefined}>Múi giờ<input required value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} /></label>
              <p className="schedulePreview scheduleWide">Ba lần kế tiếp: {preview.join(" · ")} ({form.timezone}).</p>
              <label className="scheduleWide">Prompt<textarea required maxLength={10_000} value={form.prompt} onChange={(event) => { const prompt = event.target.value; setForm({ ...form, prompt, name: form.name || prompt.split(/\r?\n/)[0].trim().slice(0, 120) }); }} /></label>
              <p className="scheduleHint scheduleWide">Prompt được lưu trong SQLite. Không nhập API key hoặc bí mật dài hạn nếu không cần thiết.</p>
              <label className="scheduleWide">Thiết bị<select required value={form.deviceSerial} onChange={(event) => setForm({ ...form, deviceSerial: event.target.value })}><option value="" disabled>Chọn thiết bị</option>{devices.map((device) => <option key={device.serial} value={device.serial}>{device.displayName} · {device.state}</option>)}</select></label>
              <label className="scheduleWide scheduleEmailOpt"><span><input type="checkbox" checked={form.emailNotification?.enabled===true} onChange={event=>setForm({...form,emailNotification:event.target.checked?{enabled:true,to:defaultRecipient,subject:"Kết quả công việc "+(form.name||"Android Agent")}:{enabled:false}})}/> Gửi email sau khi chạy xong</span><small>Email chứa kết quả và file đính kèm các bước; nội dung có thể chứa dữ liệu nhạy cảm.</small></label>
              {form.emailNotification?.enabled&&<><p className="scheduleWide scheduleEmailEstimate" role="status">Giới hạn gửi toàn cục: 30 email/giờ; backlog tối đa 500. {form.rule.type==="interval"&&form.rule.unit==="seconds"?"Lịch theo giây có thể vượt quota; job vẫn chạy nhưng email sẽ chờ hoặc thất bại khi hàng đợi đầy.":"Mỗi lần chạy terminal tạo tối đa một email."}</p><label>Người nhận<input type="email" required value={form.emailNotification.to} onChange={event=>setForm({...form,emailNotification:{enabled:true,to:event.target.value,subject:form.emailNotification?.enabled?form.emailNotification.subject:""}})}/></label><label>Tiêu đề<input required maxLength={200} value={form.emailNotification.subject} onChange={event=>setForm({...form,emailNotification:{enabled:true,to:form.emailNotification?.enabled?form.emailNotification.to:"",subject:event.target.value}})}/></label></>}
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
