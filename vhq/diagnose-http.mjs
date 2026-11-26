import {runHttpPilot} from './opencode-http.mjs';
try{
 const evidence=await runHttpPilot({onStage:stage=>console.log('VHQ HTTP:',stage)});
 console.log(JSON.stringify(evidence,null,2));
}catch(e){console.error('VHQ HTTP failure:',/^(http-[a-z0-9-]+|unexpected tool use|candidate outside allowed grammar|acceptance failed)$/.test(e.message)?e.message:e.name);process.exitCode=1;}
