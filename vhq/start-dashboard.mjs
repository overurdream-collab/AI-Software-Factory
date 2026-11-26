import {runHttpPilot} from './opencode-http.mjs';
import {openRegistry} from './registry.mjs';
import {createDashboard} from './dashboard-server.mjs';
import {randomBytes} from 'node:crypto';
const token=randomBytes(32).toString('hex');
const registry=openRegistry(process.env.VHQ_DB||'vhq-local.sqlite');
const server=createDashboard({registry,repository:'overurdream-collab/AI-Software-Factory',token,pilotRunner:()=>runHttpPilot({onStage:stage=>console.log('VHQ HTTP:',stage)}),pilotEnabled:process.env.VHQ_ENABLE_FREE_PILOT==='1'&&!!process.env.VHQ_OPENCODE_PASSWORD,expiresAt:Date.now()+3600000});
server.listen(8787,'127.0.0.1',()=>{console.log('Open http://127.0.0.1:8787');console.log('Local operator token (expires in 1 hour; do not share): '+token);});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>registry.close()));
