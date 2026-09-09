import {acquireInstanceLock} from "./lib/server/platform/windows/instance-lock";
import {config} from "dotenv";
import path from "node:path";
import {fileURLToPath} from "node:url";

async function main(){
 const appRoot=path.dirname(fileURLToPath(import.meta.url));
 process.chdir(appRoot);
 config({path:path.join(appRoot,".env.local"),quiet:true});
 const mode=process.env.NODE_ENV==="production"?"foreground":"development" as const;
 const instanceLock=await acquireInstanceLock({mode});
 const {startApplication}=await import("./lib/server/application-lifecycle");
 const lifecycle=await startApplication({instanceLock,mode,onShutdownFailure:()=>process.exit(1)});
 process.once("SIGINT",()=>void lifecycle.shutdown("SIGINT").then(()=>process.exit(0),()=>process.exit(1)));
 process.once("SIGTERM",()=>void lifecycle.shutdown("SIGTERM").then(()=>process.exit(0),()=>process.exit(1)));
}
main().catch(error=>{if(error instanceof Error&&error.name==="StartupCancelledError"){process.exitCode=0;return;}console.error(error);process.exitCode=1});
