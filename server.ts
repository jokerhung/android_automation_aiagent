import {createServer} from "node:http";
import next from "next";
import {sessionRepository} from "./lib/server/persistence/session-repository";
import {deviceMonitor} from "./lib/server/device-monitor";
import {getRuntimeSettings} from "./lib/server/runtime-settings";
import {streamSessionManager} from "./lib/server/scrcpy/stream-session-manager";
import {agentRunner} from "./lib/server/agent/agent-runner";
import {gplScrcpyBridge} from "./lib/server/scrcpy/gpl-scrcpy-bridge";

async function main(){
 sessionRepository.pruneRunEvents(Number(process.env.EVENT_RETENTION_DAYS||30));
 const recovered=sessionRepository.recoverInterruptedRuns();if(recovered)console.log(`Đã đánh dấu ${recovered} tác vụ bị gián đoạn do server khởi động lại.`);
 const dev=process.env.NODE_ENV!=="production",host=process.env.HOST||"127.0.0.1",port=Number(process.env.PORT||3000);
 const app=next({dev,hostname:host,port}),handle=app.getRequestHandler();await app.prepare();const nextUpgrade=app.getUpgradeHandler();
 deviceMonitor.start(getRuntimeSettings().deviceRefreshMs);await gplScrcpyBridge.initialize();
 const server=createServer((request,response)=>handle(request,response));
 server.on("upgrade",(request,socket,head)=>{const url=new URL(request.url||"/","http://"+(request.headers.host||host));if(url.pathname==="/ws/scrcpy"){gplScrcpyBridge.handleUpgrade(request,socket,head);return}void nextUpgrade(request,socket,head)});
 server.listen(port,host,()=>console.log("Android Vision Control: http://"+host+":"+port));
 let shuttingDown=false;const shutdown=async()=>{if(shuttingDown)return;shuttingDown=true;deviceMonitor.stop();streamSessionManager.closeAll();gplScrcpyBridge.close();server.close();const force=setTimeout(()=>process.exit(1),6000);force.unref();await agentRunner.shutdown(4500);sessionRepository.close();clearTimeout(force);process.exit(0)};
 process.on("SIGINT",()=>void shutdown());process.on("SIGTERM",()=>void shutdown());
}
main().catch(error=>{console.error(error);process.exit(1)});
