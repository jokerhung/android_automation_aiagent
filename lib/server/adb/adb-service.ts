import "@/lib/server/server-guard";
import { spawn } from "node:child_process";

export class AdbError extends Error { constructor(message:string,public code="ADB_ERROR",public stderr=""){super(message)} }
export type CommandResult={stdout:Buffer;stderr:Buffer};
export type AdbExecutor=(args:string[],timeoutMs:number,signal?:AbortSignal)=>Promise<CommandResult>;

class SerialQueue {
 private chains=new Map<string,Promise<unknown>>();
 run<T>(serial:string,job:()=>Promise<T>):Promise<T>{const previous=this.chains.get(serial)??Promise.resolve();const next=previous.catch(()=>undefined).then(job);this.chains.set(serial,next);return next.finally(()=>{if(this.chains.get(serial)===next)this.chains.delete(serial)})}
}

export class AdbService {
 private queue=new SerialQueue();
 constructor(private executable=process.env.ADB_PATH||"adb",private executor?:AdbExecutor){}
 run(args:string[],options:{serial?:string;timeoutMs?:number;signal?:AbortSignal;queued?:boolean}={}):Promise<CommandResult>{
  const full=options.serial?["-s",options.serial,...args]:args;
  const execute=()=>{options.signal?.throwIfAborted();return (this.executor??this.spawn.bind(this))(full,options.timeoutMs??15000,options.signal)};
  return options.serial&&options.queued!==false?this.queue.run(options.serial,execute):execute();
 }
 private spawn(args:string[],timeoutMs:number,signal?:AbortSignal){
  return new Promise<CommandResult>((resolve,reject)=>{
   signal?.throwIfAborted();
   const child=spawn(this.executable,args,{windowsHide:true,stdio:["ignore","pipe","pipe"]});
   const stdout:Buffer[]=[],stderr:Buffer[]=[];
   let terminalError:Error|null=null,settled=false;
   const requestStop=(error:Error)=>{if(terminalError)return;terminalError=error;child.kill();};
   const abort=()=>requestStop(new DOMException("Operation aborted","AbortError"));
   const timer=setTimeout(()=>requestStop(new AdbError("ADB command timed out after "+timeoutMs+"ms","ADB_TIMEOUT")),timeoutMs);
   child.stdout.on("data",data=>stdout.push(data));child.stderr.on("data",data=>stderr.push(data));
   child.on("error",error=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener("abort",abort);reject(new AdbError(error.message,error.message.includes("ENOENT")?"ADB_NOT_FOUND":"ADB_SPAWN"))});
   child.on("close",code=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener("abort",abort);if(terminalError){reject(terminalError);return}const out=Buffer.concat(stdout),err=Buffer.concat(stderr);if(code===0)resolve({stdout:out,stderr:err});else reject(new AdbError(err.toString("utf8").trim()||("adb exited with code "+code),"ADB_COMMAND",err.toString("utf8")))});
   signal?.addEventListener("abort",abort,{once:true});
   if(signal?.aborted)abort();
  });
 }
 async text(args:string[],options:{serial?:string;timeoutMs?:number;signal?:AbortSignal;queued?:boolean}={}){return(await this.run(args,options)).stdout.toString("utf8").trim()}
}
export const adbService=new AdbService();

