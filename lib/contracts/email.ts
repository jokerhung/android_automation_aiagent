import {z} from "zod";
const hasForbiddenHeaderControl=(value:string)=>value.includes(String.fromCharCode(0))||value.includes("\r")||value.includes("\n");
const noHeaderControls=(value:string)=>!hasForbiddenHeaderControl(value);
const emailAddress=z.string().trim().email().max(254).refine(noHeaderControls,"Email contains forbidden control characters");
const smtpHost=z.string().trim().min(1).max(253).refine(value=>!/[\s/:;|&<>]/.test(value)&&!hasForbiddenHeaderControl(value)&&!value.startsWith("-")&&!value.endsWith("."),"Invalid SMTP hostname");
export const emailSecuritySchema=z.enum(["starttls","tls"]);
export const emailSettingsInputSchema=z.object({
 host:smtpHost,port:z.number().int().min(1).max(65535),security:emailSecuritySchema,
 username:z.string().trim().min(1).max(320).refine(noHeaderControls),defaultRecipient:emailAddress,
 password:z.string().min(1).max(1024).optional(),clearPassword:z.boolean().optional(),

}).strict().superRefine((value,ctx)=>{if(value.password!==undefined&&value.clearPassword)ctx.addIssue({code:"custom",message:"Choose either password replacement or explicit removal"})});
export const emailPublicSettingsSchema=z.object({
 host:smtpHost,port:z.number().int().min(1).max(65535),security:emailSecuritySchema,
 username:emailAddress,defaultRecipient:emailAddress,passwordConfigured:z.boolean(),accountIdentity:z.string().regex(/^[a-f0-9]{64}$/),verifiedAt:z.string().datetime().nullable(),
}).strict();
export const scheduleEmailNotificationSchema=z.discriminatedUnion("enabled",[
 z.object({enabled:z.literal(false)}).strict(),
 z.object({enabled:z.literal(true),to:emailAddress,subject:z.string().trim().min(1).max(200).refine(noHeaderControls,"Subject contains forbidden control characters")}).strict(),
]);
export type EmailSettingsInput=z.infer<typeof emailSettingsInputSchema>;
export type EmailPublicSettings=z.infer<typeof emailPublicSettingsSchema>;
export type ScheduleEmailNotification=z.infer<typeof scheduleEmailNotificationSchema>;
