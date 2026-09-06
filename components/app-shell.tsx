"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Conversation, DeviceSummary, RunRecord } from "@/lib/contracts/types";
import { pointerToNormalized } from "@/lib/shared/coordinates";

type Api<T> = { ok: boolean; data: T; error?: { message: string } };

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
  const [maxSteps, setMaxSteps] = useState(15);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const run = useMemo(() => conversation?.runs.at(-1) || null, [conversation]);
  const active = Boolean(run && ["queued", "running", "pausing", "paused", "cancelling"].includes(run.status));

  const loadDevices = useCallback(async () => {
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
    }
  }, []);

  const loadConversations = useCallback(async () => {
    const list = await get<Conversation[]>("/api/conversations");
    setConversations(list);
    if (!conversation && list[0]) setConversation(await get<Conversation>("/api/conversations/" + list[0].id));
  }, [conversation]);

  useEffect(() => {
    void loadDevices();
    void loadConversations();
    const timer = setInterval(() => void loadDevices(), 3000);
    return () => clearInterval(timer);
  }, [loadDevices, loadConversations]);

  useEffect(() => {
    if (!conversation) return;
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(protocol + "://" + location.host + "/ws/events?conversationId=" + conversation.id);
    socket.onmessage = () => {
      void get<Conversation>("/api/conversations/" + conversation.id).then(setConversation);
      void loadConversations();
      setRefresh((value) => value + 1);
    };
    return () => socket.close();
  }, [conversation?.id, loadConversations]);

  useEffect(() => {
    if (!selected) return;
    const timer = setInterval(() => setRefresh((value) => value + 1), 900);
    return () => clearInterval(timer);
  }, [selected]);

  async function createConversation() {
    const response = await fetch("/api/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const payload = (await response.json()) as Api<Conversation>;
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
    if (!run || !conversation) return;
    await fetch("/api/runs/" + run.id + "/" + type, { method: "POST" });
    setConversation(await get<Conversation>("/api/conversations/" + conversation.id));
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
    return pointerToNormalized(event.clientX, event.clientY, { left: box.left, top: box.top, width: box.width, height: box.height });
  }

  const currentDevice = devices.find((device) => device.serial === selected);

  return <main className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="logo">A</span><div><b>Android Agent</b><small>Trung tâm điều khiển cục bộ</small></div></div>
      <button className="new" onClick={createConversation}>＋ Cuộc trò chuyện mới</button>
      <h3>Gần đây</h3>
      <div className="conversations">{conversations.map((item) => <button key={item.id} className={conversation?.id === item.id ? "selected" : ""} onClick={() => openConversation(item.id)}><span>{item.title}</span><small>{new Date(item.updatedAt).toLocaleString("vi-VN")}</small></button>)}</div>
      <div className="sidebarFoot"><span>● {devices.filter((device) => device.state === "device").length} thiết bị trực tuyến</span><span>⚙ Cài đặt qua .env</span></div>
    </aside>

    <section className="chat">
      <header><div><h1>{conversation?.title || "Android Vision Agent"}</h1><p>{selected || "Chưa chọn thiết bị"}</p></div><span className={"status " + (run?.status || "idle")}>{run?.status || "sẵn sàng"}</span></header>
      <div className="timeline">
        {!conversation && <div className="empty"><div className="spark">✦</div><h2>Điều khiển Android bằng AI</h2><p>Tạo cuộc trò chuyện, chọn điện thoại rồi mô tả điều bạn muốn thực hiện.</p></div>}
        {conversation?.messages.map((message) => <article key={message.id} className={"message " + message.role}><b>{message.role === "user" ? "Bạn" : "Agent"}</b><p>{message.content}</p></article>)}
        {conversation?.runs.flatMap((item) => item.steps.map((step) => <article className="step" key={step.id}><div><span>Bước {step.stepNo}</span><b>{step.action?.action || "trạng thái"}</b></div><p>{step.summary}</p><small>{step.durationMs ? step.durationMs + " ms" : ""}</small></article>))}
      </div>
      <footer>
        <textarea value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="Ví dụ: Mở Cài đặt và vào mục Wi-Fi..." disabled={active} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} />
        <div className="composerRow"><label>Số bước tối đa <input type="number" min="1" max="50" value={maxSteps} onChange={(event) => setMaxSteps(Number(event.target.value))} /></label>{run?.status === "running" && <button onClick={() => control("pause")}>Tạm dừng</button>}{run?.status === "paused" && <button onClick={() => control("resume")}>Tiếp tục</button>}{active && <button className="danger" onClick={() => control("cancel")}>Dừng</button>}<button className="run" disabled={!conversation || !selected || !goal.trim() || active} onClick={send}>Chạy ➜</button></div>
        {error && <p className="error">{error}</p>}
      </footer>
    </section>

    <aside className="device">
      <header><div><h2>Màn hình Android</h2><span className="live">● TRỰC TIẾP</span></div><select value={selected} disabled={active} onChange={(event) => setSelected(event.target.value)}><option value="">{devices.length ? "Chọn điện thoại" : "Không tìm thấy điện thoại"}</option>{devices.map((device) => <option key={device.serial} value={device.state === "device" ? device.serial : ""} disabled={device.state !== "device"}>{device.displayName} · {device.state}</option>)}</select></header>
      <div className="phoneWrap">{selected ? <div className="phone"><img draggable={false} src={"/api/devices/" + encodeURIComponent(selected) + "/snapshot?v=" + refresh} alt="Màn hình Android" onPointerDown={(event) => drag.current = point(event)} onPointerUp={(event) => { const end = point(event); const start = drag.current; drag.current = null; if (!start) return; const distance = Math.hypot(end.x - start.x, end.y - start.y); void action(distance > 30 ? { type: "swipe", ...start, x2: end.x, y2: end.y, durationMs: 300 } : { type: "tap", x: end.x, y: end.y }); }} /></div> : <div className="noPhone"><span>▯</span><b>Chưa có thiết bị</b><p>Bật USB debugging và xác nhận quyền ADB trên điện thoại.</p></div>}</div>
      <div className="keys">{[["↩", "Quay lại", 4], ["⌂", "Trang chủ", 3], ["▣", "Gần đây", 187], ["⏻", "Nguồn", 26], ["＋", "Âm lượng +", 24], ["−", "Âm lượng -", 25]].map(([icon, label, keycode]) => <button key={String(label)} disabled={!selected || active} onClick={() => action({ type: "keyevent", keycode })}><b>{icon}</b><small>{label}</small></button>)}</div>
      <div className="deviceInfo">{currentDevice ? <><span>{currentDevice.width} × {currentDevice.height}</span><span>Ảnh chụp ADB</span></> : <span>Chờ kết nối...</span>}</div>
    </aside>
  </main>;
}
