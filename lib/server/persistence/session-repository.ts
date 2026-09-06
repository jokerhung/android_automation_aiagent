import fs from "node:fs";
import path from "node:path";
import type { Conversation, Message, RunRecord, RunStep } from "@/lib/contracts/types";
type Store = { conversations: Conversation[]; settings: Record<string,string> };
const file = path.join(process.cwd(), "data", "sessions.json");
export class SessionRepository {
 private store: Store = { conversations: [], settings: {} }; private loaded=false;
 private load(){if(this.loaded)return;this.loaded=true;try{this.store=JSON.parse(fs.readFileSync(file,"utf8"))}catch{}}
 private save(){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+".tmp";fs.writeFileSync(tmp,JSON.stringify(this.store,null,2));fs.renameSync(tmp,file)}
 list(){this.load();return [...this.store.conversations].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(c=>({...c,messages:[],runs:c.runs.map(r=>({...r,steps:[]}))}))}
 get(id:string){this.load();return this.store.conversations.find(c=>c.id===id)||null}
 create(title="Cuộc trò chuyện mới"){this.load();const now=new Date().toISOString();const c:Conversation={id:crypto.randomUUID(),title,deviceSerial:null,createdAt:now,updatedAt:now,messages:[],runs:[]};this.store.conversations.push(c);this.save();return c}
 addMessage(id:string,role:Message["role"],content:string){const c=this.get(id);if(!c)throw new Error("Conversation not found");const m:Message={id:crypto.randomUUID(),conversationId:id,role,content,createdAt:new Date().toISOString()};c.messages.push(m);c.updatedAt=m.createdAt;if(role==="user"&&c.title==="Cuộc trò chuyện mới")c.title=content.slice(0,60);this.save();return m}
 createRun(conversationId:string,deviceSerial:string,goal:string,maxSteps:number){const c=this.get(conversationId);if(!c)throw new Error("Conversation not found");const r:RunRecord={id:crypto.randomUUID(),conversationId,deviceSerial,goal,status:"queued",maxSteps,errorCode:null,result:null,startedAt:new Date().toISOString(),endedAt:null,steps:[]};c.deviceSerial=deviceSerial;c.runs.push(r);c.updatedAt=r.startedAt;this.save();return r}
 findRun(id:string){this.load();for(const c of this.store.conversations){const r=c.runs.find(x=>x.id===id);if(r)return r}return null}
 updateRun(id:string,patch:Partial<RunRecord>){const r=this.findRun(id);if(!r)throw new Error("Run not found");Object.assign(r,patch);this.save();return r}
 addStep(runId:string,action:RunStep["action"],summary:string,durationMs:number|null){const r=this.findRun(runId);if(!r)throw new Error("Run not found");const step:RunStep={id:crypto.randomUUID(),runId,stepNo:r.steps.length+1,action,summary,durationMs,createdAt:new Date().toISOString()};r.steps.push(step);this.save();return step}
}
export const sessionRepository=new SessionRepository();
