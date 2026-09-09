import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,describe,expect,it,vi} from "vitest";
import {getWindowsInstallationPaths} from "@/lib/server/platform/windows/paths";
import {installBackgroundConsoleLogging} from "@/scripts/start-background";

const original={log:console.log,info:console.info,warn:console.warn,error:console.error};
afterEach(()=>{Object.assign(console,original);vi.unstubAllEnvs()});
describe("background host console logging",()=>{
 it("routes stdout and stderr through bounded redacted rotating logs",()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),"agent-host-log-"));try{vi.stubEnv("LOCALAPPDATA",path.join(root,"local"));vi.stubEnv("ANDROID_AGENT_DATABASE_PATH",path.join(root,"data","app.db"));const paths=getWindowsInstallationPaths(root);installBackgroundConsoleLogging(paths);console.log("ready",{port:3000});console.error("Bearer secret-token",new Error("failure"));const log=fs.readFileSync(paths.logPath,"utf8");expect(log).toContain("host stdout: ready");expect(log).toContain("host stderr:");expect(log).toContain("failure");expect(log).not.toContain("secret-token");expect(log).toContain("[REDACTED]")}finally{fs.rmSync(root,{recursive:true,force:true})}});
});
