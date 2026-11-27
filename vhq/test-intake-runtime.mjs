import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PostgresStore} from './postgres-store.mjs';
import {createTaskIntake} from './task-intake.mjs';
import {createPostgresRuntime} from './postgres-runtime.mjs';
export async function openTestIntake({env=process.env,expiresAt}){
 if(env.PGHOST!=='127.0.0.1'||env.PGPORT!=='55432'||env.PGUSER!=='factory_app'||env.PGDATABASE!=='factory_test_db'||!env.PGPASSWORD)throw Error('isolated PostgreSQL configuration required');
 const dir=mkdtempSync(join(tmpdir(),'vhq-d-intake-'));
 let pool;
 try{
  for(const [file,sha] of Object.entries({'intake.mjs':'9239a6bc4f562b38ae2c2500859b70ed5fd7140b','attempt-store.mjs':'79a73b72e954378cc9edf978f8b035499962ff49'})){
   const bytes=execFileSync('git',['cat-file','blob',sha],{maxBuffer:1048576});
   if(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')!==sha)throw Error('D blob mismatch');
   writeFileSync(join(dir,file),bytes);
  }
  const {enqueueSpec,normalizeDeliveryFailures}=await import(pathToFileURL(join(dir,'attempt-store.mjs')).href);
  const {Pool}=await import('pg');pool=new Pool({host:'127.0.0.1',port:55432,user:'factory_app',password:env.PGPASSWORD,database:'factory_test_db',ssl:false,max:2,connectionTimeoutMillis:3000,statement_timeout:12000});
  const {rows}=await pool.query('SELECT current_database() AS db');if(rows[0]?.db!=='factory_test_db')throw Error('wrong database');
  const store=new PostgresStore({pool,normalizeState:normalizeDeliveryFailures});
  const policy={repository:'fixture/local',baseCommit:'a'.repeat(40),allowedPaths:['fixture.mjs'],testPlanId:'synthetic',expiresAt,limits:{maxAttempts:3,maxReviewAttempts:2,deadlineMs:60000,maxPatchBytes:4096}};
  const intake=createTaskIntake({store,enqueueSpec,policy});
  const runtime=createPostgresRuntime({pool});
  return {submit:({id,goal})=>intake({id,goal,repository:policy.repository,baseCommit:policy.baseCommit,allowedPaths:policy.allowedPaths,testPlanId:policy.testPlanId}),read:async()=>({...await runtime.read(),database:'factory_test_db',testOnly:true}),close:()=>store.close()};
 }catch(e){await pool?.end();throw e;}finally{rmSync(dir,{recursive:true,force:true});}
}
