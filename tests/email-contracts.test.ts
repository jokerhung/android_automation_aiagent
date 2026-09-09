import {describe,expect,it} from "vitest";
import {emailSettingsInputSchema,scheduleEmailNotificationSchema} from "@/lib/contracts/email";
describe("email contracts",()=>{
 const valid={host:"smtp.example.test",port:587,security:"starttls" as const,username:"agent@example.test",defaultRecipient:"owner@example.test"};
 it("accepts strict saved SMTP settings without requiring password replacement",()=>{expect(emailSettingsInputSchema.parse(valid)).toMatchObject(valid)});
 it("rejects command hosts, invalid ports, header injection and ambiguous clear",()=>{
  expect(()=>emailSettingsInputSchema.parse({...valid,host:"https://evil.test"})).toThrow();expect(()=>emailSettingsInputSchema.parse({...valid,port:0})).toThrow();
  expect(()=>emailSettingsInputSchema.parse({...valid,username:"Agent\r\nBcc: x@example.test"})).toThrow();expect(()=>emailSettingsInputSchema.parse({...valid,password:"x",clearPassword:true})).toThrow();
 });
 it("keeps notifications opt-in and validates recipient/subject",()=>{expect(scheduleEmailNotificationSchema.parse({enabled:false})).toEqual({enabled:false});expect(()=>scheduleEmailNotificationSchema.parse({enabled:true,to:"a@example.test",subject:"ok\r\nBcc: x@example.test"})).toThrow()});
});
