import {createHash,randomBytes,randomUUID} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {getWindowsInstallationPaths,type WindowsInstallationPaths} from "./paths";
import {probeBackground} from "./control-pipe";
import {readBackgroundMetadata,type InstanceMode} from "./background-status";
import {ensureProtectedDirectory} from "./windows-security";

export type LockRecord={version:1;appRoot:string;installationId:string;instanceId:string;pid:number;startedAt:string;mode:InstanceMode;pipeName:string};
export class AlreadyRunningError extends Error{constructor(readonly existing:LockRecord){super(`Android Agent is already running (PID ${existing.pid}, mode ${existing.mode})`);this.name="AlreadyRunningError"}}
function readLock(file:string){try{return JSON.parse(fs.readFileSync(file,"utf8")) as LockRecord}catch{return null}}
function sameOwner(left:LockRecord|null,right:LockRecord){return left?.instanceId===right.instanceId&&left.pid===right.pid&&left.startedAt===right.startedAt&&left.installationId===right.installationId&&left.appRoot===right.appRoot}
export function processExists(pid:number){try{process.kill(pid,0);return true}catch(error){return (error as NodeJS.ErrnoException).code!=="ESRCH"}}
function removeIfExists(file:string){try{fs.unlinkSync(file)}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error}}
function reclaimStaleLock(lockPath:string,existing:LockRecord){
 const claimPath=lockPath+".stale-claim",quarantinePath=lockPath+".stale-"+process.pid+"-"+randomBytes(8).toString("hex");
 let claim:number|undefined,claimOwned=false,moved=false;
 try{
  claim=fs.openSync(claimPath,"wx",0o600);claimOwned=true;fs.writeFileSync(claim,JSON.stringify({instanceId:existing.instanceId,pid:process.pid}));fs.fsyncSync(claim);fs.closeSync(claim);claim=undefined;
  if(!sameOwner(readLock(lockPath),existing))throw new Error("Instance lock changed while stale reclaim was being claimed");
  fs.renameSync(lockPath,quarantinePath);moved=true;
  if(!sameOwner(readLock(quarantinePath),existing)){
   try{fs.renameSync(quarantinePath,lockPath);moved=false}catch{}
   throw new Error("Quarantined instance lock did not match the stale owner");
  }
  removeIfExists(quarantinePath);moved=false;
 }finally{
  if(claim!==undefined)fs.closeSync(claim);
  if(moved&&sameOwner(readLock(quarantinePath),existing))removeIfExists(quarantinePath);
  if(claimOwned)removeIfExists(claimPath);
 }
}
export type InstanceLock={paths:WindowsInstallationPaths;record:LockRecord;token:string;release:()=>void};
export async function acquireInstanceLock(options:{appRoot?:string;mode:InstanceMode}):Promise<InstanceLock>{
 const paths=getWindowsInstallationPaths(options.appRoot);fs.mkdirSync(path.dirname(paths.lockPath),{recursive:true});ensureProtectedDirectory(paths.stateDirectory);
 for(let attempt=0;attempt<3;attempt++){
  const record:LockRecord={version:1,appRoot:paths.appRoot,installationId:paths.installationId,instanceId:randomUUID(),pid:process.pid,startedAt:new Date().toISOString(),mode:options.mode,pipeName:paths.pipeName};
  const token=randomBytes(32).toString("hex");
  try{
   const handle=fs.openSync(paths.lockPath,"wx",0o600);
   try{fs.writeFileSync(handle,JSON.stringify(record,null,2));fs.fsyncSync(handle)}finally{fs.closeSync(handle)}
   // Shared cross-user exclusion record contains identity only, never IPC credentials.
   let released=false;
   return{paths,record,token,release:()=>{if(released)return;released=true;const current=readLock(paths.lockPath);if(sameOwner(current,record))removeIfExists(paths.lockPath)}};
  }catch(error){
   if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;
   const existing=readLock(paths.lockPath);
   const validIdentity=existing&&existing.version===1&&Number.isSafeInteger(existing.pid)&&existing.pid>0&&typeof existing.startedAt==="string"&&Number.isFinite(Date.parse(existing.startedAt));
   // Previous releases keyed the installation by lowercased app root and had no instanceId.
   const legacyRoot=path.resolve(paths.appRoot).toLowerCase();
   const legacyId=createHash("sha256").update(legacyRoot).digest("hex").slice(0,16);
   const legacy=validIdentity&&!existing.instanceId&&typeof existing.appRoot==="string"&&path.resolve(existing.appRoot).toLowerCase()===legacyRoot&&existing.installationId===legacyId&&typeof (existing as LockRecord & {token?:string}).token==="string";
   if(!validIdentity||(!legacy&&(!existing.instanceId||existing.installationId!==paths.installationId)))throw new Error("Instance lock is unreadable or belongs to an unexpected installation");
   const privateMetadata=readBackgroundMetadata(paths);
   const liveByIpc=Boolean(privateMetadata&&privateMetadata.instanceId===existing.instanceId&&privateMetadata.pid===existing.pid&&await probeBackground(privateMetadata));
   if(liveByIpc||processExists(existing.pid))throw new AlreadyRunningError(existing);
   try{reclaimStaleLock(paths.lockPath,existing)}catch(reclaimError){
    if((reclaimError as NodeJS.ErrnoException).code==="EEXIST"||!fs.existsSync(paths.lockPath))continue;
    throw reclaimError;
   }
  }
 }
 throw new Error("Could not acquire the application instance lock");
}
