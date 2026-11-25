import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile,rename} from 'node:fs/promises';
import {runDaemon} from '../src/daemon.mjs';
import {createReconciler} from '../src/reconciler.mjs';

// Operator-owned config, outside any candidate checkout.
const configPath=process.env.FACTORY_RUNTIME_CONFIG;
const progressPath=process.env.FACTORY_PROGRESS_PATH;
if(!configPath||!progressPath)throw Error('trusted runtime config and progress path required');
const config=await import(pathToFileURL(resolve(configPath)).href);
if(typeof config.createRuntime!=='function')throw Error('createRuntime export required');
const controller=new AbortController();
const stop=()=>controller.abort(Error('service shutdown'));
process.once('SIGTERM',stop);process.once('SIGINT',stop);
const runtime=await config.createRuntime({signal:controller.signal});
const progress=resolve(progressPath);
await mkdir(dirname(progress),{recursive:true,mode:0o700});
const record=async data=>{
 const temporary=progress+'.'+process.pid+'.tmp';
 await writeFile(temporary,JSON.stringify({version:1,pid:process.pid,...data})+'\n',{mode:0o600});
 await rename(temporary,progress);
};
try{
 await record({state:'starting',at:Date.now()});
 const result=await runDaemon({...runtime,signal:controller.signal,reconcile:createReconciler({store:runtime.store,resourceApi:runtime.resourceApi}),onProgress:async data=>{
  await record({state:'running',...data});
 }});
 await record({state:'stopped',at:Date.now(),rounds:result.rounds});
}finally{
 await runtime.close?.();
 process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);
}
