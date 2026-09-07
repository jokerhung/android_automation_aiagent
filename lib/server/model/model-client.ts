import "@/lib/server/server-guard";
import OpenAI from "openai";
import type {AgentAction,RunStep} from "@/lib/contracts/types";
import {agentActionSchema} from "@/lib/contracts/schemas";import {getRuntimeSettings} from "@/lib/server/runtime-settings";

function jsonObjects(content:string){const objects:string[]=[];for(let start=0;start<content.length;start++){if(content[start]!=="{")continue;let depth=0,inString=false,escaped=false;for(let end=start;end<content.length;end++){const char=content[end];if(inString){if(escaped)escaped=false;else if(char==="\\")escaped=true;else if(char==='"')inString=false;continue}if(char==='"'){inString=true;continue}if(char==="{")depth++;if(char==="}"){depth--;if(depth===0){objects.push(content.slice(start,end+1));break}}}}return objects}
export function parseAgentAction(content:string):AgentAction{if(!content.trim())throw new Error("Model returned an empty response");let detail="No valid JSON object found";for(const candidate of jsonObjects(content)){try{const checked=agentActionSchema.safeParse(JSON.parse(candidate));if(checked.success)return checked.data;detail=checked.error.issues.at(-1)?.message||detail}catch(error){detail=error instanceof Error?error.message:detail}}throw new Error("Model returned an invalid AgentAction: "+detail)}
const schema={type:"object",additionalProperties:false,required:["action","thought","x","y","x2","y2","duration_ms","text","keycode"],properties:{action:{type:"string",enum:["tap","swipe","text","keyevent","wait","finish"]},thought:{type:"string",maxLength:500},x:{type:["integer","null"],minimum:0,maximum:1000},y:{type:["integer","null"],minimum:0,maximum:1000},x2:{type:["integer","null"],minimum:0,maximum:1000},y2:{type:["integer","null"],minimum:0,maximum:1000},duration_ms:{type:["integer","null"],minimum:50,maximum:5000},text:{type:["string","null"],maxLength:500},keycode:{type:["integer","null"]}}};

function actionIdentity(step:RunStep){
  const action=step.action;
  if(!action)return "status:"+step.summary.trim().toLocaleLowerCase("vi");
  return [action.action,action.x,action.y,action.x2,action.y2,action.text,action.keycode,step.summary.trim().toLocaleLowerCase("vi")].join(":");
}

export function actionLoopWarning(history:RunStep[]){
  if(history.length<4)return "";
  const recent=history.slice(-4).map(actionIdentity);
  if(recent[0]!==recent[2]||recent[1]!==recent[3]||recent[0]===recent[1])return "";
  return "CẢNH BÁO: Bốn thao tác cuối đang lặp theo chu kỳ A-B-A-B. Không được lặp lại A hoặc B. Hãy xác định bước đánh số chưa hoàn thành tiếp theo từ toàn bộ lịch sử và chuyển sang bước đó.";
}

export function formatActionHistory(history:RunStep[]){
  if(!history.length)return "Chưa có";
  return history.map(step=>"- Bước thực thi "+step.stepNo+": "+(step.action?.action||"trạng thái")+" ("+step.summary.slice(0,200)+")").join("\n");
}

export class ModelClient{
  async nextAction(input:{goal:string;imageBase64:string;imageMediaType?:"image/jpeg"|"image/png";uiContext:string;history:RunStep[];signal?:AbortSignal}){
    const key=process.env.OPENAI_API_KEY;
    if(!key)throw new Error("OPENAI_API_KEY is not configured");
    const settings=getRuntimeSettings();
    const client=new OpenAI({apiKey:key,baseURL:settings.baseUrl});
    const history=formatActionHistory(input.history);
    const loopWarning=actionLoopWarning(input.history);
    const system=[
      "Bạn là trợ lý AI tự hành chỉ điều khiển điện thoại Android.",
      "Mỗi lượt chỉ trả về một hành động JSON theo schema. Tọa độ 0..1000. Nhấn tâm nút.",
      "Phải focus ô nhập ở bước trước khi nhập text. Recent Apps luôn dùng keyevent 187.",
      "Nếu mục tiêu là danh sách đánh số, thực hiện đúng thứ tự và mỗi mục đúng một lần. Lịch sử là các việc đã làm; không quay lại mục cũ chỉ vì màn hình hiện tại giống trạng thái ban đầu.",
      "Sau khi đưa ứng dụng về màn hình Home để chuẩn bị mở đa nhiệm, hành động kế tiếp phải là keyevent 187, không mở lại ứng dụng.",
      "Bạn không có khả năng thao tác tiến trình hoặc tệp trên máy tính. Không mô phỏng các bước PC bằng thao tác Android; sau khi xong phần Android, dùng finish và nêu rõ bước PC còn lại.",
      "Khi hoàn tất dùng finish. Trường thought chỉ mô tả hành động ngắn, không chứa suy luận nội bộ dài. Không dùng markdown."
    ].join(" ");
    const prompt="ADB UIAutomator clickable controls (ưu tiên center_norm chính xác):\n"+input.uiContext+"\n\nMục tiêu:\n"+input.goal+"\n\nToàn bộ lịch sử hành động đã thực hiện:\n"+history+(loopWarning?"\n\n"+loopWarning:"")+"\n\nĐối chiếu mục tiêu với toàn bộ lịch sử, xác định mục đánh số chưa hoàn thành đầu tiên, rồi quan sát ảnh và đưa ra đúng một hành động tiếp theo.";
    const completion=await client.chat.completions.create({model:settings.model,messages:[{role:"system",content:system},{role:"user",content:[{type:"text",text:prompt},{type:"image_url",image_url:{url:"data:"+(input.imageMediaType||"image/jpeg")+";base64,"+input.imageBase64,detail:"high"}}]}],response_format:{type:"json_schema",json_schema:{name:"agent_action",strict:true,schema}},temperature:.1},{signal:input.signal});
    const message=completion.choices[0]?.message;
    if(!message)throw new Error("Model returned no choice");
    if(message.refusal)throw new Error("Model refused: "+message.refusal);
    return parseAgentAction(message.content||"");
  }
}
export const modelClient=new ModelClient();
