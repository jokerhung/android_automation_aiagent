import "@/lib/server/server-guard";
import {createHash} from "node:crypto";
import type {RunRecord,Schedule,ScheduleOccurrence} from "@/lib/contracts/types";
import {redact,redactActionText} from "@/lib/server/logging/redaction";
const MAX_STEPS=100,MAX_ATTACHMENT_BYTES=5*1024*1024;
const labels:Record<string,string>={completed:"Hoàn thành",failed:"Thất bại",cancelled:"Đã hủy"};
export type JobEmailReport={resultSnapshot:Record<string,unknown>;attachmentName:string;attachmentContent:Buffer;attachmentSha256:string;body:string};
export function buildJobEmailReport(schedule:Schedule,occurrence:ScheduleOccurrence,run:RunRecord):JobEmailReport{
 const steps=run.steps.slice(0,MAX_STEPS).map(step=>({stepNo:step.stepNo,createdAt:step.createdAt,durationMs:step.durationMs,summary:redact(step.summary),action:redactActionText(step.action)}));
 const result=redact(occurrence.result??run.result??occurrence.errorMessage??"");
 const resultSnapshot={version:1,scheduleId:schedule.id,scheduleName:schedule.name,occurrenceId:occurrence.id,runId:run.id,conversationId:run.conversationId,timezone:schedule.timezone,scheduledFor:occurrence.scheduledFor,startedAt:occurrence.startedAt??run.startedAt,endedAt:occurrence.endedAt??run.endedAt,status:occurrence.status,result,errorCode:occurrence.errorCode??run.errorCode,errorMessage:redact(occurrence.errorMessage??""),steps,truncatedSteps:run.steps.length>MAX_STEPS};
 const lines=["Android Agent - Nhật ký lần chạy","Công việc: "+schedule.name,"Schedule ID: "+schedule.id,"Occurrence ID: "+occurrence.id,"Run ID: "+run.id,"Timezone: "+schedule.timezone,"Dự kiến: "+occurrence.scheduledFor,"Bắt đầu: "+(occurrence.startedAt??run.startedAt),"Kết thúc: "+(occurrence.endedAt??run.endedAt??""),"Trạng thái: "+(labels[occurrence.status]??occurrence.status),"Kết quả: "+result,""];
 for(const step of steps)lines.push("Bước "+step.stepNo+" · "+step.createdAt,"Action: "+JSON.stringify(step.action),"Summary: "+step.summary,"Duration: "+(step.durationMs??"")+" ms","");
 if(run.steps.length>MAX_STEPS)lines.push("Đã giới hạn báo cáo ở 100 bước đầu tiên.");
 const attachmentContent=Buffer.from(lines.join("\n"),"utf8");if(attachmentContent.length>MAX_ATTACHMENT_BYTES)throw new Error("EMAIL_ATTACHMENT_TOO_LARGE");
 const attachmentName=("job_"+schedule.id+"_"+occurrence.id+"_steps.txt").replace(/[^A-Za-z0-9_.-]/g,"_");
 const body=["Công việc: "+schedule.name,"Trạng thái: "+(labels[occurrence.status]??occurrence.status),"Bắt đầu: "+(occurrence.startedAt??run.startedAt),"Kết thúc: "+(occurrence.endedAt??run.endedAt??""),"Số bước đã ghi nhận: "+steps.length,"Lần chạy: "+occurrence.id,"","Kết quả:",result,"","File đính kèm: nhật ký các bước của lần chạy này."].join("\n");
 return{resultSnapshot,attachmentName,attachmentContent,attachmentSha256:createHash("sha256").update(attachmentContent).digest("hex"),body};
}
