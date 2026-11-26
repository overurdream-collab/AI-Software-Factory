const endpoint='https://api.deepseek.com/user/balance';
const amount=v=>typeof v==='string'&&/^\d{1,15}(?:\.\d{1,12})?$/.test(v);
export function parseBalance(data){
 if(typeof data?.is_available!=='boolean'||!Array.isArray(data.balance_infos)||data.balance_infos.length>20)throw Error('balance-invalid');
 const balances=data.balance_infos.map(b=>{
  if(!['USD','CNY'].includes(b.currency)||!['total_balance','granted_balance','topped_up_balance'].every(k=>amount(b[k])))throw Error('balance-invalid');
  return {currency:b.currency,total:b.total_balance,granted:b.granted_balance,toppedUp:b.topped_up_balance};
 });
 return {available:data.is_available,balances,checkedAt:Date.now(),generationEnabled:false,state:!data.is_available?'insufficient-balance':balances.some(b=>Number(b.granted)>0)?'grant-present-not-authorized':'no-confirmed-grant'};
}
export async function getDeepSeekBalance({key=process.env.DEEPSEEK_API_KEY,fetchImpl=fetch}={}){
 if(!key)return {state:'key-missing',generationEnabled:false,balances:[]};
 const response=await fetchImpl(endpoint,{headers:{Authorization:'Bearer '+key,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('balance-http-'+response.status);
 const raw=await response.text();
 if(Buffer.byteLength(raw)>65536)throw Error('balance-invalid');
 return parseBalance(JSON.parse(raw));
}
// Deliberately no completion endpoint: balance inspection cannot guarantee exclusive
// grant consumption, reserve funds atomically or enforce a provider-side spend cap.
