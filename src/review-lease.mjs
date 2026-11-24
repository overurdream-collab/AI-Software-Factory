import {randomUUID} from 'node:crypto';
import {review} from './leases.mjs';
export function reserveReview(state,role,reviewer,now,ttl,id,maxReviewAttempts=3){
 if(!Number.isSafeInteger(maxReviewAttempts)||maxReviewAttempts<1||!reviewer||!Number.isSafeInteger(now)||!Number.isSafeInteger(ttl)||ttl<1||!Number.isSafeInteger(now+ttl))throw Error('invalid reservation');
 for(const t of state.tasks){
  if(t.state==='review'&&(!t.reviewToken||t.reviewExpiresAt<=now)&&(t.reviewAttempts??0)>=(t.reviewLimit??maxReviewAttempts)){
   t.state='blocked';t.failure='review-budget-exhausted';clearReview(t);
  }
 }
 const t=state.tasks.find(t=>t.role===role&&t.state==='review'&&t.worker!==reviewer&&(!id||t.id===id)&&(!t.reviewToken||t.reviewExpiresAt<=now));
 if(!t)return null;
 Object.assign(t,{reviewLimit:t.reviewLimit??maxReviewAttempts,reviewAttempts:(t.reviewAttempts??0)+1,reviewToken:randomUUID(),reviewOwner:reviewer,reviewExpiresAt:now+ttl});
 return structuredClone(t);
}
export function finishReview(state,id,token,now,passed,evidence,maxAttempts){
 const t=state.tasks.find(t=>t.id===id);
 if(!t||!token||t.reviewToken!==token||!Number.isSafeInteger(now)||t.reviewExpiresAt<=now)throw Error('stale review');
 review(state,id,t.reviewOwner,passed,evidence,maxAttempts);
 clearReview(t);
 return t.state;
}
function clearReview(t){delete t.reviewToken;delete t.reviewOwner;delete t.reviewExpiresAt;}
export function failReview(state,id,token,now){
 const t=state.tasks.find(t=>t.id===id);
 if(!t||t.state!=='review'||!token||t.reviewToken!==token||!Number.isSafeInteger(now)||t.reviewExpiresAt<=now)return false;
 clearReview(t);
 if(t.reviewAttempts>=t.reviewLimit){t.state='blocked';t.failure='review-budget-exhausted';}
 return true;
}
export function releaseReview(state,id,token){
 const t=state.tasks.find(t=>t.id===id);
 if(t?.reviewToken===token&&token){delete t.reviewToken;delete t.reviewOwner;delete t.reviewExpiresAt;}
}
