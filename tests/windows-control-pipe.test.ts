import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {afterEach,describe,expect,it,vi} from "vitest";
import {createControlPipe,probeBackground} from "@/lib/server/platform/windows/control-pipe";
import type {BackgroundMetadata} from "@/lib/server/platform/windows/background-status";

const sockets:string[]=[];
afterEach(()=>{for(const socket of sockets.splice(0))try{fs.unlinkSync(socket)}catch{};vi.restoreAllMocks()});
function metadata(pipeName:string,instanceId="instance-a"):BackgroundMetadata{return{version:1,appRoot:String.raw`C:\app`,installationId:"install",instanceId,pid:123,startedAt:new Date().toISOString(),mode:"background",pipeName,token:"secret",port:3000,ready:true,trayReady:true}}
function socketName(){if(process.platform==="win32")return String.raw`\\.\pipe\android-agent-test-${process.pid}-${Math.random().toString(16).slice(2)}`;const value=path.join(os.tmpdir(),`android-agent-${process.pid}-${Math.random().toString(16).slice(2)}.sock`);sockets.push(value);return value}
async function listen(server:net.Server,name:string){await new Promise<void>((resolve,reject)=>server.listen(name,resolve).once("error",reject))}
async function close(server:net.Server){await new Promise<void>(resolve=>server.close(()=>resolve()))}

describe("Windows control pipe identity",()=>{
 it("rejects null JSON without crashing or stopping the host",async()=>{
  const name=socketName(),onStop=vi.fn(),owner=metadata(name),server=createControlPipe({metadata:owner,onStop});
  await listen(server,name);
  try{
   const response=await new Promise<string>((resolve,reject)=>{
    let data="";const client=net.createConnection(name);
    client.once("error",reject);client.once("connect",()=>client.write("null\n"));
    client.on("data",chunk=>{data+=chunk});client.once("end",()=>resolve(data));
   });
   expect(JSON.parse(response).ok).toBe(false);
   expect(onStop).not.toHaveBeenCalled();
   expect(await probeBackground(owner)).toBe(true);
  }finally{await close(server)}
 });
 it("requires the response instance ID to match the probe metadata",async()=>{const name=socketName(),server=createControlPipe({metadata:metadata(name,"owner"),onStop:vi.fn()});await listen(server,name);try{expect(await probeBackground(metadata(name,"owner"))).toBe(true);expect(await probeBackground(metadata(name,"other"))).toBe(false)}finally{await close(server)}});
 it("handles only the first complete request on a socket",async()=>{const name=socketName(),onStop=vi.fn(),owner=metadata(name),server=createControlPipe({metadata:owner,onStop});await listen(server,name);try{await new Promise<void>((resolve,reject)=>{const client=net.createConnection(name);client.once("error",reject);client.on("data",()=>{});client.once("connect",()=>client.write(JSON.stringify({token:owner.token,instanceId:owner.instanceId,action:"stop"})+"\n"+JSON.stringify({token:owner.token,instanceId:owner.instanceId,action:"stop"})+"\n"));client.once("end",resolve)});expect(onStop).toHaveBeenCalledTimes(1)}finally{await close(server)}});
});
