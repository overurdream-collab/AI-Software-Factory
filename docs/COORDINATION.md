# تنسيق تنفيذ AI Software Factory — الإصدار 1

تاريخ الإعداد: 2026-11-25. الحالة: جاهز لبدء تنفيذ A–F؛ ليست شهادة اكتمال المصنع.
المستودع الوحيد المصرح به حالياً: overurdream-collab/AI-Software-Factory.
قواعد AGENTS.md وخارطة docs/ROADMAP.md سارية. لا دمج آلي أو نشر إنتاجي أو استخدام مدفوع.

## 1. أساس العمل وطريقة التسليم

- أساس التنفيذ المثبت: 709bfad545aeb9719fa9e8566ac88417c0dbcd17.
- الفرع الذي يحمل النواة: feat/factory-core؛ PR #1 ما زال مسودة وغير مدموج عند الإعداد.
- يحتوي فرع هذه الوثيقة على النواة والأساس أعلاه. يبدأ كل وكيل من Commit هذه الوثيقة المثبت الذي يبلغه المنسق، لا من main ولا من فرع متحرك.
- لكل وكيل clone أو worktree وفرع مستقل coord-v1/a-provider وb-worker وc-github وd-recovery وe-runtime وf-acceptance.
- طلبات المراجعة تستهدف فرع التنسيق الحامل لهذه الوثيقة؛ المنسق يجمع التغييرات بالتتابع بعد المراجعة، دون دمج تلقائي.
- لا يعدل وكيل ملفات غيره. تغيير واجهة مشتركة يتطلب توثيق الإصدار وموافقة المنسق وتحديث المستهلكين. لا يعاد كتابة تاريخ فروع الآخرين.
- المستودع التجريبي المضيف للإصلاح لم يحدد أو يصرح به بعد. يمكن تجهيز fixture محلي مؤقت واختباره؛ لا تنشأ موارد GitHub في مستودع آخر اعتماداً على إتاحته في الحساب فقط.
- لا يبدأ اعتماد G3/G4 الحي حتى يتوفر نموذج ومضيف تنفيذ ومستودع تجريبي مصرح به. غيابها عائق ظاهر، لا نتيجة اختبار ناجحة.

## 2. الملكية الحصرية

| المسؤول | الملفات التي يملكها | المستهلكون والمخرجات |
| --- | --- | --- |
| المنسق | docs/COORDINATION.md وأي تعديل متفق عليه في package.json و.github/workflows/* | عقود وتكامل وترتيب التسليم؛ لا يستبدل مراجعة F |
| A المحركات | src/ollama.mjs، src/providers/* إن لزم، test/ollama.test.mjs، test/provider-*.test.mjs، docs/G2-EVALUATION.md، scripts/provider-live.mjs | generate لـ B؛ تقييم G2 ودليل استدعاء حي |
| B عامل المشروع | src/patch-adapter.mjs، src/workspace.mjs، src/repository-worker.mjs، test/patch-adapter.test.mjs، test/workspace*.test.mjs، test/repository-worker*.test.mjs | تعديل قابل للتحقق لـ F ثم C؛ يستخدم عزل E |
| C GitHub | src/github-intake.mjs، src/github-delivery.mjs، test/github-*.test.mjs، docs/GITHUB-DELIVERY.md | تحويل المهمة المصرح بها وتسليم واحد قابل للاستعادة |
| D الحالة | src/sqlite-store.mjs، src/leases.mjs، src/review-lease.mjs، src/attempt-store.mjs، test/sqlite-store.test.mjs، test/review-lease.test.mjs، test/review-budget.test.mjs، test/recovery*.test.mjs، test/leases*.test.mjs | حالة دائمة وسجل محاولات وواجهات موارد لـ E وC |
| E التشغيل | src/sandbox.mjs، src/heartbeat.mjs، src/worker-loop.mjs، src/parallel.mjs، src/daemon.mjs، src/reconciler.mjs، test/sandbox.integration.test.mjs، test/heartbeat.test.mjs، test/deadline-budget.test.mjs، test/parallel.test.mjs، test/worker-loop.test.mjs، test/runtime*.test.mjs، scripts/daemon.mjs، docs/OPERATIONS.md | عزل وإلغاء وتنظيف وخدمة مستمرة |
| F القبول | test/acceptance/*، scripts/acceptance.mjs، docs/ACCEPTANCE.md، أدلة تحت docs/evidence/f-* بعد تنقيحها | اختبارات مستقلة وقرار قبول لكل بوابة |

تبقى src/intake.mjs وsrc/scheduler.mjs وsrc/durable-store.mjs والملفات غير المسندة مجمدة؛ يطلب تعديلها من المنسق عند ضرورة موثقة. اختبارات المكون يكتبها مالكه، واختبارات القبول يملكها F. لا يغير المنفذ اختبار القبول كي يمر حله. يستخدم F مسارات جديدة لتجنب تعارض الملفات.

## 3. قواعد البيانات والواجهات المشتركة

هذا عقد مطلوب تنفيذه، وليس وصفاً لواجهات منفذة كلها. الحقول التالية JSON قابلة للحفظ؛ AbortSignal لا يحفظ. OID معرف Git كامل؛ SHA-256 قيمة hex من 64 خانة. جميع الأوقات UTC بالملي ثانية. الأحجام تقاس ببايت UTF-8.

### 3.1 TaskSpec: مدخل موثوق من المشغل

```ts
type TaskSpec = {
  version: 1;
  id: string;
  role: 'dev';
  goal: string;
  deps: string[];
  repository: string;       // owner/name من allowlist المشغل
  baseCommit: string;       // commit مثبت؛ لا branch متحرك
  allowedPaths: string[];   // ملفات نسبية محددة؛ بلا ../ أو .git أو symlinks
  testPlanId: string;       // خطة اختبار يملكها المشغل/F
  limits: {
    maxAttempts: number;
    maxReviewAttempts: number;
    deadlineMs: number;
    maxPatchBytes: number;
  };
};
```

- أول تجربة: مستودع Node صغير، ملف مصدر واحد مسموح، عطل حقيقي واختبارات متعددة؛ لا حاجة لتعميم تعديلات مشاريع كاملة قبل نجاحها.
- testPlanId يحيل إلى أوامر argv ثابتة وcwd نسبي يحددهما المشغل/F، وليس إلى shell نصي ينتجه النموذج أو Issue.
- لا توسع نصوص Issue الصلاحيات أو allowlist أو الميزانية.
- تبقى حقول scheduler الحالية وحالاته متوافقة. لأن enqueue الحالي يسقط الحقول الإضافية، يحفظ D المواصفة في state.specs[taskId].
- يصدّر D enqueueSpec(state, spec): number؛ يتحقق من المواصفة، يستدعي enqueue الحالي ويثبت المواصفة داخل المعاملة نفسها. إعادة المواصفة ذاتها تحفظ التقدم؛ تغيير مواصفة معرف موجود يرفض. C يستخدم هذه الواجهة، ولا يعتمد على حقول يسقطها enqueue.
- لا يحتجز أي استدعاء شبكة أو نموذج أو Docker أو Git قفل SQLite. transact يحتفظ برد نداء متزامن فقط.

### 3.2 A → B: واجهة التوليد المتوافقة

```ts
type Generate = (input: {
  source: string;
  goal: string;
  signal?: AbortSignal;
}) => Promise<string>; // محتوى الملف المعدل كاملاً، لا أوامر ولا مسارات
```

تبقى ollamaGenerator(config) منتجة لهذه الدالة. الحدود الحالية: source+goal حتى 65536 بايت، candidate حتى 65536، response حتى 262144، مهلة إعداد ضمن 1..300000ms. يرفض الناتج الفارغ أو الاستجابة الناقصة/التالفة. يختبر A الإلغاء قبل الطلب وأثناء قراءة الجسم. انتهاء fetch لا يثبت توقف الاستدلال على خادم النموذج؛ يسجل الاختبار الحي هذه الحدود بوضوح.

يختار B الملف من allowedPaths ويستدعي generate على المصدر والهدف؛ لا يعتمد مساراً أو أمراً يرجعه النموذج. أي واجهة أغنى تؤجل حتى توثيق إصدار متوافق. تقييم G2 يشمل OpenHands وSymphony وOpen SWE عند revisions مثبتة؛ تعذر التحقق من مشروع أو ترخيص يسجل غير متحقق ولا يخمن.

### 3.3 B → F → C: Artifact مستقل عن مساحة العمل المؤقتة

```ts
type RepositoryArtifact = {
  version: 2;
  kind: 'repository-patch';
  taskId: string;
  attemptId: string;
  repository: string;
  baseCommit: string;
  patch: string;           // unified diff قابل للتطبيق على baseCommit
  patchSha256: string;     // بصمة بايتات patch بالضبط
  candidateTree: string;   // Git tree OID بعد التطبيق
  changedPaths: string[];
};
```

- تحفظ النواة artifact كـ JSON.stringify(RepositoryArtifact)، بما يناسب submit الحالي ذي artifact النصي.
- يبقى artifact القديم version:1 للتجارب السابقة صالحاً؛ لا يفسره المسار الجديد كتعديل مستودع.
- المستهلك يتحقق من المخطط والبصمة والأساس والمسارات والحجم المسموح؛ يرفض الروابط الرمزية وتعديل .git والخروج من workspace وملفات قبول F.
- يطبق F التعديل على checkout نظيف من baseCommit ويتحقق من candidateTree ويشغل خطة القبول. لا يثق باختبارات أو stdout أرفقهما B.
- يطبق C التعديل المعتمد على الأساس نفسه، ويتحقق من tree قبل إنشاء Commit؛ لا يغير الكود بعد المراجعة. اختلاف metadata للـCommit لا يغير tree.
- بعد إنشاء PR يتحقق F من رأسه وtree ويشغل CI المطلوب على النسخة المحددة؛ تغيير base أو patch أو tree يبطل المراجعة السابقة.
- لا يستخدم مسار tmp محلي كدليل دائم أو كوسيلة التسليم الوحيدة بين وكلاء على أجهزة مختلفة.

### 3.4 نتيجة التحقق والأدلة

تبقى verify(task, signal) → Promise<{passed:boolean, evidence:string}> متوافقة مع tick الحالي. evidence نص JSON يحوي:
version=1، taskId، attemptId، verifierId، repository، baseCommit، patchSha256، candidateTree، testedCommit إن وجد، startedAt، finishedAt، kind (unit/integration/live/acceptance)، commands، tests {passed,failed,skipped}، وlogs [{ref,sha256}].

كل command يسجل argv وcwd وexitCode وstatus (passed/failed/not-run). المراجع يمتلك الاختبارات ومصدر الأدلة؛ الاسم المختلف وحده ليس استقلالاً. عدم توفر النموذج أو Docker أو الاتصال حالة عائق/غير متحقق، وليس فشل إصلاح ولا نجاحاً. لا يكون passed=true إن فشل اختبار مطلوب أو لم يعمل. تحدد خطة F مسبقاً ما هو مطلوب وما هو اختياري.

حالة task=accepted تعني اجتياز التحقق من التعديل؛ لا تعني أن GitHub سلّمه. اكتمال المشروع يحتاج delivery=delivered وقرار F النهائي.

### 3.5 D ↔ E/C: المحاولات والموارد والتسليم

يصدّر D الواجهات المتزامنة التالية للعمل داخل store.transact:
- recordResource(state, resource): void
- listReclaimableResources(state, now): Resource[]
- markResourceCleaned(state, resourceId, now): void
- getDelivery(state, deliveryKey): DeliveryRecord | null
- reserveDelivery(state, deliveryKey, owner, now, ttlMs): DeliveryLease | null
- finishDelivery(state, deliveryKey, token, now, result): void

Resource = {id, taskId, attemptId, leaseToken, owner, kind:'docker', name, createdAt, cleanedAt?}.
DeliveryLease = {key, owner, token, expiresAt}.
DeliveryRecord = {key, state:'pending'|'delivering'|'delivered'|'blocked', repository, branch?, commitSha?, prNumber?, prUrl?, checkedCommit?, checkRunIds?, failure?}، وتضاف حقول الحجز داخلياً بواسطة D.

- attempts تحفظ المالك والرمز والبداية والنهاية والسبب وبصمة artifact؛ لا يكفي الكتابة فوق آخر failure.
- attemptId UUID جديد لكل محاولة تنفيذ، ويضاف إلى نسخة task التي يسلمها tick؛ يظل token حجزاً سرياً داخلياً لا يرسل للنموذج أو Issue أو سجل عام.
- resource يسجل قبل إنشاء Docker باسم فريد؛ labels عامة للمصنع/taskId/attemptId فقط دون leaseToken. يعالج E نافذة الانهيار بين التسجيل والإنشاء.
- listReclaimableResources يعيد الموارد غير المنظفة التي فقدت حجز المحاولة الصالح. لا يحذف E المورد دون فحص حالته الحالية؛ المنظف يقصر الحذف على هوية المصنع والاسم والمحاولة المطابقة.
- finishDelivery يتحقق من token وexpiresAt الحاليين؛ الحجز القديم لا يعتمد نتيجة. يعاد حجز التسليم المنتهي دون نسيان الفرع أو PR المعروف.
- deliveryKey مفتاح ثابت للمستودع ومعرف المهمة، لا attemptId. تعديل هدف مهمة منجزة يتطلب taskId جديداً.
- C يختار فرعاً ثابتاً مشتقاً من المفتاح، ويفحص remote وPR الموجودين قبل إعادة الإنشاء وبعد انقطاع الاستجابة. سجلات الحجز وحدها لا تحقق exactly-once لأثر خارجي؛ تلزم المصالحة مع GitHub.
- تبقى claim/submit/reserveReview/finishReview وواجهات التجارب الحالية متوافقة؛ تغيير مخطط SQLite يستلزم ترحيلاً واختبار إعادة فتح البيانات السابقة.

### 3.6 B/F → E: تشغيل أوامر المشروع

```ts
runProject({
  workspace,               // مساحة أنشأها B وتحقق أنها ضمن الجذر المصرح
  commands,                // Array<{argv:string[], cwd:string}>
  signal,
  limits                   // timeoutMs, memoryMb, cpus, pids, maxOutputBytes
}): Promise<{
  commands: Array<{argv:string[], cwd:string, exitCode:number, stdout:string, stderr:string}>;
  runtime: string;
  imageDigest: string;
}>;
```

يصدّر E createProjectRunner({store,taskId,attemptId,leaseToken,owner,clock,imageDigest}) من src/sandbox.mjs؛ يعيد دالة runProject بالتوقيع أعلاه، مع إبقاء verifyExecutable القديم. كل argv يشغل دون shell وسيط. المورد container مسجل عبر سياق attempt الموثوق الذي يحقنه E؛ لا يأتي من النموذج. تستخدم المراجعة حجز المراجع الحالي عند تسجيل موردها؛ يتحقق D من صلاحية حجز التنفيذ أو المراجعة بحسب المرحلة، ولا يعد انتهاء حجز التنفيذ سبباً لحذف حاوية مراجعة حية. commands وأوامر تثبيت الاعتماديات من خطة موثوقة؛ أول pilot بلا اعتماديات شبكة. تنفيذ candidate بلا شبكة وبلا أسرار أو Docker socket أو credentials، مع checkout اختباري قابل للكتابة داخل العزل وحدود موارد. credentials تبقى عند C خارج sandbox. تثبت صورة التشغيل بالـdigest في دليل التنفيذ. الإلغاء والمهلة ينهيان العمل الفعلي لا عميل Docker وحده.

## 4. المراحل ومعايير القبول

| المرحلة | يبدأ فوراً | القبول المستقل |
| --- | --- | --- |
| P0 العقود | يقرأ الجميع هذه الوثيقة ويبلغ تعارضاً محدداً | لا تعارض ملكية أو توقيع غير محسوم يمنع المرحلة التالية |
| P1 البناء المتوازي | A اتصال/G2؛ B workspace ببديل generate؛ C تسليم بتعديل معروف؛ D حجوزات/سجل؛ E sandbox/daemon؛ F حالات قبول | اختبارات مكونات مع أرقام فعلية؛ البدائل معلّمة ولا تعتمد G3/G4 |
| P2 أول تسليم | A+B+E ثم F ثم C | نموذج حي يصلح bug في fixture مشروع مصرح؛ اختبار يفشل قبل الإصلاح وينجح بعده؛ انحدار ناجح؛ PR وCI للنسخة المحددة |
| P3 التوازي والاستعادة | D+E+B+C تحت تحقق F | عاملان فعليان بتداخل زمني وworkspaces منفصلة؛ SIGKILL أثناء التنفيذ/المراجعة/التسليم؛ استعادة ورفض نتائج قديمة وعدم تكرار PR |
| P4 تشغيل مستضاف | E وF مع إصلاحات المالكين | 24 ساعة بمهام موزعة وأعطال متعمدة وسجل تقدم وموارد وأزمنة استعادة؛ ثم مهمة مشروع مصرح به |

ترتيب G الرسمي محفوظ: لا يعلن اعتماد G2 حتى اكتمال التقييم، ولا G3/G4 قبل دليل حي. يمكن بناء المكونات واختبارها بالتوازي قبل اعتماد البوابة. اجتياز 24 ساعة يثبت هذه التجربة فقط ولا يضمن جميع الأعطال المستقبلية.

## 5. اختبارات يجب ألا تغيب

- A: خدمة غير متاحة، HTTP فاشل، JSON تالف، response/مرشح ضخم، generation ناقص، مهلة وإلغاء أثناء الطلب/الجسم، ودليل حي باسم النموذج وإصداره.
- B/F: اختبار bug أحمر قبل الإصلاح وأخضر بعده، حالات متعددة، رفض patch تالف أو base/tree مختلف أو مسار هارب، ومنع تعطيل اختبارات القبول.
- C/D: انهيار بعد push وبعد إنشاء PR وقبل تثبيت النجاح؛ لا commit خاطئ أو PR مكرر، وفشل الفحوص لا يمنح delivered.
- D: عمليتان مستقلتان تتنافسان، انهيار داخل معاملة، استعادة بعد انقضاء الحجز، رفض token القديم، واستعادة المراجعة دون توليد جديد.
- E/F: حاوية حقيقية ثم SIGKILL للمنسق وإقلاع جديد، تنظيف المهجور مع إبقاء الحي وغير التابع للمصنع؛ إلغاء منفذ يتجاهل الإشارة.
- E/F: اختبار شبكة بضابط يثبت وصول بيئة مسموحة لخدمة فعلية ثم فشل وصول الحاوية المعزولة للخدمة نفسها؛ عنوان غير مستجيب وحده لا يثبت العزل.
- F: مطابقة artifact/tree/PR/CI، وعدم اعتبار stdout=4/9 أو candidate.txt إصلاح مستودع، وعدم اعتبار heartbeat وحده تقدماً.

## 6. تسليم كل وكيل

يرفع كل وكيل تغييره للمراجعة ويبلغ:
1. الفرع، Commit SHA، أساس العمل، والملفات المتغيرة.
2. المخرجات والواجهات وأي حاجة لتعديل عقد.
3. أوامر الاختبار والبيئة وexit codes وأعداد passed/failed/skipped وروابط الأدلة المنقحة.
4. هل الاختبار unit أم وهمي أم integration أم live، وما الذي لم يتحقق.
5. العائق ومحاولة معالجته والخطوة المستقلة المنجزة بدلاً من الانتظار.

أي دورة تنفيذ تنتج تغييراً قابلاً للفحص أو نتيجة اختبار أو عائقاً مثبتاً مع محاولة حل. عدد commits أو مرور الوقت ليس معيار إنجاز. لا صلاحيات جديدة من مستودع أو Issue. تحفظ الأدلة خارج الملفات المؤقتة وبلا أسرار؛ مرجعها قابل للوصول للمراجع وبصمتها قابلة للتحقق.

## 7. حالة الانطلاق

هذه الوثيقة تثبت واجهات العمل وملكيته وتسلسله؛ لا تنفذ الواجهات الجديدة ولا تعتمد G1–G6. PR #1 ما زال مسودة عند القراءة الحالية. نتائج الاختبارات السابقة ليست نتائج اختبار لهذه العقود المستقبلية. جاهزية بدء A–F لا تعني جاهزية نشر المصنع أو اكتمال مهام الوكلاء.
