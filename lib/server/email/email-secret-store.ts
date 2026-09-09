import "@/lib/server/server-guard";
import {spawn} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {getWindowsInstallationPaths} from "@/lib/server/platform/windows/paths";
import {ensureProtectedDirectory,protectWindowsPath} from "@/lib/server/platform/windows/windows-security";
const helper=path.resolve(process.cwd(),"scripts","windows","email-secret.ps1");
function secretPath(appRoot=process.cwd()){return path.join(getWindowsInstallationPaths(appRoot).stateDirectory,"email-password.dpapi")}
async function transform(action:"protect"|"unprotect",value:string){
 if(process.platform!=="win32")throw new Error("EMAIL_SECRET_STORE_UNSUPPORTED");
 if(!fs.existsSync(helper))throw new Error("EMAIL_SECRET_HELPER_MISSING");
 const powershell=path.join(process.env.SystemRoot||"C:/Windows","System32","WindowsPowerShell","v1.0","powershell.exe");
 const output=await new Promise<string>((resolve,reject)=>{
  const child=spawn(powershell,["-NoLogo","-NoProfile","-NonInteractive","-File",helper,"-Action",action],{windowsHide:true,stdio:["pipe","pipe","pipe"]});
  let stdout="",stderr="";const timer=setTimeout(()=>{child.kill();reject(new Error("EMAIL_SECRET_TIMEOUT"))},10_000);
  child.stdout.setEncoding("utf8");child.stderr.setEncoding("utf8");
  child.stdout.on("data",chunk=>{stdout=(stdout+chunk).slice(-4096)});child.stderr.on("data",chunk=>{stderr=(stderr+chunk).slice(-1024)});
  child.once("error",error=>{clearTimeout(timer);reject(error)});child.once("exit",code=>{clearTimeout(timer);code===0?resolve(stdout):reject(new Error("EMAIL_SECRET_TRANSFORM_FAILED"+(stderr?": "+stderr.trim():"")))});
  child.stdin.end(value);
 });
 if(!output)throw new Error("EMAIL_SECRET_TRANSFORM_FAILED");return output;
}
export async function hasEmailPassword(appRoot=process.cwd()){return fs.existsSync(secretPath(appRoot))||Boolean(process.env.EMAIL_SMTP_PASSWORD)}
export async function setEmailPassword(password:string,appRoot=process.cwd()){
 const file=secretPath(appRoot),directory=path.dirname(file);ensureProtectedDirectory(directory,{allowSystem:true});
 const encrypted=await transform("protect",password),temporary=file+"."+process.pid+".tmp";
 try{fs.writeFileSync(temporary,encrypted,{encoding:"utf8",mode:0o600,flag:"wx"});protectWindowsPath(temporary);fs.renameSync(temporary,file);protectWindowsPath(file)}finally{try{fs.unlinkSync(temporary)}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error}}
}
export async function getEmailPassword(appRoot=process.cwd()){
 const environment=process.env.EMAIL_SMTP_PASSWORD;if(environment)return environment;
 const file=secretPath(appRoot);if(!fs.existsSync(file))return null;return transform("unprotect",fs.readFileSync(file,"utf8"));
}
export function clearEmailPassword(appRoot=process.cwd()){const file=secretPath(appRoot);try{fs.unlinkSync(file)}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error}}
