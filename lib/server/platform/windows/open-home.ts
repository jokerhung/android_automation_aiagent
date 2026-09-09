import { execFile } from "node:child_process";
import path from "node:path";

export function isSafeHomeUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && url.hostname === "127.0.0.1" &&
      url.username === "" && url.password === "" && url.pathname === "/" &&
      url.search === "" && url.hash === "";
  } catch { return false; }
}

/** Resolve only after Windows accepts the URL; capture failures, never detach blindly. */
export async function openHomePage(appRoot: string, homeUrl: string): Promise<void> {
  if (!isSafeHomeUrl(homeUrl)) throw new Error("Refusing to open a non-loopback home URL");
  const powershell = path.join(process.env.SystemRoot || String.raw`C:\Windows`,
    "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  await new Promise<void>((resolve, reject) => {
    execFile(powershell, [
      "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden",
      "-File", path.join(appRoot, "scripts", "windows", "open-home.ps1"),
      "-HomeUrl", homeUrl,
    ], { cwd: appRoot, windowsHide: true, timeout: 10_000, maxBuffer: 8192, encoding: "utf8" },
    (error, stdout, stderr) => {
      if (error) {
        reject(new Error("BROWSER_OPEN_FAILED: " + (stderr.trim() || error.message)));
      } else if (stdout.trim() !== "HOME_OPENED") {
        reject(new Error("BROWSER_OPEN_FAILED: browser launcher did not acknowledge the request"));
      } else resolve();
    });
  });
}
