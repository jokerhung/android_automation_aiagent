import "@/lib/server/server-guard";
import {EventEmitter} from "node:events";import type {AppEvent} from "@/lib/contracts/types";
class EventBus{private emitter=new EventEmitter();emit(type:string,data:unknown,meta:{conversationId?:string;runId?:string}={}){const event:AppEvent={eventId:crypto.randomUUID(),type,data,...meta,createdAt:new Date().toISOString()};this.emitter.emit("event",event);return event}subscribe(listener:(event:AppEvent)=>void){this.emitter.on("event",listener);return()=>this.emitter.off("event",listener)}}export const eventBus=new EventBus();
