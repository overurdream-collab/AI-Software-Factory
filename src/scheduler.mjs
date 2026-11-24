export class Scheduler {
  constructor(tasks, maxAttempts = 3) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw Error('invalid retry limit');
    this.maxAttempts = maxAttempts;
    this.tasks = new Map();
    for (const t of tasks) {
      if (!t.id || this.tasks.has(t.id) || !t.role || !t.goal) throw Error('invalid task');
      this.tasks.set(t.id, {id:t.id, role:t.role, goal:t.goal, deps:[...(t.deps ?? [])], state:'queued', attempts:0});
    }
    const visit = (id, path = new Set()) => {
      if (!this.tasks.has(id) || path.has(id)) throw Error('missing dependency or cycle');
      const next = new Set(path).add(id);
      for (const dep of this.tasks.get(id).deps) visit(dep,next);
    };
    for (const id of this.tasks.keys()) visit(id);
  }
  claim(role, worker) {
    if (!worker) throw Error('worker required');
    const t = [...this.tasks.values()].find(t => t.role === role && t.state === 'queued' && t.deps.every(d => this.tasks.get(d).state === 'accepted'));
    if (!t) return null;
    t.state='running'; t.worker=worker; t.attempts++;
    return structuredClone(t);
  }
  submit(id, worker, artifact) {
    const t=this.tasks.get(id);
    if (!t || t.state !== 'running' || t.worker !== worker || typeof artifact !== 'string' || !artifact.trim()) throw Error('invalid submission');
    t.artifact=artifact; t.state='review';
  }
  review(id, reviewer, verdict, evidence) {
    const t=this.tasks.get(id);
    if (!t || t.state !== 'review' || !reviewer || reviewer === t.worker || typeof verdict !== 'boolean' || typeof evidence !== 'string' || !evidence.trim()) throw Error('independent evidence required');
    t.reviewer=reviewer; t.evidence=evidence;
    t.state=verdict?'accepted':t.attempts>=this.maxAttempts?'blocked':'queued';
  }
  snapshot() { return structuredClone([...this.tasks.values()]); }
}
