import "@/lib/server/server-guard";
import {secureSystemApiRequest} from "@/lib/server/system-api-guard";
export function guardEmailApi(request:Request,mutation=false){return secureSystemApiRequest(request,{mutation})}
