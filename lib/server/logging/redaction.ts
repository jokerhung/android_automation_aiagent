const secretPatterns=[/sk-[A-Za-z0-9_-]{10,}/g,/data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+/gi,/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,/\b(?:password|passwd|smtp[_-]?password|api[_-]?key|token)\s*[:=]\s*[^\s,;]+/gi];
export function redact(value:string){return secretPatterns.reduce((text,pattern)=>text.replace(pattern,"[REDACTED]"),value)}
export function redactActionText(value:unknown){if(!value||typeof value!=="object")return value;const action={...(value as Record<string,unknown>)};if(action.action==="text"||action.text!==null&&action.text!==undefined)action.text="[REDACTED INPUT]";return action}
export function safeError(error:unknown){return redact(error instanceof Error?error.message:String(error))}
