"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { AutostartStatus } from "@/lib/contracts/system";
import type {EmailPublicSettings,EmailSettingsInput} from "@/lib/contracts/email";

export type Settings = {
  model?: string;
  baseUrl?: string;
  maxSteps?: number;
  deviceRefreshMs?: number;
  screenRefreshMs?: number;
  apiKey?: string;
  apiKeyConfigured?: boolean;
};

const tabs = [
  { id: "general", label: "Chung" },
  { id: "model", label: "AI Model" },
  { id: "email", label: "Email" },
  { id: "about", label: "Giới thiệu" },
] as const;
type Tab = (typeof tabs)[number]["id"];

function TabIcon({ tab }: { tab: Tab }) {
  const paths: Record<Tab, ReactNode> = {
    general: <><path d="M3 6h8m4 0h6M3 12h2m4 0h12M3 18h12m4 0h2"/><circle cx="13" cy="6" r="2"/><circle cx="7" cy="12" r="2"/><circle cx="17" cy="18" r="2"/></>,
    model: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/></>,
    email: <><path d="M3 5h18v14H3z"/><path d="m3 6 9 7 9-7"/></>,
    about: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[tab]}</svg>;
}

export type EmailDraft=Omit<EmailSettingsInput,"clearPassword">&{password?:string;clearPassword?:boolean};
export default function SettingsDialog({ initial, autostart, email, onSave, onClose }: {
  autostart: AutostartStatus;
  initial: Settings;
  email: EmailPublicSettings|null;
  onSave: (settings: Settings, enabled?: boolean, email?:EmailDraft) => Promise<void>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("general");
  const [draft, setDraft] = useState<Settings>(() => ({ ...initial, apiKey: "" }));
  const [emailDraft,setEmailDraft]=useState<EmailDraft>(()=>email?{host:email.host,port:email.port,security:email.security,username:email.username,defaultRecipient:email.defaultRecipient,password:""}:{host:"smtp.gmail.com",port:587,security:"starttls",username:"",defaultRecipient:"",password:""});
  const [emailTouched,setEmailTouched]=useState(false);
  const [emailAction,setEmailAction]=useState("");
  const [autostartDraft, setAutostartDraft] = useState<boolean | null>(autostart.enabled);
  const [autostartTouched, setAutostartTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLFormElement>(null);
  const savingRef = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);

  function changeTab(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex(item => item.id === tab);
    let next: number;
    switch (event.key) {
      case "ArrowDown": case "ArrowRight": next = (index + 1) % tabs.length; break;
      case "ArrowUp": case "ArrowLeft": next = (index + tabs.length - 1) % tabs.length; break;
      case "Home": next = 0; break;
      case "End": next = tabs.length - 1; break;
      default: return;
    }
    event.preventDefault();
    setTab(tabs[next].id);
    dialog.current?.querySelector<HTMLButtonElement>("#settings-tab-" + tabs[next].id)?.focus();
  }

  function dialogKeys(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!savingRef.current) closeRef.current();
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled),input:not(:disabled),a[href],[tabindex="0"]',
    ) ?? []).filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  async function submit() {
    if (savingRef.current) return;
    setError("");
    // Validate all tabs, including currently hidden fields.
    if (!Number.isInteger(draft.maxSteps ?? 100) || (draft.maxSteps ?? 100) < 1 || (draft.maxSteps ?? 100) > 100
      || !Number.isInteger(draft.screenRefreshMs ?? 900) || (draft.screenRefreshMs ?? 900) < 300 || (draft.screenRefreshMs ?? 900) > 10000) {
      setTab("general"); setError("Số bước phải từ 1–100; chu kỳ làm mới phải từ 300–10.000 ms."); return;
    }
    if (!draft.model?.trim() || !draft.baseUrl?.trim()) {
      setTab("model"); setError("Vui lòng nhập Model và Base URL."); return;
    }
    if(emailTouched&&(!emailDraft.host.trim()||!emailDraft.username.trim()||!emailDraft.defaultRecipient.trim()||!Number.isInteger(emailDraft.port)||emailDraft.port<1||emailDraft.port>65535)){setTab("email");setError("Vui lòng nhập đầy đủ cấu hình SMTP hợp lệ.");return;}
    savingRef.current = true;
    setSaving(true);
    try { await onSave(draft, autostartTouched && autostartDraft !== null ? autostartDraft : undefined,emailTouched?emailDraft:undefined); }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : "Không thể lưu cấu hình.";
      if (message.startsWith("Đã lưu cấu hình ứng dụng")) setDraft(previous => ({...previous, apiKey: ""}));
      setError(message);
    }
    finally { savingRef.current = false; setSaving(false); }
  }

  return <div className="settingsBackdrop" onMouseDown={event => {
    if (event.target === event.currentTarget && !savingRef.current) onClose();
  }}>
    <form ref={dialog} className="settingsDialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" noValidate
      onKeyDown={dialogKeys} onSubmit={event => { event.preventDefault(); void submit(); }}>
      <header className="settingsHeader">
        <h2 id="settings-title">Cấu hình</h2>
        <button className="settingsClose" type="button" aria-label="Đóng cấu hình" disabled={saving} onClick={onClose}>×</button>
      </header>
      <div className="settingsLayout">
        <div className="settingsTabs" role="tablist" aria-label="Nhóm cấu hình" aria-orientation="vertical" onKeyDown={changeTab}>
          {tabs.map(item => <button type="button" key={item.id} id={"settings-tab-" + item.id} role="tab"
            aria-selected={tab === item.id} aria-controls={"settings-panel-" + item.id} tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}><TabIcon tab={item.id}/>{item.label}</button>)}
        </div>
        <div className="settingsContent">
          <section id="settings-panel-general" role="tabpanel" aria-labelledby="settings-tab-general" hidden={tab !== "general"}>
            <h3>Chung</h3>
            <div className="settingsRow">
              <label htmlFor="settings-autostart">Khởi động cùng Windows
                <small id="settings-autostart-help">Chạy nền và hiển thị biểu tượng ở khay hệ thống sau khi bạn đăng nhập.</small>
                <small>Tắt tùy chọn này không dừng ứng dụng đang chạy.</small>
                <small role="status">{autostart.reason || (autostart.backgroundReady ? "Sẵn sàng chạy nền" : "Chạy nền chưa sẵn sàng")}</small>
                {autostart.enabled === null && <small>Chưa xác minh được trạng thái. Kiểm tra Startup trong Windows.</small>}
              </label>
              <button id="settings-autostart" type="button" role="switch" className="settingsSwitch"
                aria-label="Khởi động cùng Windows" aria-describedby="settings-autostart-help"
                aria-checked={autostartDraft === true} disabled={saving || !autostart.supported}
                onClick={() => { setAutostartTouched(true); setAutostartDraft(autostartDraft !== true); }}><span /></button>
            </div>
            <div className="settingsRow">
              <label htmlFor="settings-steps">Số bước tối đa<small>Giới hạn số bước cho mỗi lần chạy tác vụ.</small></label>
              <input id="settings-steps" type="number" min="1" max="100" required disabled={saving}
                value={draft.maxSteps ?? 100} onChange={event => setDraft({ ...draft, maxSteps: Number(event.target.value) })}/>
            </div>
            <div className="settingsRow">
              <label htmlFor="settings-refresh">Làm mới màn hình<small>Chu kỳ cập nhật ảnh chụp ADB, tính bằng mili giây.</small></label>
              <div className="settingsUnit"><input id="settings-refresh" type="number" min="300" max="10000" required disabled={saving}
                value={draft.screenRefreshMs ?? 900} onChange={event => setDraft({ ...draft, screenRefreshMs: Number(event.target.value) })}/><span>ms</span></div>
            </div>
          </section>
          <section id="settings-panel-model" role="tabpanel" aria-labelledby="settings-tab-model" hidden={tab !== "model"}>
            <h3>AI Model</h3>
            <div className="settingsRow settingsModelRow">
              <label htmlFor="settings-key">OpenAI API key<small>{initial.apiKeyConfigured ? "Đã cấu hình · Để trống nếu không thay đổi." : "Chưa cấu hình API key."}</small></label>
              <input id="settings-key" type="password" autoComplete="new-password" disabled={saving} value={draft.apiKey ?? ""}
                placeholder={initial.apiKeyConfigured ? "Nhập key mới để thay đổi" : "Nhập API key"} onChange={event => setDraft({ ...draft, apiKey: event.target.value })}/>
            </div>
            <div className="settingsRow settingsModelRow">
              <label htmlFor="settings-model">Model<small>Tên model được dùng để xử lý tác vụ.</small></label>
              <input id="settings-model" disabled={saving} value={draft.model ?? ""} placeholder="gpt-4o" onChange={event => setDraft({ ...draft, model: event.target.value })}/>
            </div>
            <div className="settingsRow settingsModelRow">
              <label htmlFor="settings-url">Base URL<small>Địa chỉ API của nhà cung cấp model.</small></label>
              <input id="settings-url" disabled={saving} value={draft.baseUrl ?? ""} placeholder="https://api.openai.com/v1" onChange={event => setDraft({ ...draft, baseUrl: event.target.value })}/>
            </div>
          </section>
          <section id="settings-panel-email" role="tabpanel" aria-labelledby="settings-tab-email" hidden={tab !== "email"}>
            <h3>Email</h3>
            <p className="settingsAboutText">Mật khẩu được bảo vệ bằng Windows DPAPI cho tài khoản hiện tại. Nhà cung cấp có thể yêu cầu App Password.</p>
            <div className="settingsEmailGrid">
              <label>SMTP server<input disabled={saving} value={emailDraft.host} onChange={event=>{setEmailTouched(true);setEmailDraft({...emailDraft,host:event.target.value})}} placeholder="smtp.gmail.com"/></label>
              <label>Port<input type="number" min="1" max="65535" disabled={saving} value={emailDraft.port} onChange={event=>{setEmailTouched(true);setEmailDraft({...emailDraft,port:Number(event.target.value)})}}/></label>
              <label>Bảo mật<select disabled={saving} value={emailDraft.security} onChange={event=>{const security=event.target.value as "starttls"|"tls";setEmailTouched(true);setEmailDraft({...emailDraft,security,port:security==="tls"?465:587})}}><option value="starttls">TLS/STARTTLS (Port 587)</option><option value="tls">SSL/TLS (Port 465)</option></select></label>
              <label>Xác thực<span className="settingsEmailAuth"><input type="checkbox" checked disabled/> Bắt buộc (Bật)</span></label>
              <label>Username (địa chỉ Gmail)<input disabled={saving} autoComplete="username" value={emailDraft.username} onChange={event=>{setEmailTouched(true);setEmailDraft({...emailDraft,username:event.target.value})}}/></label>
              <label className="settingsEmailWide">Người nhận mặc định<input type="email" disabled={saving} value={emailDraft.defaultRecipient} onChange={event=>{setEmailTouched(true);setEmailDraft({...emailDraft,defaultRecipient:event.target.value})}}/></label>
              <label className="settingsEmailWide">Mật khẩu ứng dụng 16 ký tự (App Password)<small>{email?.passwordConfigured?"Đã cấu hình · Để trống để giữ nguyên.":"Chưa cấu hình."}</small><input type="password" autoComplete="new-password" disabled={saving} value={emailDraft.password??""} onChange={event=>{setEmailTouched(true);setEmailDraft({...emailDraft,password:event.target.value,clearPassword:false})}}/></label>
            </div>
            <div className="settingsEmailActions">
              <button type="button" disabled={saving||!emailDraft.host.trim()||!emailDraft.username.trim()||!emailDraft.defaultRecipient.trim()||!Number.isInteger(emailDraft.port)||(!emailDraft.password&&!email?.passwordConfigured)} onClick={async()=>{setEmailAction("Đang kiểm tra…");try{const current=await fetch("/api/settings/email",{cache:"no-store"}).then(response=>response.json());const response=await fetch("/api/settings/email/verify",{method:"POST",headers:{"content-type":"application/json","x-autostart-token":current.data?.csrfToken??""},body:JSON.stringify(emailDraft)});const payload=await response.json();setEmailAction(response.ok&&payload.ok?"Xác thực SMTP thành công":"Không thể xác thực: "+(payload.error?.message||"Lỗi"))}catch(cause){setEmailAction(String(cause))}}}>Kiểm tra kết nối</button>
              <button type="button" disabled={saving||!emailDraft.defaultRecipient.trim()||!emailDraft.host.trim()||!emailDraft.username.trim()||(!emailDraft.password&&!email?.passwordConfigured)} onClick={()=>{if(!window.confirm("Gửi email thử tới "+emailDraft.defaultRecipient+"?"))return;void fetch("/api/settings/email",{cache:"no-store"}).then(response=>response.json()).then(current=>fetch("/api/settings/email/test",{method:"POST",headers:{"content-type":"application/json","x-autostart-token":current.data?.csrfToken??""},body:JSON.stringify({recipient:emailDraft.defaultRecipient,confirm:true,settings:emailDraft})})).then(async response=>{const payload=await response.json();setEmailAction(response.ok&&payload.ok?"Đã gửi email thử":"Gửi thử thất bại: "+(payload.error?.message||"Lỗi"))})}}>Gửi email thử</button>
              {email?.passwordConfigured&&<button type="button" disabled={saving} onClick={()=>{if(window.confirm("Xóa mật khẩu SMTP đã lưu?")){setEmailTouched(true);setEmailDraft({...emailDraft,password:undefined,clearPassword:true})}}}>Xóa credential</button>}
            </div>
            {emailTouched&&<p className="settingsAboutText">Có thay đổi chưa lưu. Bạn có thể kiểm tra hoặc gửi thử bằng bản nháp; cấu hình chỉ được lưu khi nhấn Lưu thay đổi.</p>}
            {emailAction&&<p role="status" className="settingsAboutText">{emailAction}</p>}
          </section>
          <section id="settings-panel-about" role="tabpanel" aria-labelledby="settings-tab-about" hidden={tab !== "about"}>
            <h3>Giới thiệu</h3>
            <div className="settingsAbout"><span className="settingsAppLogo" aria-hidden="true">A</span><div><h4>Android Agent</h4><p>Trung tâm điều khiển Android bằng AI.</p></div></div>
            <p className="settingsAboutText">Điều khiển thiết bị, theo dõi tiến độ trong hội thoại và tự động thực hiện tác vụ theo lịch.</p>
            <p className="settingsAboutText">Lịch chạy chỉ hoạt động khi server đang mở và thiết bị sẵn sàng kết nối.</p>
          </section>
          {error && <p className="settingsError" role="alert">{error}</p>}
        </div>
      </div>
      <footer className="settingsFooter">
        <button type="button" disabled={saving} onClick={onClose}>Hủy</button>
        <button className="settingsSave" type="submit" disabled={saving}>{saving ? "Đang lưu…" : "Lưu thay đổi"}</button>
      </footer>
    </form>
  </div>;
}
