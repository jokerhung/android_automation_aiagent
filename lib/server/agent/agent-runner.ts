import "@/lib/server/server-guard";
import sharp from "sharp";
import { adbService } from "@/lib/server/adb/adb-service";
import { deviceManager } from "@/lib/server/adb/device-manager";
import { uiHierarchyService } from "@/lib/server/adb/ui-hierarchy";
import { deviceControlService } from "@/lib/server/scrcpy/device-control-service";
import { modelClient } from "@/lib/server/model/model-client";
import { sessionRepository } from "@/lib/server/persistence/session-repository";
import { eventBus } from "@/lib/server/event-bus";
import type { RunRecord } from "@/lib/contracts/types";
import { deviceOwnershipRegistry } from "@/lib/server/device-ownership";
import {safeError} from "@/lib/server/logging/redaction";

const sleep = (ms:number, signal:AbortSignal) => new Promise<void>((resolve,reject) => {
  const timer=setTimeout(resolve,ms);
  signal.addEventListener("abort",()=>{clearTimeout(timer);reject(new DOMException("Aborted","AbortError"))},{once:true});
});
type Active={controller:AbortController;pauseRequested:boolean;resume?:()=>void;done:Promise<void>};
const activeRunsKey=Symbol.for("android-vision-control.active-agent-runs");
const activeRuns=()=>{const root=globalThis as typeof globalThis&{[activeRunsKey]?:Map<string,Active>};return root[activeRunsKey]??=new Map<string,Active>()};

class AgentRunner {
  private active=activeRuns();

  start(run:RunRecord) {
    if([...this.active.keys()].some(id=>sessionRepository.findRun(id)?.deviceSerial===run.deviceSerial)) throw new Error("An agent is already active on this device");
    let finish!:()=>void;const done=new Promise<void>(resolve=>finish=resolve);const state:Active={controller:new AbortController(),pauseRequested:false,done};
    deviceOwnershipRegistry.acquire(run.deviceSerial,run.id);
    this.active.set(run.id,state);
    void this.loop(run,state).finally(finish);
    return run;
  }

  pause(id:string) {
    const state=this.active.get(id),run=sessionRepository.findRun(id);
    if(!state||!run||run.status!=="running") throw new Error("Run is not running");
    state.pauseRequested=true;
    sessionRepository.updateRun(id,{status:"pausing"});
    eventBus.emit("run.status",{status:"pausing"},{conversationId:run.conversationId,runId:id});
  }

  resume(id:string) {
    const state=this.active.get(id),run=sessionRepository.findRun(id);
    if(!state||!run||run.status!=="paused") throw new Error("Run is not paused");
    state.pauseRequested=false;
    state.resume?.();state.resume=undefined;
    sessionRepository.updateRun(id,{status:"running"});
    eventBus.emit("run.status",{status:"running"},{conversationId:run.conversationId,runId:id});
  }

  stats(){return{active:this.active.size}}

  async shutdown(timeoutMs=4500){const states=[...this.active.values()];for(const state of states){state.controller.abort();state.resume?.()}if(!states.length)return;await Promise.race([Promise.allSettled(states.map(state=>state.done)),new Promise<void>(resolve=>setTimeout(resolve,timeoutMs))])}

  cancelBySerial(serial:string) { for(const id of this.active.keys()){const run=sessionRepository.findRun(id);if(run?.deviceSerial===serial)this.cancel(id)} }

  cancel(id:string) {
    const state=this.active.get(id),run=sessionRepository.findRun(id);
    if(!run)return false;
    if(!state){
      if(["queued","running","pausing","paused","cancelling"].includes(run.status)){
        sessionRepository.updateRun(id,{status:"cancelled",errorCode:"CANCELLED",result:"Đã dừng tác vụ.",endedAt:new Date().toISOString()});
        sessionRepository.addMessage(run.conversationId,"assistant","Đã dừng tác vụ.");
        deviceOwnershipRegistry.release(run.deviceSerial,run.id);
        eventBus.emit("run.cancelled",{error:"Đã dừng tác vụ."},{conversationId:run.conversationId,runId:id});
      }
      return true;
    }
    if(run.status!=="cancelling")sessionRepository.updateRun(id,{status:"cancelling"});
    state.controller.abort();state.resume?.();
    eventBus.emit("run.status",{status:"cancelling"},{conversationId:run.conversationId,runId:id});
    return true;
  }

  private async checkpoint(run:RunRecord,state:Active) {
    state.controller.signal.throwIfAborted();
    if(!state.pauseRequested)return false;
    sessionRepository.updateRun(run.id,{status:"paused"});
    deviceOwnershipRegistry.setPaused(run.deviceSerial,run.id,true);
    eventBus.emit("run.status",{status:"paused"},{conversationId:run.conversationId,runId:run.id});
    await new Promise<void>(resolve=>state.resume=resolve);
    deviceOwnershipRegistry.setPaused(run.deviceSerial,run.id,false);
    state.controller.signal.throwIfAborted();
    return true;
  }

  private async loop(run:RunRecord,state:Active) {
    try {
      sessionRepository.updateRun(run.id,{status:"running"});
      eventBus.emit("run.status",{status:"running"},{conversationId:run.conversationId,runId:run.id});
      for(let step=1;step<=run.maxSteps;step++){
        await this.checkpoint(run,state);
        const device=await deviceManager.requireConnected(run.deviceSerial);
        await this.checkpoint(run,state);
        sessionRepository.addRunEvent(run.id,"run.step.started",{step,maxSteps:run.maxSteps});
        eventBus.emit("run.step.started",{step,maxSteps:run.maxSteps},{conversationId:run.conversationId,runId:run.id});
        const capture=await adbService.run(["exec-out","screencap","-p"],{serial:run.deviceSerial,signal:state.controller.signal,timeoutMs:15000});
        await this.checkpoint(run,state);
        const jpeg=await sharp(capture.stdout).jpeg({quality:80}).toBuffer();
        await this.checkpoint(run,state);
        const elements=await uiHierarchyService.getClickableElements(run.deviceSerial);
        await this.checkpoint(run,state);
        const action=await modelClient.nextAction({goal:run.goal,imageBase64:jpeg.toString("base64"),imageMediaType:"image/jpeg",uiContext:uiHierarchyService.format(elements,device.width||1080,device.height||2400),history:run.steps,signal:state.controller.signal});
        if(await this.checkpoint(run,state))continue;
        if(action.action==="finish"){
          sessionRepository.addStep(run.id,action,action.thought,null);
          sessionRepository.updateRun(run.id,{status:"completed",result:action.thought,endedAt:new Date().toISOString()});
          sessionRepository.addMessage(run.conversationId,"assistant",action.thought);
          eventBus.emit("run.completed",{result:action.thought},{conversationId:run.conversationId,runId:run.id});
          return;
        }
        sessionRepository.addRunEvent(run.id,"run.step.planned",{step,action:action.action,summary:action.thought});
        eventBus.emit("run.step.planned",{step,action:action.action,summary:action.thought},{conversationId:run.conversationId,runId:run.id});
        const started=Date.now();
        await deviceControlService.execute(run.deviceSerial,action,state.controller.signal,"agent");
        await this.checkpoint(run,state);
        const saved=sessionRepository.addStep(run.id,action,action.thought,Date.now()-started);
        run.steps.push(saved);
        eventBus.emit("run.step.action",saved,{conversationId:run.conversationId,runId:run.id});
        await sleep(1500,state.controller.signal);
      }
      throw Object.assign(new Error("Reached maximum steps without completion"),{code:"MAX_STEPS"});
    } catch(error) {
      const aborted=state.controller.signal.aborted;
      const message=safeError(error);
      sessionRepository.updateRun(run.id,{status:aborted?"cancelled":"failed",errorCode:aborted?"CANCELLED":((error as {code?:string}).code||"RUN_ERROR"),result:message,endedAt:new Date().toISOString()});
      sessionRepository.addMessage(run.conversationId,"assistant",aborted?"Đã dừng tác vụ.":"Lỗi: "+message);
      eventBus.emit(aborted?"run.cancelled":"run.failed",{error:message},{conversationId:run.conversationId,runId:run.id});
    } finally {
      deviceOwnershipRegistry.release(run.deviceSerial,run.id);
      this.active.delete(run.id);
    }
  }
}
export const agentRunner=new AgentRunner();

