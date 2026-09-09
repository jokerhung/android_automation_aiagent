import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "dotenv";
import { acquireInstanceLock, AlreadyRunningError, type InstanceLock } from "../lib/server/platform/windows/instance-lock";
import { getWindowsInstallationPaths, normalizeAppRoot, type WindowsInstallationPaths } from "../lib/server/platform/windows/paths";
import { appendBackgroundLog, readBackgroundMetadata, type BackgroundMetadata } from "../lib/server/platform/windows/background-status";
import { probeBackground, stopBackground } from "../lib/server/platform/windows/control-pipe";

export type BackgroundCommand = "start" | "status" | "stop" | "--host";
type StartApplication = typeof import("../lib/server/application-lifecycle").startApplication;
export type BackgroundCliDependencies = {
 platform: NodeJS.Platform; env: NodeJS.ProcessEnv; chdir:(directory:string)=>void; loadEnv:(file:string)=>void;
 exists:(file:string)=>boolean; spawnDetached:(file:string,args:string[],cwd:string)=>Promise<void>;
 acquireLock:typeof acquireInstanceLock; loadStartApplication:()=>Promise<StartApplication>; paths:typeof getWindowsInstallationPaths;
 readMetadata:typeof readBackgroundMetadata; probe:typeof probeBackground; stop:typeof stopBackground;
 now:()=>number; delay:(milliseconds:number)=>Promise<void>; output:(value:unknown)=>void;
};

const defaults: BackgroundCliDependencies = {
 platform:process.platform, env:process.env, chdir:directory=>process.chdir(directory),
 loadEnv:file=>{config({path:file,quiet:true});}, exists:file=>fs.existsSync(file),
 spawnDetached:(file,args,cwd)=>new Promise<void>((resolve,reject)=>{
  const child=spawn(file,args,{cwd,detached:true,windowsHide:true,stdio:"ignore"});
  child.once("error",reject);
  child.once("spawn",()=>{child.unref();resolve()});
 }),
 acquireLock:acquireInstanceLock, loadStartApplication:async()=>(await import("../lib/server/application-lifecycle")).startApplication,
 paths:getWindowsInstallationPaths, readMetadata:readBackgroundMetadata, probe:probeBackground, stop:stopBackground,
 now:()=>Date.now(), delay:milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds)), output:value=>console.log(JSON.stringify(value)),
};

export function resolveBackgroundAppRoot(moduleUrl=import.meta.url){return path.resolve(path.dirname(fileURLToPath(moduleUrl)),"..");}
function bootstrap(appRoot:string,deps:BackgroundCliDependencies){deps.chdir(appRoot);deps.loadEnv(path.join(appRoot,".env.local"));}
function validMetadata(metadata:BackgroundMetadata|null,paths:WindowsInstallationPaths):metadata is BackgroundMetadata{return Boolean(metadata&&metadata.version===1&&normalizeAppRoot(metadata.appRoot)===normalizeAppRoot(paths.appRoot)&&metadata.installationId===paths.installationId&&metadata.pipeName===paths.pipeName&&typeof metadata.instanceId==="string"&&metadata.instanceId.length>0&&Number.isSafeInteger(metadata.pid)&&metadata.pid>0&&Number.isInteger(metadata.port)&&metadata.port>=0&&metadata.port<=65535&&typeof metadata.token==="string"&&metadata.token.length>=32);}
async function inspect(paths:WindowsInstallationPaths,deps:BackgroundCliDependencies){const metadata=deps.readMetadata(paths);if(!metadata)return{metadata:null,live:false,valid:true};if(!validMetadata(metadata,paths))return{metadata,live:false,valid:false};return{metadata,live:await deps.probe(metadata),valid:true};}
async function waitStopped(metadata:BackgroundMetadata,deps:BackgroundCliDependencies,timeoutMs=10000){const deadline=deps.now()+timeoutMs;while(deps.now()<deadline){if(!await deps.probe(metadata))return true;await deps.delay(200);}return !await deps.probe(metadata);}

export function installBackgroundConsoleLogging(paths:WindowsInstallationPaths){
 const format=(values:unknown[])=>values.map(value=>value instanceof Error?(value.stack||value.message):typeof value==="string"?value:JSON.stringify(value)).join(" ");
 const write=(level:string,values:unknown[])=>{try{appendBackgroundLog(paths,`host ${level}: ${format(values)}`)}catch{}};
 console.log=(...values:unknown[])=>write("stdout",values);
 console.info=(...values:unknown[])=>write("stdout",values);
 console.warn=(...values:unknown[])=>write("stderr",values);
 console.error=(...values:unknown[])=>write("stderr",values);
}

async function host(appRoot:string,deps:BackgroundCliDependencies){Object.assign(deps.env,{NODE_ENV:"production"});const paths=deps.paths(appRoot);installBackgroundConsoleLogging(paths);let lock:InstanceLock|null=null;try{lock=await deps.acquireLock({appRoot,mode:"background"});const startApplication=await deps.loadStartApplication();const lifecycle=await startApplication({instanceLock:lock,mode:"background",tray:true,onShutdownFailure:()=>process.exit(1)});process.once("SIGINT",()=>void lifecycle.shutdown("SIGINT").then(()=>process.exit(0)));process.once("SIGTERM",()=>void lifecycle.shutdown("SIGTERM").then(()=>process.exit(0)));}catch(error){lock?.release();throw error;}}

async function start(appRoot:string,deps:BackgroundCliDependencies){
 if(deps.platform!=="win32")throw new Error("Background tray mode is supported only on Windows");
 if(!deps.exists(path.join(appRoot,".next","BUILD_ID")))throw new Error("BUILD_MISSING: run a production build first");
 const paths=deps.paths(appRoot),initial=await inspect(paths,deps);if(!initial.valid)throw new Error("BACKGROUND_METADATA_INVALID: identity validation failed");
 if(initial.live&&initial.metadata){if(initial.metadata.mode!=="background")throw new AlreadyRunningError(initial.metadata);deps.output({status:"already-running",mode:initial.metadata.mode,pid:initial.metadata.pid,ready:initial.metadata.ready&&initial.metadata.trayReady,port:initial.metadata.port});return;}
 const launchStartedAt=deps.now();
 await deps.spawnDetached(process.execPath,["--import",pathToFileURL(path.join(appRoot,"node_modules","tsx","dist","loader.mjs")).href,path.join(appRoot,"scripts","start-background.ts"),"--host"],path.resolve(appRoot));
 const deadline=deps.now()+30000;let newlyOwned:BackgroundMetadata|null=null;
 while(deps.now()<deadline){await deps.delay(250);const current=deps.readMetadata(paths);if(!validMetadata(current,paths)||current.mode!=="background")continue;const isNew=current.token!==initial.metadata?.token,started=Date.parse(current.startedAt)>=launchStartedAt-1000;if(isNew&&started)newlyOwned=current;if(current.ready&&current.trayReady&&current.port>0&&await deps.probe(current)){deps.output({status:"started",mode:"background",pid:current.pid,ready:true,port:current.port,url:"http://127.0.0.1:"+current.port+"/"});return;}}
 if(newlyOwned&&await deps.probe(newlyOwned)){try{await deps.stop(newlyOwned);await waitStopped(newlyOwned,deps);}catch{}}throw new Error("TRAY_START_FAILED: background host did not become ready");
}

async function status(appRoot:string,deps:BackgroundCliDependencies){if(deps.platform!=="win32"){deps.output({status:"unsupported"});return;}const state=await inspect(deps.paths(appRoot),deps);if(!state.valid){deps.output({status:"stopped",reason:"metadata-invalid"});return;}if(!state.live||!state.metadata){deps.output({status:"stopped"});return;}const m=state.metadata;deps.output({status:m.ready&&(m.mode!=="background"||m.trayReady)?"ready":"starting",mode:m.mode,pid:m.pid,port:m.port,ready:m.ready,trayReady:m.trayReady});}
async function stop(appRoot:string,deps:BackgroundCliDependencies){if(deps.platform!=="win32"){deps.output({status:"unsupported"});return;}const state=await inspect(deps.paths(appRoot),deps);if(!state.valid)throw new Error("BACKGROUND_METADATA_INVALID: identity validation failed");if(!state.live||!state.metadata){deps.output({status:"stopped"});return;}if(state.metadata.mode!=="background")throw new AlreadyRunningError(state.metadata);await deps.stop(state.metadata);if(!await waitStopped(state.metadata,deps))throw new Error("SHUTDOWN_TIMEOUT: background instance did not acknowledge completion");deps.output({status:"stopped",pid:state.metadata.pid});}

export async function runBackgroundCommand(command:BackgroundCommand,options:{appRoot?:string;dependencies?:Partial<BackgroundCliDependencies>}={}){const appRoot=path.resolve(options.appRoot??resolveBackgroundAppRoot()),deps={...defaults,...options.dependencies};bootstrap(appRoot,deps);if(command==="--host")return host(appRoot,deps);if(command==="start")return start(appRoot,deps);if(command==="status")return status(appRoot,deps);if(command==="stop")return stop(appRoot,deps);throw new Error("Usage: start-background.ts [start|status|stop|--host]");}
async function main(){await runBackgroundCommand((process.argv[2]??"start") as BackgroundCommand);}
const invoked=process.argv[1]?path.resolve(process.argv[1]):"",current=path.resolve(fileURLToPath(import.meta.url));if(invoked===current)main().catch(error=>{if(error instanceof AlreadyRunningError)console.log(JSON.stringify({status:"already-running",mode:error.existing.mode,pid:error.existing.pid,message:error.message}));else if(error instanceof Error&&error.name==="StartupCancelledError")process.exitCode=0;else{console.error(error);process.exitCode=1;}});
