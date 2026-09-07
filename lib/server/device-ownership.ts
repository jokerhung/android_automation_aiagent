type DeviceOwnership={runId:string;paused:boolean};
class DeviceOwnershipRegistry {
  private devices=new Map<string,DeviceOwnership>();
  acquire(serial:string,runId:string){const current=this.devices.get(serial);if(current&&current.runId!==runId)throw new Error("Thiết bị đang được một tác vụ khác sử dụng");this.devices.set(serial,{runId,paused:false})}
  setPaused(serial:string,runId:string,paused:boolean){const current=this.devices.get(serial);if(current?.runId===runId)this.devices.set(serial,{runId,paused})}
  release(serial:string,runId:string){if(this.devices.get(serial)?.runId===runId)this.devices.delete(serial)}
  assertManualAllowed(serial:string){const current=this.devices.get(serial);if(current&&!current.paused)throw new Error("Agent đang điều khiển thiết bị. Hãy tạm dừng tác vụ trước khi điều khiển thủ công.")}
}
export const deviceOwnershipRegistry=new DeviceOwnershipRegistry();
