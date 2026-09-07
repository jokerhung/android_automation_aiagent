"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Conversation, DeviceSummary, RunRecord } from "@/lib/contracts/types";
import { containedMediaViewport, pointerToNormalized } from "@/lib/shared/coordinates";
import {AndroidStreamPlayer,type ClientStreamSession} from "@/components/android-stream-player";

type Api<T> = { ok: boolean; data: T; error?: { message: string } };
type Settings={model?:string;baseUrl?:string;maxSteps?:number;screenRefreshMs?:number;apiKeyConfigured?:boolean};

async function get<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const payload = (await response.json()) as Api<T>;
  if (!payload.ok) throw new Error(payload.error?.message || "Yêu cầu thất bại");
  return payload.data;
}

export default function AppShell() {
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [selected, setSelected] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [goal, setGoal] = useState("");
  const [maxSteps, setMaxSteps] = useState(50);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [devicesRefreshing,setDevicesRefreshing]=useState(false);
  const [screenRefreshMs,setScreenRefreshMs]=useState(900);
  const [showSettings,setShowSettings]=useState(false);
  const [settings,setSettings]=useState<Settings>({});
  const [streamSession,setStreamSession]=useState<ClientStreamSession|null>(null);
  const [streamGeneration,setStreamGeneration]=useState(0);
  const [controlPending,setControlPending]=useState<"pause"|"resume"|"cancel"|null>(null);
  const [liveStep,setLiveStep]=useState<{step:number;maxSteps:number;phase:string}|null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const conversationInitialized=useRef(false);
  const run = useMemo(() => conversation?.runs.at(-1) || null, [conversation]);
  const active = Boolean(run && ["queued", "running", "pausing", "paused", "cancelling"].includes(run.status));

  const loadDevices = useCallback(async () => {
    setDevicesRefreshing(true);
    try {
      const list = await get<DeviceSummary[]>("/api/devices");
      setDevices(list);
      setSelected((old) => {
        if (old && list.some((device) => device.serial === old && device.state === "device")) return old;
        const online = list.filter((device) => device.state === "device");
        return online.length === 1 ? online[0].serial : "";
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDevicesRefreshing(false);
    }
  }, []);

  const loadConversations = useCallback(async () => {
    const list=await get<Conversation[]>("/api/conversations");
    setConversations(list);
    return list;
  }, []);

  useEffect(()=>{void get<Settings>("/api/settings").then(value=>{setSettings(value);if(value.maxSteps)setMaxSteps(value.maxSteps);if(value.screenRefreshMs)setScreenRefreshMs(value.screenRefreshMs)}).catch(cause=>setError(cause instanceof Error?cause.message:String(cause)))},[]);

  useEffect(() => {
    void loadDevices();
    void loadConversations().then(async list=>{if(!conversationInitialized.current&&list[0]){conversationInitialized.current=true;setConversation(await get<Conversation>("/api/conversations/"+list[0].id))}}).catch(cause=>setError(cause instanceof Error?cause.message:String(cause)));
  }, [loadDevices, loadConversations]);

  useEffect(() => {
    if(!conversation)return;
    const currentRun=conversation.runs.at(-1);
    const reload=()=>{void get<Conversation>("/api/conversations/"+conversation.id).then(setConversation);void loadConversations();setRefresh(value=>value+1)};
    if(!currentRun||!["queued","running","pausing","paused","cancelling"].includes(currentRun.status)){setLiveStep(null);return}
    const source=new EventSource("/api/runs/"+currentRun.id+"/events");
    source.addEventListener("run.step.started",event=>{const data=JSON.parse((event as MessageEvent).data) as {step:number;maxSteps:number};setLiveStep({...data,phase:"Đang quan sát và phân tích màn hình…"})});
    source.addEventListener("run.step.planned",event=>{const data=JSON.parse((event as MessageEvent).data) as {step:number;action:string;summary:string};setLiveStep(current=>({step:data.step,maxSteps:current?.maxSteps||currentRun.maxSteps,phase:data.summary||"Đang thực hiện "+data.action+"…"}))});
    source.addEventListener("run.step.action",()=>{setLiveStep(null);reload()});
    source.addEventListener("run.step",reload);
    for(const type of ["run.status","run.completed","run.failed","run.cancelled"])source.addEventListener(type,()=>{setLiveStep(null);reload()});
    source.onerror=()=>{if(source.readyState===EventSource.CLOSED)setTimeout(reload,1000)};
    return()=>source.close();
  }, [conversation?.id,run?.id,run?.status,loadConversations]);

  useEffect(()=>{
    if(!selected){setStreamSession(null);return}
    let session:ClientStreamSession|null=null,cancelled=false;
    void fetch("/api/devices/"+encodeURIComponent(selected)+"/stream",{method:"POST"}).then(response=>response.json()).then((payload:Api<ClientStreamSession>)=>{if(!cancelled&&payload.ok){session=payload.data;setStreamSession(payload.data)}}).catch(cause=>setError(cause instanceof Error?cause.message:String(cause)));
    return()=>{cancelled=true;if(session)void fetch("/api/devices/"+encodeURIComponent(selected)+"/stream?token="+encodeURIComponent(session.token),{method:"DELETE"})}
  },[selected,streamGeneration]);

  useEffect(() => {
    if (!selected) return;
    const timer = setInterval(() => setRefresh((value) => value + 1),screenRefreshMs);
    return () => clearInterval(timer);
  }, [selected,screenRefreshMs]);

  async function renameConversation(){if(!conversation)return;const title=window.prompt("Tên cuộc trò chuyện",conversation.title)?.trim();if(!title)return;const response=await fetch("/api/conversations/"+conversation.id,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({title})});const payload=await response.json() as Api<Conversation>;if(payload.ok){setConversation(payload.data);await loadConversations()}else setError(payload.error?.message||"Không thể đổi tên")}

  async function deleteConversation(){if(!conversation||!window.confirm("Xóa cuộc trò chuyện này?"))return;const response=await fetch("/api/conversations/"+conversation.id,{method:"DELETE"});const payload=await response.json() as Api<{id:string}>;if(!payload.ok){setError(payload.error?.message||"Không thể xóa");return}setConversation(null);await loadConversations()}

  async function openSettings(){const value=await get<Settings>("/api/settings");setSettings(value);if(value.maxSteps)setMaxSteps(value.maxSteps);if(value.screenRefreshMs)setScreenRefreshMs(value.screenRefreshMs);setShowSettings(true)}
  async function saveSettings(){const {apiKeyConfigured,...body}=settings;const response=await fetch("/api/settings",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const payload=await response.json() as Api<Settings>;if(!payload.ok){setError(payload.error?.message||"Không thể lưu cài đặt");return}setSettings({...payload.data,apiKeyConfigured});if(payload.data.maxSteps)setMaxSteps(payload.data.maxSteps);if(payload.data.screenRefreshMs)setScreenRefreshMs(payload.data.screenRefreshMs);setShowSettings(false)}

  async function createConversation() {
    const response = await fetch("/api/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const payload = (await response.json()) as Api<Conversation>;
    conversationInitialized.current=true;
    setConversation(payload.data);
    setConversations((items) => [payload.data, ...items]);
  }

  async function openConversation(id: string) {
    setConversation(await get<Conversation>("/api/conversations/" + id));
  }

  async function send() {
    if (!conversation || !selected || !goal.trim()) return;
    setError("");
    const response = await fetch("/api/conversations/" + conversation.id + "/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal, deviceSerial: selected, maxSteps }),
    });
    const payload = (await response.json()) as Api<RunRecord>;
    if (!payload.ok) {
      setError(payload.error?.message || "Không thể chạy tác vụ");
      return;
    }
    setGoal("");
    setConversation(await get<Conversation>("/api/conversations/" + conversation.id));
  }

  async function control(type: "pause" | "resume" | "cancel") {
    if (!run || !conversation || controlPending) return;
    setError("");setControlPending(type);
    try {
      const response=await fetch("/api/runs/"+run.id+"/"+type,{method:"POST"});
      const payload=await response.json() as Api<RunRecord>;
      if(!response.ok||!payload.ok)throw new Error(payload.error?.message||"Không thể điều khiển tác vụ");
      setConversation(await get<Conversation>("/api/conversations/"+conversation.id));
    } catch(cause) { setError(cause instanceof Error?cause.message:String(cause)); }
    finally { setControlPending(null); }
  }

  async function action(body: unknown) {
    if (!selected || active) return;
    const response = await fetch("/api/devices/" + encodeURIComponent(selected) + "/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) setError("Không thể điều khiển thiết bị");
    setRefresh((value) => value + 1);
  }

  function point(event: React.PointerEvent<HTMLImageElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const media=containedMediaViewport({left:box.left,top:box.top,width:box.width,height:box.height},event.currentTarget.naturalWidth,event.currentTarget.naturalHeight);
    return pointerToNormalized(event.clientX,event.clientY,media);
  }

  const currentDevice = devices.find((device) => device.serial === selected);

  return <main className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="logo">A</span><div><b>Android Agent</b><small>Trung tâm điều khiển cục bộ</small></div></div>
      <button className="new" onClick={createConversation}>＋ Cuộc trò chuyện mới</button>
      <h3>Gần đây</h3>
      <div className="conversations">{conversations.map((item) => <button key={item.id} className={conversation?.id === item.id ? "selected" : ""} onClick={() => openConversation(item.id)}><span>{item.title}</span><small>{new Date(item.updatedAt).toLocaleString("vi-VN")}</small></button>)}</div>
      <div className="sidebarFoot"><span>● {devices.filter((device) => device.state === "device").length} thiết bị trực tuyến</span><button onClick={openSettings}>⚙ Cài đặt</button></div>
    </aside>

    <section className="chat">
      <header><div><h1>{conversation?.title || "Android Vision Agent"}</h1><p>{selected || "Chưa chọn thiết bị"}</p></div><div className="headerActions">{conversation&&<><button onClick={renameConversation}>Đổi tên</button><button onClick={deleteConversation} disabled={active}>Xóa</button></>}<span className={"status "+(run?.status||"idle")}>{run?.status||"sẵn sàng"}</span></div></header>
      <div className="timeline">
        {!conversation && <div className="empty"><div className="spark">✦</div><h2>Điều khiển Android bằng AI</h2><p>Tạo cuộc trò chuyện, chọn điện thoại rồi mô tả điều bạn muốn thực hiện.</p></div>}
        {conversation?.messages.map((message) => <article key={message.id} className={"message " + message.role}><b>{message.role === "user" ? "Bạn" : "Agent"}</b><p>{message.content}</p></article>)}
        {conversation?.runs.flatMap((item) => item.steps.map((step) => <article className="step" key={step.id}><div><span>Bước {step.stepNo}</span><b>{step.action?.action || "trạng thái"}</b></div><p>{step.summary}</p><small>{step.durationMs ? step.durationMs + " ms" : ""}</small></article>))}
        {liveStep&&<article className="step liveStep"><div><span>Bước {liveStep.step}/{liveStep.maxSteps}</span><b>đang chạy</b></div><p>{liveStep.phase}</p><small>Đang xử lý…</small></article>}
      </div>
      <footer>
        <textarea value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="Ví dụ: Mở Cài đặt và vào mục Wi-Fi..." disabled={active} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} />
        <div className="composerRow"><label>Số bước tối đa <input type="number" min="1" max="50" value={maxSteps} onChange={(event) => setMaxSteps(Number(event.target.value))} /></label>{run?.status === "running" && <button onClick={() => control("pause")}>Tạm dừng</button>}{run?.status === "paused" && <button onClick={() => control("resume")}>Tiếp tục</button>}{active && <button className="danger" disabled={Boolean(controlPending)||run?.status==="cancelling"} onClick={() => control("cancel")}>{controlPending==="cancel"||run?.status==="cancelling"?"Đang dừng…":"Dừng"}</button>}<button className="run" disabled={!conversation || !selected || !goal.trim() || active} onClick={send}>Chạy ➜</button></div>
        {error && <p className="error">{error}</p>}
      </footer>
    </section>

    <aside className="device">
      <header><div><h2>Màn hình Android</h2><span className="live">● {streamSession?.mode==="scrcpy"?"SCRCPY":"SNAPSHOT"}</span></div><div style={{display:"flex",alignItems:"stretch",gap:8,marginBottom:0}}><select style={{minWidth:0}} value={selected} disabled={active} onChange={(event) => setSelected(event.target.value)}><option value="">{devices.length ? "Chọn điện thoại" : "Không tìm thấy điện thoại"}</option>{devices.map((device) => <option key={device.serial} value={device.state === "device" ? device.serial : ""} disabled={device.state !== "device"}>{device.displayName} · {device.state}</option>)}</select><button className="run" style={{width:40,padding:0,fontSize:20}} type="button" onClick={loadDevices} disabled={devicesRefreshing} aria-label={devicesRefreshing?"Đang làm mới danh sách thiết bị":"Làm mới danh sách thiết bị"} title="Làm mới danh sách thiết bị">↻</button></div></header>
      <div className="phoneWrap">{selected ? <div className="phone"><AndroidStreamPlayer session={streamSession} refresh={refresh} onPointerDown={(event)=>drag.current=point(event)} onPointerUp={(event)=>{const end=point(event),start=drag.current;drag.current=null;if(!start)return;const distance=Math.hypot(end.x-start.x,end.y-start.y);void action(distance>30?{type:"swipe",...start,x2:end.x,y2:end.y,durationMs:300}:{type:"tap",x:end.x,y:end.y})}}/></div> : <div className="noPhone"><span>▯</span><b>Chưa có thiết bị</b><p>Bật USB debugging và xác nhận quyền ADB trên điện thoại.</p></div>}</div>
      <div className="deviceInfo">{currentDevice ? <><span>{currentDevice.width} × {currentDevice.height}</span><button onClick={()=>setStreamGeneration(value=>value+1)}>Kết nối lại</button><button onClick={()=>setRefresh(value=>value+1)}>Chụp mới</button><span>{streamSession?.mode==="scrcpy"?"Video scrcpy":"Ảnh chụp ADB"}</span></> : <span>Chờ kết nối...</span>}</div>
    </aside>
    {showSettings&&<div className="modalBackdrop" onClick={()=>setShowSettings(false)}><section className="modal" onClick={event=>event.stopPropagation()}><h2>Cài đặt</h2><label>Model<input value={settings.model||""} placeholder="gpt-4o" onChange={event=>setSettings({...settings,model:event.target.value})}/></label><label>Base URL<input value={settings.baseUrl||""} placeholder="https://api.openai.com/v1" onChange={event=>setSettings({...settings,baseUrl:event.target.value})}/></label><label>Số bước tối đa<input type="number" min="1" max="50" value={settings.maxSteps||50} onChange={event=>setSettings({...settings,maxSteps:Number(event.target.value)})}/></label><label>Làm mới màn hình (ms)<input type="number" min="300" max="10000" value={settings.screenRefreshMs||900} onChange={event=>setSettings({...settings,screenRefreshMs:Number(event.target.value)})}/></label><p>API key: {settings.apiKeyConfigured?"Đã cấu hình trong .env":"Chưa cấu hình"}</p><div><button onClick={()=>setShowSettings(false)}>Hủy</button><button className="run" onClick={saveSettings}>Lưu</button></div></section></div>}
  </main>;
}
