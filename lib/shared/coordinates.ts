export type Viewport={left:number;top:number;width:number;height:number};
export function normalizedToPixel(x:number,y:number,width:number,height:number){return {x:Math.max(0,Math.min(width-1,Math.round(x*width/1000))),y:Math.max(0,Math.min(height-1,Math.round(y*height/1000)))}}
export function pointerToNormalized(clientX:number,clientY:number,box:Viewport){return {x:Math.max(0,Math.min(1000,Math.round((clientX-box.left)*1000/box.width))),y:Math.max(0,Math.min(1000,Math.round((clientY-box.top)*1000/box.height)))}}
