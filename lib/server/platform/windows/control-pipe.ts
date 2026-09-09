import net from "node:net";
import type {BackgroundMetadata} from "./background-status";

const MAX_MESSAGE=4096,SERVER_TIMEOUT_MS=5000;
export type ControlAction="probe"|"stop";
type Request={token:string;instanceId:string;action:ControlAction};
type Response={ok:boolean;instanceId:string;status?:string;error?:string};
function request(metadata:BackgroundMetadata,action:ControlAction,timeoutMs=2000){return new Promise<Response>((resolve,reject)=>{
 let settled=false,buffer="";const socket=net.createConnection(metadata.pipeName);
 const finish=(error?:Error,value?:Response)=>{if(settled)return;settled=true;socket.destroy();error?reject(error):resolve(value!)};
 socket.setTimeout(timeoutMs);
 socket.once("connect",()=>socket.write(JSON.stringify({token:metadata.token,instanceId:metadata.instanceId,action})+"\n"));
 socket.on("data",chunk=>{buffer+=chunk.toString("utf8");if(buffer.length>MAX_MESSAGE)return finish(new Error("Control response is too large"));const newline=buffer.indexOf("\n");if(newline>=0)try{finish(undefined,JSON.parse(buffer.slice(0,newline)) as Response)}catch{finish(new Error("Invalid control response"))}});
 socket.once("timeout",()=>finish(new Error("Control request timed out")));
 socket.once("error",error=>finish(error));
 socket.once("end",()=>{if(!settled)finish(new Error("Control pipe closed without a response"))});
})}
export async function probeBackground(metadata:BackgroundMetadata){try{const response=await request(metadata,"probe");return response.ok&&response.instanceId===metadata.instanceId}catch{return false}}
export async function stopBackground(metadata:BackgroundMetadata){const response=await request(metadata,"stop",5000);if(!response.ok||response.instanceId!==metadata.instanceId)throw new Error(response.error||"Stop request was rejected");return response}
export function createControlPipe(options:{metadata:BackgroundMetadata;onStop:()=>void}){
 const server=net.createServer(socket=>{
  let buffer="",handled=false;
  const respond=(response:Omit<Response,"instanceId">)=>{if(handled)return;handled=true;socket.end(JSON.stringify({...response,instanceId:options.metadata.instanceId})+"\n")};
  socket.setEncoding("utf8");socket.setTimeout(SERVER_TIMEOUT_MS);
  socket.once("timeout",()=>respond({ok:false,error:"Request timed out"}));
  socket.once("error",()=>{handled=true;socket.destroy()});
  socket.on("data",chunk=>{
   if(handled)return;buffer+=chunk;
   if(buffer.length>MAX_MESSAGE)return respond({ok:false,error:"Message too large"});
   const newline=buffer.indexOf("\n");if(newline<0)return;
   let parsed:Request;try{parsed=JSON.parse(buffer.slice(0,newline)) as Request}catch{return respond({ok:false,error:"Invalid JSON"})}
   if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)||Object.keys(parsed).some(key=>!["token","instanceId","action"].includes(key)))return respond({ok:false,error:"Invalid request"});
   if(parsed.token!==options.metadata.token||parsed.instanceId!==options.metadata.instanceId)return respond({ok:false,error:"Unauthorized"});
   if(parsed.action==="probe")respond({ok:true,status:options.metadata.ready?"ready":"starting"});
   else if(parsed.action==="stop"){respond({ok:true,status:"stopping"});options.onStop()}
   else respond({ok:false,error:"Unsupported action"});
  });
 });
 return server;
}
