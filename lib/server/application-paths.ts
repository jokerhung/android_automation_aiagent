import fs from "node:fs";
import path from "node:path";

/** Resolve a path through symlinks even when its final components do not exist yet. */
export function canonicalizeApplicationPath(input: string) {
  const absolute = path.resolve(input);
  let current = absolute;
  const missing: string[] = [];

  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    missing.unshift(path.basename(current));
    current = parent;
  }

  let canonicalParent = current;
  try {
    canonicalParent = fs.realpathSync.native(current);
  } catch {
    // path.resolve above is still a stable fallback if the filesystem changes concurrently.
  }
  return path.join(canonicalParent, ...missing);
}

export function getApplicationDatabasePath(appRoot = process.cwd()) {
  const configured = process.env.ANDROID_AGENT_DATABASE_PATH?.trim();
  if (configured && !path.isAbsolute(configured)) {
    throw new Error("ANDROID_AGENT_DATABASE_PATH must be an absolute path");
  }
  const databasePath = configured || path.join(appRoot, "data", "app.db");
  return canonicalizeApplicationPath(databasePath);
}

export function canonicalizeApplicationRoot(appRoot = process.cwd()) {
  return canonicalizeApplicationPath(appRoot);
}

export function normalizeIdentityPath(value: string) {
  const canonical = canonicalizeApplicationPath(value).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}
