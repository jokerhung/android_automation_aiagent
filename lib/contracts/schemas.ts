import { z } from "zod";
export const normalizedCoordinate = z.number().int().min(0).max(1000);
export const manualActionSchema = z.discriminatedUnion("type", [
 z.object({type:z.literal("tap"),x:normalizedCoordinate,y:normalizedCoordinate}).strict(),
 z.object({type:z.literal("swipe"),x:normalizedCoordinate,y:normalizedCoordinate,x2:normalizedCoordinate,y2:normalizedCoordinate,durationMs:z.number().int().min(50).max(5000).default(300)}).strict(),
 z.object({type:z.literal("text"),text:z.string().min(1).max(500)}).strict(),
 z.object({type:z.literal("keyevent"),keycode:z.number().int().refine(v=>[3,4,24,25,26,66,82,187].includes(v),"Keycode is not allowed")}).strict(),
 z.object({type:z.literal("wait"),durationMs:z.number().int().min(100).max(10000).default(2000)}).strict()
]);
const nullableCoordinate=normalizedCoordinate.nullable();
export const agentActionSchema=z.object({
 action:z.enum(["tap","swipe","text","keyevent","wait","finish"]), thought:z.string().min(1).max(500),
 x:nullableCoordinate,x2:nullableCoordinate,y:nullableCoordinate,y2:nullableCoordinate,
 duration_ms:z.number().int().min(50).max(5000).nullable(), text:z.string().max(500).nullable(),
 keycode:z.number().int().nullable()
}).strict().superRefine((v,ctx)=>{
 if(v.action==="tap"&&(v.x===null||v.y===null))ctx.addIssue({code:"custom",message:"tap requires x and y"});
 if(v.action==="swipe"&&[v.x,v.y,v.x2,v.y2].some(n=>n===null))ctx.addIssue({code:"custom",message:"swipe requires all coordinates"});
 if(v.action==="text"&&!v.text)ctx.addIssue({code:"custom",message:"text action requires text"});
 if(v.action==="keyevent"&&(v.keycode===null||![3,4,24,25,26,66,82,187].includes(v.keycode)))ctx.addIssue({code:"custom",message:"keyevent is not allowed"});
});
export const runRequestSchema=z.object({goal:z.string().trim().min(1).max(4000),deviceSerial:z.string().min(1).max(200),maxSteps:z.number().int().min(1).max(50).optional()}).strict();
const datePattern=/^\d{4}-\d{2}-\d{2}$/;const timePattern=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const scheduleInputSchema=z.object({name:z.string().trim().min(1).max(120),startDate:z.string().regex(datePattern),localTime:z.string().regex(timePattern),timezone:z.string().min(1).max(100).refine(value=>{try{new Intl.DateTimeFormat("en",{timeZone:value});return true}catch{return false}},"Invalid timezone"),repeatDays:z.number().int().min(1).max(365),prompt:z.string().trim().min(1).max(10000),deviceSerial:z.string().trim().min(1).max(200),logDirectory:z.string().trim().min(1).max(1000).refine(value=>!value.includes("\0"),"Path contains null byte")}).strict();
export const schedulePatchSchema=scheduleInputSchema.partial().strict();
export const logDirectorySchema=z.object({logDirectory:z.string().trim().min(1).max(1000).refine(value=>!value.includes("\0"),"Path contains null byte")}).strict();
