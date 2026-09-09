import {emailSettingsInputSchema} from "@/lib/contracts/email";
import {getEmailSettings,saveEmailSettings} from "@/lib/server/email/email-settings";
import {guardEmailApi} from "@/lib/server/email/email-api-guard";
import {getLocalSessionCsrfToken} from "@/lib/server/system-api-guard";
import {rateLimiter,requestKey} from "@/lib/server/rate-limiter";
import {safeError} from "@/lib/server/logging/redaction";
export const dynamic="force-dynamic";
export async function GET(request:Request){const denied=guardEmailApi(request);if(denied)return denied;return Response.json({ok:true,data:{settings:await getEmailSettings(),csrfToken:getLocalSessionCsrfToken()}})}
export async function PATCH(request:Request){const denied=guardEmailApi(request,true);if(denied)return denied;if(!rateLimiter.check(requestKey(request,"email-settings"),20))return Response.json({ok:false,error:{code:"RATE_LIMITED",message:"Quá nhiều thay đổi cấu hình email"}},{status:429});try{const input=emailSettingsInputSchema.parse(await request.json());return Response.json({ok:true,data:await saveEmailSettings(input)})}catch(error){return Response.json({ok:false,error:{code:"INVALID_EMAIL_SETTINGS",message:safeError(error)}},{status:400})}}
