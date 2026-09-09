import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,describe,expect,it,vi} from "vitest";
import {acquireInstanceLock,AlreadyRunningError} from "@/lib/server/platform/windows/instance-lock";
import {getWindowsInstallationPaths} from "@/lib/server/platform/windows/paths";
import {assertApplicationAcceptingWork,isApplicationAcceptingWork,resetApplicationAdmissions,stopApplicationAdmissions} from "@/lib/server/application-admission";

const roots:string[]=[];
afterEach(()=>{resetApplicationAdmissions();vi.unstubAllEnvs();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true})});
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),"android-agent-windows-lock-"));roots.push(root);vi.stubEnv("LOCALAPPDATA",path.join(root,"local"));const appRoot=path.join(root,"App with spaces");fs.mkdirSync(appRoot,{recursive:true});return{appRoot,paths:getWindowsInstallationPaths(appRoot)}}

describe("Windows instance lifecycle",()=>{
 it("holds an atomic lock and refuses a second live owner",async()=>{const {appRoot,paths}=fixture();const first=await acquireInstanceLock({appRoot,mode:"foreground"});expect(fs.existsSync(paths.lockPath)).toBe(true);expect(first.record.instanceId).toMatch(/^[0-9a-f-]{36}$/i);await expect(acquireInstanceLock({appRoot,mode:"background"})).rejects.toBeInstanceOf(AlreadyRunningError);first.release();expect(fs.existsSync(paths.lockPath)).toBe(false)});
 it("only releases a lock still owned by its token",async()=>{const {appRoot,paths}=fixture();const lock=await acquireInstanceLock({appRoot,mode:"foreground"});const foreign={...lock.record,instanceId:"foreign-instance"};fs.writeFileSync(paths.lockPath,JSON.stringify(foreign));lock.release();expect(JSON.parse(fs.readFileSync(paths.lockPath,"utf8")).instanceId).toBe("foreign-instance")});
 it("closes admissions synchronously before asynchronous cleanup",()=>{expect(isApplicationAcceptingWork()).toBe(true);stopApplicationAdmissions("stopping for test");expect(isApplicationAcceptingWork()).toBe(false);expect(()=>assertApplicationAcceptingWork()).toThrowError(/stopping for test/);resetApplicationAdmissions();expect(()=>assertApplicationAcceptingWork()).not.toThrow()});
});
