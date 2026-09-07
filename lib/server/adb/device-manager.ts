import "@/lib/server/server-guard";
import type {DeviceSummary} from "@/lib/contracts/types";
import {adbService,AdbError} from "./adb-service";
function fields(line:string){return Object.fromEntries(line.trim().split(/\s+/).slice(2).map(value=>{const index=value.indexOf(":");return index<0?[value,""]:[value.slice(0,index),value.slice(index+1)]}))}
export function parseDeviceList(output:string):DeviceSummary[]{return output.split(/\r?\n/).slice(1).filter(Boolean).map(line=>{const parts=line.trim().split(/\s+/),serial=parts[0],raw=parts[1],state=(raw==="device"||raw==="unauthorized"||raw==="offline"?raw:"offline") as DeviceSummary["state"],metadata=fields(line),model=metadata.model?.replaceAll("_"," ")||null;return{serial,state,model,product:metadata.product||null,device:metadata.device||null,transportId:metadata.transport_id||null,displayName:(model||metadata.device||"Android")+" · "+(serial.length>10?serial.slice(0,6)+"…"+serial.slice(-4):serial),width:null,height:null}})}
export class DeviceManager{
 async listDevices(){const output=await adbService.text(["devices","-l"],{queued:false});const devices=parseDeviceList(output);await Promise.all(devices.filter(device=>device.state==="device").map(async device=>{try{const size=await this.getScreenSize(device.serial);device.width=size.width;device.height=size.height}catch(error){console.warn("Không đọc được kích thước thiết bị",device.serial,error instanceof Error?error.message:error)}}));return devices}
 async getScreenSize(serial:string){const output=await adbService.text(["shell","wm","size"],{serial});const matches=[...output.matchAll(/(\d+)x(\d+)/g)],match=matches.at(-1);let width=match?Number(match[1]):1080,height=match?Number(match[2]):2400;try{const rotation=await adbService.text(["shell","dumpsys","input"],{serial,timeoutMs:5000});const orientation=rotation.match(/SurfaceOrientation:\s*(\d)/);if(orientation&&["1","3"].includes(orientation[1])&&height>width)[width,height]=[height,width]}catch{}return{width,height}}
 async requireConnected(serial:string){const found=(await this.listDevices()).find(device=>device.serial===serial);if(!found)throw new AdbError("Device not found","DEVICE_NOT_FOUND");if(found.state!=="device")throw new AdbError("Device is "+found.state,"DEVICE_"+found.state.toUpperCase());return found}
}
export const deviceManager=new DeviceManager();

