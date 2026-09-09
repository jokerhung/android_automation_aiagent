import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import {getApplicationDatabasePath,normalizeIdentityPath} from "@/lib/server/application-paths";
import {getWindowsInstallationPaths} from "@/lib/server/platform/windows/paths";
const roots:string[]=[];
afterEach(()=>{vi.unstubAllEnvs();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true})});
it("canonicalizes junction aliases to the same database identity",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"agent-paths-"));roots.push(root);
 const real=path.join(root,"real"),alias=path.join(root,"alias");fs.mkdirSync(real);
 fs.symlinkSync(real,alias,process.platform==="win32"?"junction":"dir");
 expect(normalizeIdentityPath(path.join(alias,"data","app.db"))).toBe(normalizeIdentityPath(path.join(real,"data","app.db")));
});
it("rejects a relative configured database path",()=>{
 vi.stubEnv("ANDROID_AGENT_DATABASE_PATH",path.join("relative","app.db"));
 expect(()=>getApplicationDatabasePath(path.resolve("fixture-root"))).toThrow("ANDROID_AGENT_DATABASE_PATH must be an absolute path");
});
it("uses configured isolated database for both repository and lock",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"agent-db-"));roots.push(root);
 const db=path.join(root,"isolated","app.db");
 vi.stubEnv("ANDROID_AGENT_DATABASE_PATH",db);vi.stubEnv("LOCALAPPDATA",path.join(root,"local"));
 const paths=getWindowsInstallationPaths(root);
 expect(paths.databasePath).toBe(getApplicationDatabasePath(root));
 expect(path.dirname(paths.lockPath)).toBe(path.dirname(db));
 expect(paths.lockPath).not.toContain(path.join(process.cwd(),"data"));
});
