import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {getWindowsInstallationPaths} from "@/lib/server/platform/windows/paths";
import {readBackgroundMetadata, removeOwnedMetadata, writeBackgroundMetadata} from "@/lib/server/platform/windows/background-status";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root,{recursive:true,force:true});
});
function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"android-agent-ownership-"));
  roots.push(root);
  vi.stubEnv("LOCALAPPDATA",path.join(root,"local"));
  const appRoot=path.join(root,"Ứng dụng with spaces");
  fs.mkdirSync(appRoot,{recursive:true});
  return getWindowsInstallationPaths(appRoot);
}
describe("background ownership boundaries",()=>{
  it("derives stable installation IDs without exposing paths",()=>{
    const paths=fixture();
    const same=getWindowsInstallationPaths(paths.appRoot + path.sep);
    expect(same.installationId).toBe(paths.installationId);
    expect(paths.installationId).toMatch(/^[a-f0-9]{16}$/);
    expect(getWindowsInstallationPaths(path.join(paths.appRoot,"other")).installationId).not.toBe(paths.installationId);
  });
  it("does not remove another instance metadata",()=>{
    const paths=fixture();
    const record={version:1 as const,appRoot:paths.appRoot,installationId:paths.installationId,
      instanceId:"instance-owned",pid:process.pid,startedAt:new Date().toISOString(),mode:"background" as const,
      pipeName:paths.pipeName,token:"owned-token",port:3000,ready:true,trayReady:true};
    writeBackgroundMetadata(paths,record);
    removeOwnedMetadata(paths,"different-instance");
    expect(readBackgroundMetadata(paths)).toEqual(record);
    removeOwnedMetadata(paths,"owned-token");
    expect(readBackgroundMetadata(paths)).toBeNull();
    expect(fs.existsSync(paths.appRoot)).toBe(true);
  });
});
