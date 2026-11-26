const repo='overurdream-collab/AI-Software-Factory';
const agents=['A','B','C','D','E','F'];
export async function readAgentActivity({token=process.env.VHQ_GITHUB_READ_TOKEN,fetchImpl=fetch,clock=Date.now}={}){
 const checkedAt=clock();
 const rows=await Promise.all(agents.map(async(agent,index)=>{
  const issue=11+index,url='https://github.com/'+repo+'/issues/'+issue;
  const base={agent,issue,url,runtimeState:'unknown'};
  try{
   const res=await fetchImpl('https://api.github.com/repos/'+repo+'/issues/'+issue,{headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(token?{Authorization:'Bearer '+token}:{})},redirect:'error',signal:AbortSignal.timeout(10000)});
   if(!res.ok)return {...base,state:'unavailable',reason:'http-'+res.status};
   const body=await res.text();if(Buffer.byteLength(body)>1048576)throw Error('invalid');
   const d=JSON.parse(body);
   if(d.number!==issue||!['open','closed'].includes(d.state)||typeof d.title!=='string'||!Number.isFinite(Date.parse(d.updated_at)))throw Error('invalid');
   return {...base,state:d.state,title:d.title,updatedAt:d.updated_at,comments:Number.isSafeInteger(d.comments)?d.comments:null};
  }catch{return {...base,state:'unavailable',reason:'read-failed'};}
 }));
 return {source:'github-coordination-issues',checkedAt,agents:rows};
}
