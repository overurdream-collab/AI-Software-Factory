// Renewal is fenced by the original token and owner. Expired leases cannot revive.
export function renew(state,{id,token,owner,now,ttl,review=false}){
 if(!token||!owner||!Number.isSafeInteger(now)||!Number.isSafeInteger(ttl)||ttl<1||!Number.isSafeInteger(now+ttl))throw Error('invalid heartbeat');
 const t=state.tasks.find(t=>t.id===id);
 const [status,key,who,expiry]=review?['review','reviewToken','reviewOwner','reviewExpiresAt']:['running','token','worker','expiresAt'];
 if(!t||t.state!==status||t[key]!==token||t[who]!==owner||t[expiry]<=now)throw Error('stale heartbeat');
 t[expiry]=Math.max(t[expiry],now+ttl);
 return t[expiry];
}
export async function withHeartbeat({store,task,owner,clock,ttl,review=false,operation}){
 const controller=new AbortController();
 let pending=Promise.resolve(),failure,stopped=false;
 const beat=()=>{
  if(stopped)return;
  pending=pending.then(async()=>{
   if(stopped||failure)return;
   try{await store.transact(s=>renew(s,{id:task.id,token:review?task.reviewToken:task.token,owner,now:clock(),ttl,review}));}
   catch(e){failure=e;controller.abort(e);}
  });
 };
 const timer=setInterval(beat,Math.max(1,Math.floor(ttl/3)));
 try{
  const result=await operation(Object.freeze(task),controller.signal);
  stopped=true;clearInterval(timer);await pending;
  if(failure)throw failure;
  return result;
 }finally{stopped=true;clearInterval(timer);await pending;}
}
