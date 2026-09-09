import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { canonicalizeApplicationRoot, getApplicationDatabasePath, normalizeIdentityPath } from "../../application-paths";

export type WindowsInstallationPaths = {
  appRoot: string;
  databasePath: string;
  installationId: string;
  stateDirectory: string;
  lockPath: string;
  metadataPath: string;
  logPath: string;
  pipeName: string;
};

export function normalizeAppRoot(appRoot = process.cwd()) {
  return normalizeIdentityPath(appRoot);
}

export function getWindowsInstallationPaths(appRoot = process.cwd()): WindowsInstallationPaths {
  const resolvedAppRoot = canonicalizeApplicationRoot(appRoot);
  const databasePath = getApplicationDatabasePath(appRoot);
  const databaseIdentity = normalizeIdentityPath(databasePath);
  const installationId = createHash("sha256").update(databaseIdentity).digest("hex").slice(0, 16);
  const databaseDirectory = path.dirname(databasePath);

  let stateDirectory: string;
  let pipeName: string;
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA?.trim();
    if (!localAppData) throw new Error("LOCALAPPDATA is unavailable");
    stateDirectory = path.join(localAppData, "AndroidAgent", installationId);
    pipeName = `\\\\.\\pipe\\android-agent-${installationId}`;
  } else {
    stateDirectory = path.join(databaseDirectory, ".android-agent-state", installationId);
    pipeName = path.join(os.tmpdir(), `android-agent-${installationId}.sock`);
  }

  return {
    appRoot: resolvedAppRoot,
    databasePath,
    installationId,
    stateDirectory,
    lockPath: path.join(databaseDirectory, ".android-agent.lock"),
    metadataPath: path.join(stateDirectory, "background.json"),
    logPath: path.join(stateDirectory, "background.log"),
    pipeName,
  };
}
