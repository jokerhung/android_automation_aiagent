// Starts only the tray helper: no app server, database, Startup or browser.
import { WindowsTrayController } from "../lib/server/platform/windows/tray-controller";
import path from "node:path";
async function main() {
  if(process.platform !== "win32") throw new Error("Windows desktop required");
  const tray = new WindowsTrayController();
  const events: string[] = [];
  tray.onEvent(event => { events.push(event.event); if(event.event === "error") console.error(event.message); });
  try {
    await tray.start({appRoot:path.resolve(import.meta.dirname,".."),homeUrl:"http://127.0.0.1:3000/",timeoutMs:10000});
    tray.setStatus("Android Agent tray smoke",false);
    await tray.dispose();
    if(!events.includes("ready")) throw new Error("Tray never reported ready");
    if(!events.includes("disposed")) throw new Error("Tray never acknowledged disposal");
    if(events.includes("lost")) throw new Error("Expected disposal incorrectly reported helper loss");
    console.log("PASS: isolated WinForms tray ready and disposed; Startup untouched");
  } finally { await tray.dispose(); }
}
main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;});
