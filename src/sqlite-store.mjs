import {normalizeDeliveryFailures} from './attempt-store.mjs';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

// SQLite owns process locks and rolls back interrupted transactions.
// Synchronous callbacks only: no external work while holding a write lock.
export class SQLiteStore {
 constructor(path){
  mkdirSync(dirname(path),{recursive:true});
  this.db=new DatabaseSync(path);
  this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS factory_state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);');
  this.db.prepare('INSERT OR IGNORE INTO factory_state VALUES (1, ?)').run(JSON.stringify({version:1,tasks:[]}));
 }
 async transact(fn){
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const state=JSON.parse(this.db.prepare('SELECT payload FROM factory_state WHERE id=1').get().payload);
   if(state.version!==1||!Array.isArray(state.tasks))throw Error('invalid state');
   normalizeDeliveryFailures(state);
   const result=fn(state);
   if(result&&typeof result.then==='function')throw Error('transaction callback must be synchronous');
   this.db.prepare('UPDATE factory_state SET payload=? WHERE id=1').run(JSON.stringify(state));
   this.db.exec('COMMIT');
   return result;
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 close(){this.db.close();}
}
