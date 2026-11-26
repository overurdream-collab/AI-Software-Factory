import {createHash} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
// Transcript confirmation is a UI safeguard, not identity proof. Server must supply confirmation.
export function prepareInteraction({channel,text,confirmedDigest}={}){
  if(!['voice','text'].includes(channel)||typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>8192)return {state:'invalid'};
  const digest=hash(text);
  if(channel==='voice'&&confirmedDigest!==digest)return {state:'awaiting-confirmation',text,digest};
  return {state:'confirmed-input',text,digest,channel};
}
