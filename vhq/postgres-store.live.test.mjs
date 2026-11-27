import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PostgresStore} from './postgres-store.mjs';
test('live isolated PostgreSQL transactions, rollback and contention',{skip:process.env.VHQ_TEST_POSTGRES_WRITE!=='1'},async()=>{
 const e=process.env;
 assert.equal(e.PGHOST,'127.0.0.1');assert.equal(e.PGPORT,'55432');assert.equal(e.PGUSER,'factory_app');assert.equal(e.PGDATABASE,'factory_test_db');assert.ok(e.PGPASSWORD,'password required');
 const {Pool}=await import('pg');
 const pool=new Pool({host:e.PGHOST,port:55432,user:e.PGUSER,password:e.PGPASSWORD,database:'factory_test_db',ssl:false,max:4,connectionTimeoutMillis:3000,statement_timeout:12000});
 const store=new PostgresStore({pool,normalizeState:()=>{}});
 const snapshot=async()=>{const r=await pool.query("SELECT current_database() AS db, payload, revision::text AS revision FROM factory.factory_state WHERE id=1");assert.equal(r.rows[0]?.db,'factory_test_db');return r.rows[0];};
 try{
  const before=await snapshot();assert.equal(before.payload.version,1);assert.deepEqual(before.payload.tasks,[]);
  const n=BigInt(before.revision);
  await assert.rejects(store.transact(s=>{s.testCounter=999;throw Error('intentional rollback');}),/intentional rollback/);
  assert.deepEqual(await snapshot(),before);
  await assert.rejects(store.transact(s=>{s.testCounter=999;return Promise.resolve();}),/synchronous/);
  assert.deepEqual(await snapshot(),before);
  await Promise.all(Array.from({length:8},()=>store.transact(s=>{s.testCounter=(s.testCounter??0)+1;})));
  const after=await snapshot();assert.equal(BigInt(after.revision),n+8n);assert.equal(after.payload.testCounter,(before.payload.testCounter??0)+8);
  await store.transact(s=>{delete s.testCounter;});
  const final=await snapshot();assert.equal(BigInt(final.revision),n+9n);assert.deepEqual(final.payload.tasks,[]);assert.equal(final.payload.testCounter,undefined);
  console.log('Isolated PostgreSQL:',final.db,'eight concurrent commits, rollback and async rejection verified; revision',final.revision);
 }finally{await store.close();}
});
