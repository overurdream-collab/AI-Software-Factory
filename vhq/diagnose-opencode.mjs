import {spawn} from 'node:child_process';
import {invokeFreePilot,runPilot} from './opencode-pilot.mjs';
const args=['-d','Ubuntu-24.04','-e','bash','-ic','command -v opencode && opencode --version'];
const p=spawn('wsl.exe',args,{shell:false,stdio:['ignore','pipe','pipe']});
const timer=setTimeout(()=>p.kill(),15000);
p.stdout.on('data',b=>process.stdout.write(b));
p.stderr.on('data',b=>process.stderr.write(b));
const code=await new Promise((resolve,reject)=>{p.once('error',reject);p.once('close',resolve);}).finally(()=>clearTimeout(timer));
console.log('WSL probe exit:',code);
if(code!==0)process.exitCode=1;
else if(process.argv.includes('--live')){
 try{
 const result=await runPilot(()=>invokeFreePilot({onProgress:({elapsedMs,receivedBytes})=>console.log('elapsedMs='+elapsedMs+' receivedBytes='+receivedBytes)}));
 console.log(JSON.stringify(result));
 }catch(e){console.error('Pilot diagnostic:',e.message);process.exitCode=1;}
}
