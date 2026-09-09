import "@/lib/server/server-guard";
import {createHash} from "node:crypto";
import type {EmailPublicSettings,EmailSettingsInput} from "@/lib/contracts/email";
import {emailPublicSettingsSchema,emailSettingsInputSchema} from "@/lib/contracts/email";
import {sessionRepository} from "@/lib/server/persistence/session-repository";
import {clearEmailPassword,hasEmailPassword,setEmailPassword} from "./email-secret-store";
const key="email.settings.v1";
type Stored={host:string;port:number;security:"starttls"|"tls";username:string;defaultRecipient:string;verifiedAt:string|null};
export const accountIdentity=(settings:Pick<EmailSettingsInput,"host"|"port"|"security"|"username">)=>createHash("sha256").update(JSON.stringify([settings.host.toLowerCase(),settings.port,settings.security,settings.username.toLowerCase()])).digest("hex");
export async function getEmailSettings():Promise<EmailPublicSettings|null>{
 const raw=sessionRepository.getSettings()[key] as (Stored&Record<string,unknown>)|undefined;if(!raw)return null;const value:Stored={host:raw.host,port:raw.port,security:raw.security,username:raw.username,defaultRecipient:typeof raw.defaultRecipient==="string"&&raw.defaultRecipient?raw.defaultRecipient:raw.username,verifiedAt:raw.verifiedAt??null};
 return emailPublicSettingsSchema.parse({...value,passwordConfigured:await hasEmailPassword(),accountIdentity:accountIdentity(value)});
}
export async function saveEmailSettings(input:unknown):Promise<EmailPublicSettings>{
 const parsed=emailSettingsInputSchema.parse(input),previous=sessionRepository.getSettings()[key] as Stored|undefined;
 if(parsed.password!==undefined)await setEmailPassword(parsed.password);else if(parsed.clearPassword)clearEmailPassword();
 const stored:Stored={host:parsed.host,port:parsed.port,security:parsed.security,username:parsed.username,defaultRecipient:parsed.defaultRecipient,verifiedAt:previous&&accountIdentity(previous)===accountIdentity(parsed)?previous.verifiedAt:null};
 sessionRepository.setSettings({[key]:stored});return (await getEmailSettings())!;
}
export function markEmailVerified(at:string|null){const value=sessionRepository.getSettings()[key] as Stored|undefined;if(!value)throw new Error("EMAIL_SETTINGS_MISSING");sessionRepository.setSettings({[key]:{...value,verifiedAt:at}})}
