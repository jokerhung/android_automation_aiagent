"use client";
import {useEffect,useMemo,useState} from "react";
import type {DeviceSummary,Schedule} from "@/lib/contracts/types";
type Api<T>={ok:boolean;data:T;error?:{message:string}};
type Form=Pick<Schedule,"name"|"startDate"|"localTime"|"timezone"|"repeatDays"|"prompt"|"deviceSerial"|"logDirectory">;
const initial=(serial=""):Form=>{const date=new Date(Date.now()+86400000);return{name:"",startDate:date.toISOString().slice(0,10),localTime:"08:00",timezone:"Asia/Bangkok",repeatDays:1,prompt:"",deviceSerial:serial,logDirectory:"D:\android-agent-logs"}};
export default function SchedulePanel({devices,onClose}:{devices:DeviceSummary[];onClose:()=>void}){
 const [items,setItems]=useState<Schedule[]>([]),[form,setForm]=useState<Form>(initial(devices.find(d=>d.state==="device")?.serial)),[editing,setEditing]=useState<string|null>(null),[error,setError]=useState(""),[saving,setSaving]=useState(false);
 const load=async()=>{const response=await fetch("/api/schedules",{cache:"no-store"}),payload=await response.json() as Api<Schedule[]>;if(payload.ok)setItems(payload.data)};
 useEffect(()=>{void load();const source=new EventSource("/api/schedules/events");for(const type of ["schedule.created","schedule.updated","schedule.deleted"])source.addEventListener(type,()=>void load());return()=>source.close()},[]);
 const end=useMemo(()=>{const [year,month,day]=form.startDate.split("-").map(Number),d=new Date(Date.UTC(year,month-1,day+Math.max(0,form.repeatDays-1)));return d.toISOString().slice(0,10)},[form.startDate,form.repeatDays]);
 async function save(){setSaving(true);setError("");try{const response=await fetch(editing?"/api/schedules/"+editing:"/api/schedules",{method:editing?"PATCH":"POST",headers:{"content-type":"application/json"},body:JSON.stringify(form)}),payload=await response.json() as Api<Schedule>;if(!payload.ok)throw new Error(payload.error?.message||"Không thể lưu lịch");setForm(initial(form.deviceSerial));setEditing(null);await load()}catch(cause){setError(cause instanceof Error?cause.message:String(cause))}finally{setSaving(false)}}
 async function validateDirectory(){setError("");const response=await fetch("/api/schedules/validate-log-directory",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({logDirectory:form.logDirectory})}),payload=await response.json() as Api<{logDirectory:string}>;if(payload.ok){setForm({...form,logDirectory:payload.data.logDirectory});setError("Thư mục hợp lệ và có thể ghi.")}else setError(payload.error?.message||"Thư mục không hợp lệ")}
 async function command(item:Schedule,action:"pause"|"resume"|"run-now"){const response=await fetch("/api/schedules/"+item.id+"/"+action,{method:"POST"}),payload=await response.json() as Api<unknown>;if(!payload.ok)setError(payload.error?.message||"Thao tác thất bại");else await load()}
 return <section className="schedulePanel">
  <header><div><h1>Lịch chạy</h1><p>Tự động chạy tác vụ Android theo lịch</p></div><button onClick={onClose}>Về hội thoại</button></header>
  <div className="scheduleBody">
   <form onSubmit={e=>{e.preventDefault();void save()}}>
    <h2>{editing?"Sửa lịch":"Tạo lịch mới"}</h2>
    <label>Tên lịch<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
    <div className="scheduleGrid">
     <label>Ngày bắt đầu<input type="date" required value={form.startDate} onChange={e=>setForm({...form,startDate:e.target.value})}/></label>
     <label>Giờ chạy<input type="time" required value={form.localTime} onChange={e=>setForm({...form,localTime:e.target.value})}/></label>
     <label>Số ngày<input type="number" min="1" max="365" value={form.repeatDays} onChange={e=>setForm({...form,repeatDays:Number(e.target.value)})}/></label>
     <label>Múi giờ<input required value={form.timezone} onChange={e=>setForm({...form,timezone:e.target.value})}/></label>
    </div>
    <small>Chạy mỗi ngày từ {form.startDate} đến {end}, lúc {form.localTime} ({form.timezone}), tính cả ngày bắt đầu.</small>
    <label>Prompt<textarea required value={form.prompt} onChange={e=>{const prompt=e.target.value;setForm({...form,prompt,name:form.name||prompt.split(/\r?\n/)[0].trim().slice(0,120)})}}/></label><small>Prompt được lưu trong SQLite; không nhập API key hoặc bí mật dài hạn nếu không cần thiết.</small>
    <label>Thiết bị<select value={form.deviceSerial} onChange={e=>setForm({...form,deviceSerial:e.target.value})}>{devices.map(d=><option key={d.serial} value={d.serial}>{d.displayName} · {d.state}</option>)}</select></label>
    <label>Thư mục log<input required value={form.logDirectory} onChange={e=>setForm({...form,logDirectory:e.target.value})}/></label>
    <button type="button" onClick={()=>void validateDirectory()}>Kiểm tra thư mục</button>
    {error&&<p className="error">{error}</p>}
    <div className="scheduleActions"><button type="submit" className="run" disabled={saving}>{saving?"Đang lưu…":"Lưu lịch"}</button>{editing&&<button type="button" onClick={()=>{setEditing(null);setForm(initial(form.deviceSerial))}}>Hủy</button>}</div>
   </form>
   <div className="scheduleList">
    <h2>Danh sách lịch</h2>{!items.length&&<p>Chưa có lịch chạy.</p>}
    {items.map(item=><article key={item.id}>
     <div><h3>{item.name}</h3><span className={"scheduleStatus "+item.status}>{item.latestOccurrence?.status==="running"?"⟳ đang chạy":item.latestOccurrence?.status||item.status}</span></div>
     <p>{item.deviceSerial}</p>
     <p>Lần tiếp theo: {item.nextRunAt?new Date(item.nextRunAt).toLocaleString("vi-VN",{timeZone:item.timezone}):"Đã hoàn thành"}</p>
     <p>{item.completedOccurrences}/{item.repeatDays} ngày · {item.logDirectory}</p>
     {item.latestOccurrence&&<p>Lần gần nhất: {item.latestOccurrence.status}{item.latestOccurrence.logFile?" · "+item.latestOccurrence.logFile:""}</p>}
     <div>
      <button onClick={()=>{setEditing(item.id);setForm({name:item.name,startDate:item.startDate,localTime:item.localTime,timezone:item.timezone,repeatDays:item.repeatDays,prompt:item.prompt,deviceSerial:item.deviceSerial,logDirectory:item.logDirectory})}}>Sửa</button>
      <button onClick={()=>void command(item,item.status==="paused"?"resume":"pause")}>{item.status==="paused"?"Tiếp tục":"Tạm dừng"}</button>
      <button onClick={()=>void command(item,"run-now")}>Chạy ngay</button>
      <button onClick={async()=>{if(confirm("Xóa lịch này?")){await fetch("/api/schedules/"+item.id,{method:"DELETE"});await load()}}}>Xóa</button>
     </div>
    </article>)}
   </div>
  </div>
 </section>
}
