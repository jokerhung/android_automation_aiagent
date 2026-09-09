// Read-only: never creates or removes a Startup shortcut.
import {getAutostartStatus} from "../lib/server/platform/windows/autostart";
import {autostartStatusSchema} from "../lib/contracts/system";
async function main(){
 const status=autostartStatusSchema.parse(await getAutostartStatus());
 console.log(JSON.stringify(status));
}
main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1});
