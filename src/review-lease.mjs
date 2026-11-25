import {startAttempt,endAttempt} from './attempt-store.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {review} from './leases.mjs';
export function reserveReview(state,role,reviewer,now,ttl,id,maxReviewAttempts=3){
 if(!Number.isSafeInteger(maxReviewAttempts)||maxReviewAttempts<1||!reviewer||!Number.isSafeInteger(now)||!Number.isSafeInteger(ttl)||ttl<1||!Number.isSafeInteger(now+ttl))throw Error('invalid reservation');
 const limit=t=>t.reviewLimit??(Object.hasOwn(state.specs??{},t.id)?state.specs[t.id].limits.maxReviewAttempts:maxReviewAttempts);
 for(const t of state.tasks){
  if(t.state==='review'&&t.reviewToken&&t.reviewExpiresAt<=now){endAttempt(state,t.reviewToken,now,'expired',{reason:'review-lease-expired'});clearReview(t);}
  if(t.state==='review'&&(!t.reviewToken||t.reviewExpiresAt<=now)&&(t.reviewAttempts??0)>=limit(t)){
   t.state='blocked';t.failure='review-budget-exhausted';clearReview(t);
  }
 }
 const t=state.tasks.find(t=>t.role===role&&t.state==='review'&&t.worker!==reviewer&&(!id||t.id===id)&&(!t.reviewToken||t.reviewExpiresAt<=now));
 if(!t)return null;
 Object.assign(t,{reviewLimit:limit(t),reviewAttempts:(t.reviewAttempts??0)+1,reviewToken:randomUUID(),reviewOwner:reviewer,reviewExpiresAt:now+ttl});
 startAttempt(state,t,'review',reviewer,t.reviewToken,now);
 return structuredClone(t);
}
export function finishReview(state,id,token,now,passed,evidence,maxAttempts){
 const t=state.tasks.find(t=>t.id===id);
 if(!t||!token||t.reviewToken!==token||!Number.isSafeInteger(now)||t.reviewExpiresAt<=now)throw Error('stale review');
 review(state,id,t.reviewOwner,passed,evidence,maxAttempts);
 endAttempt(state,token,now,passed?'passed':'failed',{evidence,artifactSha256:createHash('sha256').update(t.artifact??'').digest('hex'),...(passed?{}:{reason:'verification-failed'})});
 clearReview(t);
 return t.state;
}
function clearReview(t){delete t.reviewToken;delete t.reviewOwner;delete t.reviewExpiresAt;}
export function failReview(state,id,token,now){
 const t=state.tasks.find(t=>t.id===id);
 if(!t||t.state!=='review'||!token||t.reviewToken!==token||!Number.isSafeInteger(now)||t.reviewExpiresAt<=now)return false;
 endAttempt(state,token,now,'failed',{reason:'review-error'});
 clearReview(t);
 if(t.reviewAttempts>=t.reviewLimit){t.state='blocked';t.failure='review-budget-exhausted';}
 return true;
}
export function releaseReview(state,id,token){
 const t=state.tasks.find(t=>t.id===id);
 if(t?.reviewToken===token&&token){endAttempt(state,token,Date.now(),'released',{reason:'review-released'});delete t.reviewToken;delete t.reviewOwner;delete t.reviewExpiresAt;}
}
