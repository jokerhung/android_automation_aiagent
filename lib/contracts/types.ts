import type {ScheduleEmailNotification} from "./email";
export type DeviceState = "device" | "unauthorized" | "offline";
export type DeviceSummary = { serial:string; state:DeviceState; model:string|null; product:string|null; device:string|null; transportId:string|null; displayName:string; width:number|null; height:number|null };
export type ManualAction =
 | { type:"tap"; x:number; y:number }
 | { type:"swipe"; x:number; y:number; x2:number; y2:number; durationMs?:number }
 | { type:"text"; text:string }
 | { type:"keyevent"; keycode:number }
 | { type:"wait"; durationMs?:number };
export type AgentAction = { action:"tap"|"swipe"|"text"|"keyevent"|"wait"|"finish"; thought:string; x:number|null; y:number|null; x2:number|null; y2:number|null; duration_ms:number|null; text:string|null; keycode:number|null };
export type RunStatus = "queued"|"running"|"pausing"|"paused"|"cancelling"|"cancelled"|"completed"|"failed";
export type Message = { id:string; conversationId:string; role:"user"|"assistant"|"system"; content:string; createdAt:string };
export type RunStep = { id:string; runId:string; stepNo:number; action:AgentAction|null; summary:string; durationMs:number|null; createdAt:string };
export type RunRecord = { id:string; conversationId:string; deviceSerial:string; goal:string; status:RunStatus; maxSteps:number; errorCode:string|null; result:string|null; startedAt:string; endedAt:string|null; steps:RunStep[] };
export type Conversation = { id:string; title:string; deviceSerial:string|null; createdAt:string; updatedAt:string; messages:Message[]; runs:RunRecord[] };
export type AppEvent = { eventId:string; type:string; conversationId?:string; runId?:string; data:unknown; createdAt:string };
export type ScheduleStatus="active"|"paused"|"completed"|"disabled";
export type ScheduleRule={type:"interval";every:number;unit:"seconds"|"minutes"|"hours"}|{type:"daily"}|{type:"weekly";weekdays:(1|2|3|4|5|6|7)[]};
export type OccurrenceStatus="pending"|"waiting_device"|"running"|"completed"|"failed"|"missed"|"cancelled";
export type Schedule={latestOccurrence?:ScheduleOccurrence|null;id:string;name:string;startDate:string;localTime:string;timezone:string;rule:ScheduleRule;occurrenceLimit:number|null;prompt:string;deviceSerial:string;logDirectory:string;emailNotification?:ScheduleEmailNotification;status:ScheduleStatus;nextRunAt:string|null;completedOccurrences:number;createdAt:string;updatedAt:string};
export type ScheduleOccurrence={id:string;scheduleId:string;scheduledFor:string;status:OccurrenceStatus;conversationId:string|null;runId:string|null;startedAt:string|null;endedAt:string|null;result:string|null;errorCode:string|null;errorMessage:string|null;logFile:string|null;emailConfigSnapshot?:{version:1;enabled:true;to:string;subject:string;accountIdentity:string}|null;emailStatus?:string|null;emailDelivery?:{recipient:string;subject:string;attempts:number;nextAttemptAt:string|null;sentAt:string|null;errorCode:string|null;errorMessage:string|null}|null;createdAt:string;updatedAt:string};
export type ScheduleDetail=Schedule&{occurrences:ScheduleOccurrence[]};
