import fs from "node:fs";
import {expect,it} from "vitest";
it("loads installation environment before acquiring database lock",()=>{
 const source=fs.readFileSync("server.ts","utf8");
 const load=source.indexOf("config({path:");
 const lock=source.indexOf("await acquireInstanceLock");
 expect(load).toBeGreaterThan(-1);
 expect(load).toBeLessThan(lock);
 expect(source.indexOf("process.chdir(appRoot)")).toBeLessThan(load);
 expect(source.indexOf("await import(")).toBeGreaterThan(lock);
});
