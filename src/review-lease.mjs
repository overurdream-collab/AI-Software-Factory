import {randomUUID} from 'node:crypto';
import {review} from './leases.mjs';
export function reserveReview(state,role,reviewer,now,ttl,id){
 if(!reviewer||!Number.isSafeInteger(now)||!Number.isSafeInteger(ttl)||ttl<1||!Number.isSafeInteger(now+ttl))throw Error('invalid reservation');
 const t=state.tasks.find(t=>t.role===role&&t.state==='review'&&t.worker!==reviewer&&(!id||t.id===id)&&(!t.reviewToken||t.reviewExpiresAt<=now));
 if(!t)return null;
 Object.assign(t,{reviewToken:randomUUID(),reviewOwner:reviewer,reviewExpiresAt:now+ttl});
 return structuredClone(t);
}
export function finishReview(state,id,token,now,passed,evidence,maxAttempts){
 const t=state.tasks.find(t=>t.id===id);
 if(!t||!token||t.reviewToken!==token||!Number.isSafeInteger(now)||t.reviewExpiresAt<=now)throw Error('stale review');
 review(state,id,t.reviewOwner,passed,evidence,maxAttempts);
 delete t.reviewToken;delete t.reviewOwner;delete t.reviewExpiresAt;
 return t.state;
}
export function releaseReview(state,id,token){
 const t=state.tasks.find(t=>t.id===id);
 if(t?.reviewToken===token&&token){delete t.reviewToken;delete t.reviewOwner;delete t.reviewExpiresAt;}
}
