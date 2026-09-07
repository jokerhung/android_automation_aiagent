import { afterEach, describe, expect, it } from "vitest";
import { manualActionSchema, agentActionSchema } from "@/lib/contracts/schemas";
import { containedMediaViewport, normalizedToPixel, pointerToNormalized } from "@/lib/shared/coordinates";
import { normalizeMatchText, resolveTap, systemKeyeventForIntent } from "@/lib/server/agent/tap-grounding";
import { parseDeviceList } from "@/lib/server/adb/device-manager";
import { parseUiHierarchy, UiHierarchyService } from "@/lib/server/adb/ui-hierarchy";
import { parseAgentAction } from "@/lib/server/model/model-client";
import { SessionRepository } from "@/lib/server/persistence/session-repository";
import { deviceOwnershipRegistry } from "@/lib/server/device-ownership";

const repos:SessionRepository[]=[];afterEach(()=>{while(repos.length)repos.pop()!.close()});
const finish={action:"finish",thought:"Đã hoàn tất",x:null,y:null,x2:null,y2:null,duration_ms:null,text:null,keycode:null} as const;

describe("contracts",()=>{
 it("validates closed manual actions",()=>{expect(manualActionSchema.parse({type:"tap",x:0,y:1000}).type).toBe("tap");expect(()=>manualActionSchema.parse({type:"keyevent",keycode:999})).toThrow();expect(()=>manualActionSchema.parse({type:"tap",x:2,y:3,shell:"rm"})).toThrow()});
 it("requires action parameters and ranges",()=>{expect(()=>agentActionSchema.parse({...finish,action:"tap",x:null,y:null})).toThrow();expect(()=>agentActionSchema.parse({...finish,action:"tap",x:1001,y:10})).toThrow()});
});

describe("model parser",()=>{
 it("extracts first valid object around prose and fences",()=>{expect(parseAgentAction("text {bad} then "+JSON.stringify(finish)+" trailing")).toEqual(finish)});
 it("skips an earlier schema-invalid object",()=>{expect(parseAgentAction('{"action":"bad"} '+JSON.stringify(finish)).action).toBe("finish")});
 it("rejects empty and malformed output",()=>{expect(()=>parseAgentAction(" ")).toThrow(/empty/);expect(()=>parseAgentAction("nothing {bad}")).toThrow(/invalid/) });
});

describe("coordinates",()=>{it("maps safe edges and viewport center",()=>{expect(normalizedToPixel(1000,1000,1080,2400)).toEqual({x:1079,y:2399});expect(pointerToNormalized(50,100,{left:0,top:0,width:100,height:200})).toEqual({x:500,y:500})});it("removes letterbox bars before mapping",()=>{expect(containedMediaViewport({left:0,top:0,width:200,height:200},100,200)).toEqual({left:50,top:0,width:100,height:200});expect(pointerToNormalized(50,100,containedMediaViewport({left:0,top:0,width:200,height:200},100,200))).toEqual({x:0,y:500})})});

describe("grounding parity",()=>{
 it("normalizes Vietnamese accents and maps recents",()=>{expect(normalizeMatchText("  Đa   Nhiệm ")).toBe("da nhiem");expect(systemKeyeventForIntent("Mở ứng dụng gần đây")).toBe(187)});
 it("prefers semantic nearby label",()=>{const elements=[{label:"Other",bounds:[90,90,130,130] as [number,number,number,number],center:[110,110] as [number,number]},{label:"Settings",bounds:[150,90,210,150] as [number,number,number,number],center:[180,120] as [number,number]}];expect(resolveTap(100,100,1000,1000,elements,"open Settings").target?.label).toBe("Settings")});
 it("does not snap beyond threshold",()=>{const element={label:"Far",bounds:[500,500,550,550] as [number,number,number,number],center:[525,525] as [number,number]};expect(resolveTap(0,0,1000,1000,[element],"").target).toBeNull()});
});

describe("parsers",()=>{
 it("parses several devices by serial",()=>{const d=parseDeviceList("List of devices attached\nABC device product:p model:Pixel_8 device:husky transport_id:1\nXYZ unauthorized usb:2-1\n");expect(d.map(x=>x.serial)).toEqual(["ABC","XYZ"]);expect(d[1].state).toBe("unauthorized")});
 it("uses UI label precedence and filters invalid nodes",()=>{const xml='<?xml version="1.0"?><hierarchy><node clickable="true" enabled="true" content-desc="Mô tả" text="Text" bounds="[0,0][100,50]"/><node clickable="false" bounds="[0,0][2,2]"/><node clickable="true" enabled="false" bounds="[0,0][5,5]"/></hierarchy>';expect(parseUiHierarchy(xml)).toEqual([{label:"Mô tả",bounds:[0,0,100,50],center:[50,25]}])});
 it("limits model UI context to sixty controls",()=>{const service=new UiHierarchyService();const items=Array.from({length:61},(_,i)=>({label:String(i),bounds:[0,0,1,1] as [number,number,number,number],center:[0,0] as [number,number]}));expect(service.format(items,100,100).split("\n")).toHaveLength(60)});
});

describe("SQLite persistence",()=>{
 it("restores conversations runs messages and steps",()=>{const repo=new SessionRepository(":memory:");repos.push(repo);const c=repo.create();repo.addMessage(c.id,"user","Mở Cài đặt");const run=repo.createRun(c.id,"SERIAL-1","Mở Cài đặt",15);repo.addStep(run.id,finish,"Hoàn tất",25);repo.updateRun(run.id,{status:"completed",result:"OK",endedAt:new Date().toISOString()});const restored=repo.get(c.id)!;expect(restored.title).toBe("Mở Cài đặt");expect(restored.runs[0].deviceSerial).toBe("SERIAL-1");expect(restored.runs[0].steps[0].action?.action).toBe("finish")});
 it("marks uncertain active runs failed after restart",()=>{const repo=new SessionRepository(":memory:");repos.push(repo);const c=repo.create();const run=repo.createRun(c.id,"SERIAL-1","Goal",5);repo.updateRun(run.id,{status:"running"});expect(repo.recoverInterruptedRuns()).toBe(1);expect(repo.findRun(run.id)?.errorCode).toBe("SERVER_RESTARTED");expect(repo.listRunEvents(run.id).some(event=>event.type==="run.status")).toBe(true)});
});
describe("device ownership",()=>{
 it("blocks manual control while agent owns device",()=>{deviceOwnershipRegistry.acquire("SERIAL-X","RUN-X");expect(()=>deviceOwnershipRegistry.assertManualAllowed("SERIAL-X")).toThrow(/tạm dừng/);deviceOwnershipRegistry.release("SERIAL-X","RUN-X")});
 it("allows manual control only when agent is paused",()=>{deviceOwnershipRegistry.acquire("SERIAL-Y","RUN-Y");deviceOwnershipRegistry.setPaused("SERIAL-Y","RUN-Y",true);expect(()=>deviceOwnershipRegistry.assertManualAllowed("SERIAL-Y")).not.toThrow();deviceOwnershipRegistry.release("SERIAL-Y","RUN-Y")});
 it("does not let another run steal a serial",()=>{deviceOwnershipRegistry.acquire("SERIAL-Z","RUN-1");expect(()=>deviceOwnershipRegistry.acquire("SERIAL-Z","RUN-2")).toThrow();deviceOwnershipRegistry.release("SERIAL-Z","RUN-1")});
});
describe("conversation lifecycle",()=>{
 it("renames and deletes an idle conversation",()=>{const repo=new SessionRepository(":memory:");repos.push(repo);const conversation=repo.create();expect(repo.renameConversation(conversation.id,"Tên mới")?.title).toBe("Tên mới");expect(repo.deleteConversation(conversation.id)).toBe(true);expect(repo.get(conversation.id)).toBeNull()});
 it("refuses deletion while a run is active",()=>{const repo=new SessionRepository(":memory:");repos.push(repo);const conversation=repo.create();repo.createRun(conversation.id,"SERIAL","Goal",3);expect(()=>repo.deleteConversation(conversation.id)).toThrow(/hoạt động/)});
});
describe("runtime settings persistence",()=>{it("stores only explicit non-secret settings",()=>{const repo=new SessionRepository(":memory:");repos.push(repo);repo.setSettings({model:"vision-model",maxSteps:19});expect(repo.getSettings()).toEqual({model:"vision-model",maxSteps:19})})});
describe("durable event replay",()=>{it("filters persisted events after a cursor timestamp",()=>{const repo=new SessionRepository(":memory:");repos.push(repo);const conversation=repo.create(),run=repo.createRun(conversation.id,"SERIAL","Goal",2);repo.updateRun(run.id,{status:"running"});const all=repo.listRunEvents(run.id);expect(all.length).toBeGreaterThan(0);expect(repo.listRunEvents(run.id,all.at(-1)!.createdAt)).toEqual([]);repo.addStep(run.id,null,"step",null);const latest=repo.listRunEvents(run.id);expect(repo.listRunEvents(run.id,latest.at(-2)!.eventId).map(event=>event.eventId)).toEqual([latest.at(-1)!.eventId])})});
describe("event retention",()=>{it("prunes events older than configured age",()=>{const repo=new SessionRepository(":memory:");repos.push(repo);const conversation=repo.create(),run=repo.createRun(conversation.id,"SERIAL","Goal",1);repo.updateRun(run.id,{status:"running"});expect(repo.listRunEvents(run.id).length).toBeGreaterThan(0);expect(repo.pruneRunEventsBefore("9999-12-31T23:59:59.999Z")).toBeGreaterThan(0);expect(repo.listRunEvents(run.id)).toEqual([])})});
