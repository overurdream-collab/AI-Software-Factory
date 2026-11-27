// Candidate adapter for D review. Not enabled by the factory or dashboard.
const LOCK="SELECT CASE WHEN octet_length(payload::text)<=8388608 THEN payload ELSE NULL END AS payload FROM factory.factory_state WHERE id=1 FOR UPDATE";
function valid(state){if(state?.version!==1||!Array.isArray(state.tasks))throw Error('invalid state');}
export class PostgresStore {
 constructor({pool,normalizeState}){
  if(!pool||typeof pool.connect!=='function'||typeof pool.end!=='function'||typeof normalizeState!=='function')throw Error('pool and coordinated normalizer required');
  this.pool=pool;this.normalizeState=normalizeState;this.closed=false;
 }
 async transact(fn){
  if(this.closed||typeof fn!=='function'||fn.constructor?.name==='AsyncFunction')throw Error('synchronous transaction callback required');
  const client=await this.pool.connect();let begun=false,committing=false,discard=false;
  try{
   await client.query('BEGIN');begun=true;
   await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'; SET LOCAL idle_in_transaction_session_timeout='15s'");
   const q=await client.query(LOCK);
   if(q.rows?.length!==1)throw Error('missing state');
   const state=q.rows[0].payload;valid(state);this.normalizeState(state);
   const result=fn(state);
   if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw Error('transaction callback must be synchronous');}
   valid(state);
   const payload=JSON.stringify(state);if(Buffer.byteLength(payload)>8388608)throw Error('state too large');
   const update=await client.query('UPDATE factory.factory_state SET payload=$1::jsonb, revision=revision+1, updated_at=clock_timestamp() WHERE id=1',[payload]);
   if(update.rowCount!==1)throw Error('missing state update');
   committing=true;await client.query('COMMIT');begun=false;return result;
  }catch(e){
   if(begun){try{await client.query('ROLLBACK');}catch{discard=true;}}
   if(committing){discard=true;throw Error('commit outcome uncertain; reconcile before retry');}
   throw e;
  }finally{client.release(discard);}
 }
 async close(){if(!this.closed){this.closed=true;await this.pool.end();}}
}
