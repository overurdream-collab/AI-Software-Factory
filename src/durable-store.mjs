import {open, readFile, rename, unlink, mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

// Single-host transactional store. Exclusive lock fails closed; never steal a live lock.
// After a hard crash an operator must verify the old process is dead before removing its lock.
export class DurableStore {
  constructor(path) { this.path=path; }
  async transact(fn) {
    await mkdir(dirname(this.path),{recursive:true});
    const lock=this.path+'.lock';
    const handle=await open(lock,'wx',0o600);
    const temp=this.path+'.'+randomUUID()+'.tmp';
    try {
      let state;
      try {state=JSON.parse(await readFile(this.path,'utf8'));}
      catch(e){if(e.code!=='ENOENT')throw e; state={version:1,tasks:[]};}
      if(state.version!==1 || !Array.isArray(state.tasks))throw Error('invalid state');
      const result=await fn(state);
      const out=await open(temp,'wx',0o600);
      try {await out.writeFile(JSON.stringify(state));await out.sync();} finally {await out.close();}
      await rename(temp,this.path);
      return result;
    } finally {
      try {await unlink(temp);} catch(e){if(e.code!=='ENOENT')throw e;}
      await handle.close();
      await unlink(lock);
    }
  }
}
