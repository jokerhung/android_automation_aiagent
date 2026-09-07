import "@/lib/server/server-guard";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { AgentAction, Conversation, Message, RunRecord, RunStatus, RunStep } from "@/lib/contracts/types";

type ConversationRow = { id:string; title:string; device_serial:string|null; created_at:string; updated_at:string };
type MessageRow = { id:string; conversation_id:string; role:Message["role"]; content:string; created_at:string };
type RunRow = { id:string; conversation_id:string; device_serial:string; goal:string; status:RunStatus; max_steps:number; error_code:string|null; result:string|null; started_at:string; ended_at:string|null };
type StepRow = { id:string; run_id:string; step_no:number; action_json:string|null; summary:string; duration_ms:number|null; created_at:string };

export class SessionRepository {
  private database: Database.Database;

  constructor(databasePath = path.join(process.cwd(), "data", "app.db")) {
    if (databasePath !== ":memory:") fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    this.database.pragma("busy_timeout = 5000");
    this.migrate();
    this.importLegacyJson(databasePath);
  }

  private migrate() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, device_serial TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        device_serial TEXT NOT NULL, goal TEXT NOT NULL, status TEXT NOT NULL, max_steps INTEGER NOT NULL,
        error_code TEXT, result TEXT, started_at TEXT NOT NULL, ended_at TEXT
      );
      CREATE TABLE IF NOT EXISTS run_steps (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        step_no INTEGER NOT NULL, action_json TEXT, summary TEXT NOT NULL,
        duration_ms INTEGER, created_at TEXT NOT NULL, UNIQUE(run_id, step_no)
      );
      CREATE TABLE IF NOT EXISTS run_events (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_run_events ON run_events(run_id, created_at);
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_runs_conversation ON runs(conversation_id, started_at);
      CREATE INDEX IF NOT EXISTS idx_steps_run ON run_steps(run_id, step_no);
    `);
  }

  private importLegacyJson(databasePath:string) {
    if (databasePath === ":memory:") return;
    const legacy = path.join(process.cwd(), "data", "sessions.json");
    if (!fs.existsSync(legacy) || (this.database.prepare("SELECT COUNT(*) AS count FROM conversations").get() as {count:number}).count > 0) return;
    try {
      const store = JSON.parse(fs.readFileSync(legacy, "utf8")) as { conversations?: Conversation[] };
      const insert = this.database.transaction(() => {
        for (const conversation of store.conversations ?? []) {
          this.database.prepare("INSERT INTO conversations VALUES (?, ?, ?, ?, ?)").run(conversation.id, conversation.title, conversation.deviceSerial, conversation.createdAt, conversation.updatedAt);
          for (const message of conversation.messages) this.database.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?)").run(message.id, message.conversationId, message.role, message.content, message.createdAt);
          for (const run of conversation.runs) {
            this.database.prepare("INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(run.id, run.conversationId, run.deviceSerial, run.goal, run.status, run.maxSteps, run.errorCode, run.result, run.startedAt, run.endedAt);
            for (const step of run.steps) this.database.prepare("INSERT INTO run_steps VALUES (?, ?, ?, ?, ?, ?, ?)").run(step.id, step.runId, step.stepNo, step.action ? JSON.stringify(step.action) : null, step.summary, step.durationMs, step.createdAt);
          }
        }
      });
      insert();
      fs.renameSync(legacy, legacy + ".migrated");
    } catch (error) {
      console.error("Không thể nhập dữ liệu JSON cũ:", error instanceof Error ? error.message : error);
    }
  }

  private mapStep(row:StepRow): RunStep { return { id:row.id, runId:row.run_id, stepNo:row.step_no, action:row.action_json ? JSON.parse(row.action_json) as AgentAction : null, summary:row.summary, durationMs:row.duration_ms, createdAt:row.created_at }; }
  private mapRun(row:RunRow, includeSteps=true): RunRecord { const steps=includeSteps ? (this.database.prepare("SELECT * FROM run_steps WHERE run_id=? ORDER BY step_no").all(row.id) as StepRow[]).map(item=>this.mapStep(item)) : []; return { id:row.id, conversationId:row.conversation_id, deviceSerial:row.device_serial, goal:row.goal, status:row.status, maxSteps:row.max_steps, errorCode:row.error_code, result:row.result, startedAt:row.started_at, endedAt:row.ended_at, steps }; }
  private mapConversation(row:ConversationRow, full=true): Conversation { const messages=full ? (this.database.prepare("SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at").all(row.id) as MessageRow[]).map(item=>({id:item.id,conversationId:item.conversation_id,role:item.role,content:item.content,createdAt:item.created_at})) : []; const runs=(this.database.prepare("SELECT * FROM runs WHERE conversation_id=? ORDER BY started_at").all(row.id) as RunRow[]).map(item=>this.mapRun(item,full)); return { id:row.id,title:row.title,deviceSerial:row.device_serial,createdAt:row.created_at,updatedAt:row.updated_at,messages,runs }; }

  list() { return (this.database.prepare("SELECT * FROM conversations ORDER BY updated_at DESC").all() as ConversationRow[]).map(row=>this.mapConversation(row,false)); }
  get(id:string) { const row=this.database.prepare("SELECT * FROM conversations WHERE id=?").get(id) as ConversationRow|undefined; return row ? this.mapConversation(row,true) : null; }
  renameConversation(id:string,title:string) { const now=new Date().toISOString();const result=this.database.prepare("UPDATE conversations SET title=?,updated_at=? WHERE id=?").run(title,now,id);return result.changes?this.get(id):null; }
  deleteConversation(id:string) { const active=(this.database.prepare("SELECT COUNT(*) AS count FROM runs WHERE conversation_id=? AND status IN ('queued','running','pausing','paused','cancelling')").get(id) as {count:number}).count;if(active)throw new Error("Không thể xóa cuộc trò chuyện đang có tác vụ hoạt động");return this.database.prepare("DELETE FROM conversations WHERE id=?").run(id).changes>0; }
  deleteAllConversations() { const active=(this.database.prepare("SELECT COUNT(*) AS count FROM runs WHERE status IN ('queued','running','pausing','paused','cancelling')").get() as {count:number}).count;if(active)throw new Error("Không thể xóa lịch sử khi đang có tác vụ hoạt động");return this.database.prepare("DELETE FROM conversations").run().changes; }
  create(title="Cuộc trò chuyện mới") { const now=new Date().toISOString(), id=crypto.randomUUID(); this.database.prepare("INSERT INTO conversations VALUES (?, ?, NULL, ?, ?)").run(id,title,now,now); return this.get(id)!; }

  addMessage(id:string, role:Message["role"], content:string) {
    const conversation=this.get(id); if(!conversation) throw new Error("Conversation not found");
    const message:Message={id:crypto.randomUUID(),conversationId:id,role,content,createdAt:new Date().toISOString()};
    const title=role==="user"&&conversation.title==="Cuộc trò chuyện mới" ? content.slice(0,60) : conversation.title;
    this.database.transaction(()=>{this.database.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?)").run(message.id,id,role,content,message.createdAt);this.database.prepare("UPDATE conversations SET title=?, updated_at=? WHERE id=?").run(title,message.createdAt,id)})();
    return message;
  }

  createRun(conversationId:string,deviceSerial:string,goal:string,maxSteps:number) {
    if(!this.get(conversationId)) throw new Error("Conversation not found");
    const run:RunRecord={id:crypto.randomUUID(),conversationId,deviceSerial,goal,status:"queued",maxSteps,errorCode:null,result:null,startedAt:new Date().toISOString(),endedAt:null,steps:[]};
    this.database.transaction(()=>{this.database.prepare("INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL)").run(run.id,conversationId,deviceSerial,goal,run.status,maxSteps,run.startedAt);this.database.prepare("UPDATE conversations SET device_serial=?, updated_at=? WHERE id=?").run(deviceSerial,run.startedAt,conversationId)})();
    return run;
  }

  deleteRun(id:string) { this.database.prepare("DELETE FROM runs WHERE id=?").run(id); }
  findRun(id:string) { const row=this.database.prepare("SELECT * FROM runs WHERE id=?").get(id) as RunRow|undefined; return row ? this.mapRun(row,true) : null; }
  updateRun(id:string,patch:Partial<RunRecord>) { const current=this.findRun(id);if(!current)throw new Error("Run not found");const next={...current,...patch},now=new Date().toISOString();this.database.transaction(()=>{this.database.prepare("UPDATE runs SET status=?, error_code=?, result=?, ended_at=? WHERE id=?").run(next.status,next.errorCode,next.result,next.endedAt,id);this.database.prepare("UPDATE conversations SET updated_at=? WHERE id=?").run(now,current.conversationId);if(patch.status&&patch.status!==current.status)this.database.prepare("INSERT INTO run_events VALUES (?, ?, ?, ?, ?)").run(crypto.randomUUID(),id,"run.status",JSON.stringify({from:current.status,to:patch.status}),now)})();return this.findRun(id)!; }
  addRunEvent(runId:string,type:string,data:unknown){const run=this.findRun(runId);if(!run)throw new Error("Run not found");const event={eventId:crypto.randomUUID(),type,runId,data,createdAt:new Date().toISOString()};this.database.prepare("INSERT INTO run_events VALUES (?, ?, ?, ?, ?)").run(event.eventId,runId,type,JSON.stringify(data),event.createdAt);return event;}
  addStep(runId:string,action:RunStep["action"],summary:string,durationMs:number|null) { const run=this.findRun(runId);if(!run)throw new Error("Run not found");const step:RunStep={id:crypto.randomUUID(),runId,stepNo:run.steps.length+1,action,summary,durationMs,createdAt:new Date().toISOString()};this.database.transaction(()=>{this.database.prepare("INSERT INTO run_steps VALUES (?, ?, ?, ?, ?, ?, ?)").run(step.id,runId,step.stepNo,action?JSON.stringify(action):null,summary,durationMs,step.createdAt);this.database.prepare("UPDATE conversations SET updated_at=? WHERE id=?").run(step.createdAt,run.conversationId);this.database.prepare("INSERT INTO run_events VALUES (?, ?, ?, ?, ?)").run(crypto.randomUUID(),runId,"run.step",JSON.stringify({stepNo:step.stepNo,action:action?.action||null,summary}),step.createdAt)})();return step; }
  recoverInterruptedRuns() { const now=new Date().toISOString();const result=this.database.prepare("UPDATE runs SET status='failed', error_code='SERVER_RESTARTED', result='Ứng dụng đã khởi động lại khi tác vụ đang chạy.', ended_at=? WHERE status IN ('queued','running','pausing','paused','cancelling')").run(now);return result.changes; }
  pruneRunEventsBefore(cutoff:string){return this.database.prepare("DELETE FROM run_events WHERE created_at<=?").run(cutoff).changes;}
  pruneRunEvents(olderThanDays=30){if(!Number.isFinite(olderThanDays)||olderThanDays<0)throw new Error("Retention days must be non-negative");return this.pruneRunEventsBefore(new Date(Date.now()-olderThanDays*86400000).toISOString());}
  listRunEvents(runId:string,after?:string) { let rows:{id:string;event_type:string;payload_json:string;created_at:string}[];if(after){const cursor=this.database.prepare("SELECT rowid FROM run_events WHERE id=? AND run_id=?").get(after,runId) as {rowid:number}|undefined;rows=cursor?(this.database.prepare("SELECT id,event_type,payload_json,created_at FROM run_events WHERE run_id=? AND rowid>? ORDER BY rowid").all(runId,cursor.rowid) as typeof rows):(this.database.prepare("SELECT id,event_type,payload_json,created_at FROM run_events WHERE run_id=? AND created_at>? ORDER BY rowid").all(runId,after) as typeof rows)}else rows=this.database.prepare("SELECT id,event_type,payload_json,created_at FROM run_events WHERE run_id=? ORDER BY rowid").all(runId) as typeof rows;return rows.map(row=>({eventId:row.id,type:row.event_type,runId,data:JSON.parse(row.payload_json),createdAt:row.created_at})); }
  getSettings() { const rows=this.database.prepare("SELECT key,value FROM settings").all() as {key:string;value:string}[];return Object.fromEntries(rows.map(row=>[row.key,JSON.parse(row.value)])); }
  setSettings(values:Record<string,unknown>) { const statement=this.database.prepare("INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at");const now=new Date().toISOString();this.database.transaction(()=>{for(const [key,value] of Object.entries(values))statement.run(key,JSON.stringify(value),now)})();return this.getSettings(); }
  close(){this.database.close();}
}

export const sessionRepository=new SessionRepository(process.env.NODE_ENV==="test"?":memory:":undefined);
