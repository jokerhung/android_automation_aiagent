import fs from "node:fs";
import {createHash} from "node:crypto";
import os from "node:os";
import path from "node:path";
import {afterEach,expect,it,vi} from "vitest";
vi.mock("@/lib/server/platform/windows/control-pipe",()=>({probeBackground:vi.fn(async()=>false)}));
import {acquireInstanceLock,processExists} from "@/lib/server/platform/windows/instance-lock";
const roots:string[]=[];
it("reclaims recognized dead legacy lock but preserves a live legacy owner",async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"agent-legacy-"));roots.push(root);
 vi.stubEnv("LOCALAPPDATA",path.join(root,"local"));
 vi.stubEnv("ANDROID_AGENT_DATABASE_PATH",path.join(root,"data","app.db"));
 const file=path.join(root,"data",".android-agent.lock");fs.mkdirSync(path.dirname(file));
 const record={version:1,appRoot:root,installationId:createHash("sha256").update(path.resolve(root).toLowerCase()).digest("hex").slice(0,16),pid:process.pid,startedAt:new Date().toISOString(),mode:"development",token:"legacy-secret",pipeName:"legacy-pipe"};
 fs.writeFileSync(file,JSON.stringify(record));
 await expect(acquireInstanceLock({appRoot:root,mode:"development"})).rejects.toThrow(/already running/i);
 expect(JSON.parse(fs.readFileSync(file,"utf8"))).toEqual(record);
 const kill=vi.spyOn(process,"kill").mockImplementation(()=>{throw Object.assign(new Error("dead"),{code:"ESRCH"})});
 try{
  const lock=await acquireInstanceLock({appRoot:root,mode:"development"});
  expect(JSON.parse(fs.readFileSync(file,"utf8"))).not.toHaveProperty("token");lock.release();
 }finally{kill.mockRestore()}
});
afterEach(()=>{vi.unstubAllEnvs();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
it("refuses a second owner even when its IPC probe is unavailable",async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"android-agent-lock-"));roots.push(root);
 vi.stubEnv("LOCALAPPDATA",path.join(root,"local"));
 const first=await acquireInstanceLock({appRoot:root,mode:"foreground"});
 try {
  await expect(acquireInstanceLock({appRoot:root,mode:"background"})).rejects.toThrow(/already running/i);
  expect(fs.existsSync(first.paths.lockPath)).toBe(true);
  const publicRecord=fs.readFileSync(first.paths.lockPath,"utf8");
  expect(publicRecord).not.toContain(first.token);
  expect(JSON.parse(publicRecord)).not.toHaveProperty("token");
 } finally {first.release();}
 expect(fs.existsSync(first.paths.lockPath)).toBe(false);
});
it("treats only ESRCH as a missing process",()=>{
 const kill=vi.spyOn(process,"kill");
 kill.mockImplementationOnce(()=>{const error=new Error("missing") as NodeJS.ErrnoException;error.code="ESRCH";throw error});
 expect(processExists(123)).toBe(false);
 for(const code of ["EPERM","EINVAL",undefined]){kill.mockImplementationOnce(()=>{const error=new Error("uncertain") as NodeJS.ErrnoException;error.code=code;throw error});expect(processExists(123)).toBe(true)}
 kill.mockRestore();
});
