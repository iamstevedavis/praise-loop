import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
export async function webFixture<T>(run:(base:string)=>Promise<T>,port?:number) {
  port ??= await new Promise<number>((resolve,reject)=>{
    const socket=createServer();socket.on("error",reject);
    socket.listen(0,"127.0.0.1",()=>{const address=socket.address();if(!address||typeof address==="string"){socket.close();reject(new Error("No fixture port"));return;}socket.close(error=>error?reject(error):resolve(address.port));});
  });
  const base=`http://localhost:${port}`;
  const server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-p",String(port)],{env:{...process.env,NEXTAUTH_URL:base,NEXTAUTH_SECRET:"synthetic-local-test-secret-not-live",GOOGLE_CLIENT_ID:"synthetic",GOOGLE_CLIENT_SECRET:"synthetic"},stdio:"ignore"});
  try {
    let ready=false;
    for(let i=0;i<100;i++){if(server.exitCode!==null)throw new Error("Production web fixture exited before readiness");try{if((await fetch(base)).ok){ready=true;break;}}catch{}await setTimeout(100);}
    if(!ready)throw new Error("Production web fixture did not start; run npm run build first");
    return await run(base);
  }finally{if(server.exitCode===null){server.kill("SIGTERM");await new Promise<void>(resolve=>server.once("exit",()=>resolve()));}}
}
