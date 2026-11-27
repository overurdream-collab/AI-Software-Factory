import {projectRuntime} from './runtime-monitor.mjs';
const QUERY = "SELECT CASE WHEN octet_length(payload::text) <= 8388608 THEN payload ELSE NULL END AS payload, revision::text AS revision FROM factory.factory_state WHERE id = 1";
export function createPostgresRuntime({pool,clock=Date.now}){
 if(!pool||typeof pool.query!=='function'||typeof pool.end!=='function')throw Error('pool required');
 let closed=false;
 return {
  async read(){
   try{
    if(closed)throw Error('closed');
    const result=await pool.query(QUERY);
    const row=result.rows?.[0];
    if(result.rows?.length!==1||!row?.payload||typeof row.revision!=='string'||!/^\d+$/.test(row.revision))throw Error('invalid snapshot');
    return {...projectRuntime(row.payload,clock()),source:'postgresql:factory.factory_state',revision:row.revision};
   }catch{return {state:'unavailable',source:'postgresql:factory.factory_state',checkedAt:clock()};}
  },
  async close(){if(!closed){closed=true;await pool.end();}}
 };
}
export async function openPostgresRuntime({env=process.env,clock=Date.now}={}){
 // Local database only; no ambient PG service, connection string or admin account.
 if(env.PGHOST!=='127.0.0.1'||env.PGPORT!=='55432'||env.PGDATABASE!=='factory_db'||env.PGUSER!=='factory_app'||!env.PGPASSWORD)throw Error('PostgreSQL local application configuration required');
 const {Pool}=await import('pg');
 const pool=new Pool({host:'127.0.0.1',port:55432,database:'factory_db',user:'factory_app',password:env.PGPASSWORD,ssl:false,max:2,connectionTimeoutMillis:3000,statement_timeout:3000,query_timeout:4000,idleTimeoutMillis:10000,options:'-c default_transaction_read_only=on',application_name:'vhq-runtime-reader'});
 pool.on('error',()=>{/* no credentials or raw driver errors in logs */});
 return createPostgresRuntime({pool,clock});
}
