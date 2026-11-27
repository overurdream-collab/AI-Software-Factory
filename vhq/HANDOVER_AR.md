# VHQ — سجل التسليم والاستئناف / 2026-11-27
حالة الوثيقة: نقطة توقف قبل كتابة موصل PostgreSQL. هذا سجل هندسي وليس اعتماداً إنتاجياً.
## 1. الهدف والقرار الملزم
إنجاز دورة واحدة حقيقية: تكليف من VHQ → حفظ → إسناد → توليد مصرح → إصلاح مستودع تجريبي → اختبارات مستقلة → PR وCI → أدلة في VHQ. لا توسع قبل اكتمالها. أوقف تطوير الواجهات والمحركات والاجتماعات والأقسام الجديدة مؤقتاً. الميزانية الإضافية صفر؛ لا استضافة مدفوعة، لا دمج آلي، لا تغيير مشاريع أخرى. اختيار المالك: PostgreSQL محلي داخل Docker بدلاً من Neon حتى إثبات الدورة. إغلاق الجهاز يوقف الخدمة؛ ليست استضافة 24/7.
## 2. المراجع والملكية
- Repo: overurdream-collab/AI-Software-Factory.
- VHQ branch: feat/vhq-enterprise-ui؛ آخر رأس محلي مؤكد قبل التوثيق b5225514e312f496746bc98f0abf7c8f35da058c؛ مسار Windows F:\AI-VHQ.
- فرع الأساس feat/vhq-foundation، PR #18 مسودة عند آخر معرفة؛ لم يُعد التحقق من حالة PR اليوم.
- المصنع: coord/parallel-execution-v1، عقد docs/COORDINATION.md، الأساس المثبت للتنسيق 47d5f98f46bcb82ac612266efcb336f672ddb956. الوكلاء A المحركات، B عامل المستودع، C GitHub، D الحالة والحجوزات، E التشغيل والعزل، F القبول المستقل. لا تعدل ملفاتهم من فرع VHQ. DeepSeek مشغول بمهمة أخرى حسب المالك. فرع central لم يظهر في البحث السابق؛ لا يعتبر ذلك دليلاً على عدم وجود عمل محلي.
- راجع [README](README.md) وملفات المصنع الفعلية عند التكامل؛ لا تستنتج أن فرع VHQ يتضمن أحدث نواة المصنع.
## 3. بيئة العمل
Windows 11، PowerShell، Node.js 24.18.1 بحسب سجل سابق، RAM 8 GB وIntel GPU مدمج. Docker Desktop موجود. npm.ps1 محجوب بسياسة التنفيذ؛ استخدم npm.cmd دون تغيير السياسة. PostgreSQL images موجودة مسبقاً: 16، 16-alpine، 17، 17-alpine وpgvector:pg16. لا تحميل جديد. توجد قواعد مقوتي وChatwoot وغيرها؛ لا توقفها ولا تمس بياناتها. منفذ 55433 محجوز لحاوية MCIAS المتوقفة، واختير 55432 بعد فحص Docker وWindows.
## 4. سجل الواجهة والوظائف
- 3307573: هوية RTL داكنة؛ HTML/CSS/JS، ليست React ولا 3D.
- e392198: قراءة نشاط قضايا A–F (#11–16) من GitHub؛ حالة القضية ليست heartbeat.
- e3c0471: مراقبة SQLite للقراءة فقط عبر VHQ_FACTORY_DB، إسقاط الحقول الحساسة، 10 ثوان تحديث.
- b92a2e0 / 13ee0cc / 4642ddc: سبعة مزودين بصف واحد لكل مزود (اسم، حالة، قائمة النموذج، زر فحص). Codex غير مربوط؛ Gemini/Groq/Cerebras كتالوج فقط؛ DeepSeek رصيد فقط؛ اختبارات OpenRouter/OpenCode مشروطة.
- 812c757 / 5a9c70d / f9cd20d: نهاري/ليلي وحفظ التفضيل، ساعة صنعاء، مكاتب أولية، مؤشرات من البيانات.
- 3d73f82 / d313924 / b522551: استبدال البطاقات بمشهد SVG متصل، ست شخصيات، حوار بالنقر، استدعاء اجتماع بصري وعودة، نشاط ومؤشرات، نقل مسودة تكليف إلى مكتب الرئيس التنفيذي. لا اجتماع حي، لا محادثة حقيقية مع عامل، لا إثبات لمطابقة الصور أو اختبار المتصفح. فحص صياغة JS ومعرفات DOM نجح؛ ليس اختبار قبول وظيفي.
- المطلوب بصرياً لاحقاً: مطابقة التصميمين النهاري والليلي المعتمدين، مقر واحد ثلاثي الأبعاد، حركة حقيقية مستندة إلى أحداث، اجتماعات وتفاعل مباشر، لوحة مؤشرات كاملة. مجمد حتى نجاح الدورة الأولى.
## 5. المحركات وضوابطها
Codex CLI 0.156.1 كان متصلاً بحساب ChatGPT وبلغ حد الاستخدام (رسالة إعادة المحاولة 28 نوفمبر 2026 10:33 PM، timezone غير مثبت). OpenCode 1.19.5 في WSL Ubuntu-24.04، خادم محلي 4096، Basic Auth، VHQ_OPENCODE_PASSWORD وVHQ_ENABLE_FREE_PILOT=1. نجحت استجابة مجانية سابقة حسب سجل المشغل ثم بلغ رصيد مجاني حده؛ لا ضمان للحصة الحالية. OpenRouter: OPENROUTER_API_KEY، كتالوج 11 نموذجاً مجانياً سابقاً؛ فلترة :free وتسعير صفر، اختبار جمع اصطناعي واحد وموافقة صريحة وعدم fallback مدفوع؛ لا دليل تنفيذ حي نهائي. DeepSeek: DEEPSEEK_API_KEY، رصيد سابق صفر، GET balance فقط. Gemini/Groq/Cerebras: GEMINI_API_KEY/GROQ_API_KEY/CEREBRAS_API_KEY؛ لا توليد قبل إثبات أهلية وسقف تكلفة. لا مفاتيح في الوثائق أو Git أو prompts. لا تعتبر الكتالوج إثبات استجابة.
## 6. PostgreSQL — ما تم على جهاز المالك
الحاوية factory-postgres، الصورة postgres:17-alpine الموجودة محلياً، PostgreSQL 17.11 مثبت من SHOW server_version. DB factory_db، schema factory، admin factory_admin، تطبيق factory_app، port 127.0.0.1:55432 -> 5432، volume factory_pgdata:/var/lib/postgresql/data، restart unless-stopped، memory 512m، cpus 1، health pg_isready كل 10s / timeout 5s / retries 5. عدم تعرض المنفذ مباشرة للشبكة لا يعادل اعتماداً أمنياً.
أوامر الإنشاء الأصلية محفوظة للتوثيق فقط؛ لا تعِد تنفيذها على قاعدة قائمة ولا تولد كلمة مرور جديدة:
```powershell
$env:POSTGRES_PASSWORD = [guid]::NewGuid().ToString("N")
docker volume create factory_pgdata
docker run -d --pull never --name factory-postgres --restart unless-stopped --memory=512m --cpus=1 -e POSTGRES_USER=factory_admin -e POSTGRES_PASSWORD -e POSTGRES_DB=factory_db -p 127.0.0.1:55432:5432 -v factory_pgdata:/var/lib/postgresql/data --health-cmd="pg_isready -U factory_admin -d factory_db" --health-interval=10s --health-timeout=5s --health-retries=5 postgres:17-alpine
```
DDL الذي نفذ بنجاح:
```sql
CREATE SCHEMA IF NOT EXISTS factory;
CREATE TABLE factory.factory_state (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
 revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO factory.factory_state (id,payload)
VALUES (1,jsonb_build_object('version',1,'tasks',jsonb_build_array()))
ON CONFLICT (id) DO NOTHING;
```
الحالة المؤكدة: id=1، payload={"tasks":[],"version":1}، revision=0، updated_at=2026-11-26 21:14:39.175031+00. ليست هناك بيانات مصنع منقولة. تصميم singleton JSONB متوافق مبدئياً مع SQLite؛ ليس مخطط 13 جدولاً علائقياً معتمداً. لا تنشئ نسخة ثانية من scheduler أو state. جدول المشاريع/الوكلاء/العمال/المهام/الاعتماديات/المحاولات/الحجوزات/النبض/المخرجات/المراجعات/التسليم/الموارد/audit اقتراح مؤجل لا يُنفذ دون قرار وترحيل.
## 7. الأدلة والاختبارات
مصدر الأدلة: مخرجات PowerShell التي لصقها المالك بالمحادثة؛ ليست CI مستقلاً.
- SELECT current_database(),current_user,now() أعاد factory_db/factory_admin، 2026-11-26 21:06:38.280307+00.
- Test-NetConnection 127.0.0.1 -Port 55432: TcpTestSucceeded=True.
- TCP psql داخل الحاوية على 127.0.0.1:5432 بالمستخدم الإداري: ناجح؛ اختبار host.docker.internal لم تُرسل نتيجته.
- \dt قبل الإنشاء: Did not find any relations. خطأ Get-Process كان بسبب لصق PS F:\AI-VHQ> مع الأمر وليس فشل قاعدة.
- SHOW server_version: 17.11؛ \dn: factory ملك factory_admin، public ملك pg_database_owner.
- CREATE TABLE وINSERT 0 1 ناجحان؛ \d أثبت PK و3 CHECK المذكورة.
- UPDATE revision=-1: رفض factory_state_revision_check؛ بقي revision=0. اختبار UPDATE ثم ROLLBACK أكد المالك تنفيذه، لم يرسل تفاصيله.
- التزامن الحقيقي: Start-Job حجز SELECT FOR UPDATE وpg_sleep(60)، pg_stat_activity PID 777 active/PgSleep، معاملة ثانية lock_timeout=3s رفضت الحجز: ERROR canceling statement due to lock timeout / while locking tuple (0,1). الأولى ROLLBACK؛ السجل بقي revision=0 والمهام فارغة. المحاولات الأولى المتسلسلة لم تثبت التزامن.
- حساب factory_app: المالك أكد إتمام الأوامر دون لصق المخرجات. أوامر الإنشاء/GRANT واختبار SELECT ورفض DROP موضحة أدناه؛ لا تعتبر صلاحياته مثبتة مستقلاً حتى إعادة فحص غير مدمر.
- npm.cmd ls pg --all قبل التثبيت: empty. المالك أكد تثبيت pg --save-exact واختبار Node.js الأخير بكلمة «تم» فقط؛ الإصدار الفعلي ونتيجة الاستعلام غير مرفقين. لا تدّع نجاح اتصال Node مثبت بالمخرجات.
## 8. الصلاحيات والأسرار
الأوامر السابقة (مرجع فقط، لا تكرر CREATE ROLE أو password reset):
```sql
CREATE ROLE factory_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE factory_db TO factory_app;
GRANT USAGE ON SCHEMA factory TO factory_app;
GRANT SELECT, UPDATE ON factory.factory_state TO factory_app;
```
كلمة المرور عينت عبر psql \password factory_app حسب تأكيد المالك. لا تخزن كلمات المرور في Git. لا تستخدم admin في runtime. تحقق من effective privileges وPUBLIC grants قبل الاعتماد. لا تختبر DROP مجدداً؛ استخدم has_table_privilege وملكية الجدول وhas_schema_privilege. لا تعتبر SELECT/UPDATE حماية من تلف payload؛ أضف تحققاً من version/tasks وقيود الترحيل عند التكامل.
الملفات المحلية غير المتتبعة المؤكدة قبل npm install: opencode-api.json، vhq-local.sqlite، vhq-local.sqlite-shm، vhq-local.sqlite-wal. لا ترفعها ولا تحذفها ولا تستخدم git add .؛ لا تنسخ SQLite أثناء الكتابة دون backup متسق. package.json غير موجود على رأس GitHub الذي فُحص؛ npm قد يكون أنشأ package.json وpackage-lock.json محلياً، وهما غير مفحوصين بعد. لا ترفع node_modules أو أسرار env. كلمة مرور PGPASSWORD الحالية تخص factory_app بعد آخر خطوة، وليس admin؛ المتغيرات مؤقتة لكل PowerShell.
## 9. الاستئناف من النقطة الحالية — لا تعُد إلى الإنشاء
أوقف التوسع. لا تبدأ بإنشاء قاعدة أو إعادة تعيين كلمات المرور. شغّل Docker إن توقف الجهاز، وافحص فقط:
```powershell
docker ps --filter name=factory-postgres
docker exec factory-postgres pg_isready -U factory_admin -d factory_db
git branch --show-current
git status --short
npm.cmd ls pg --depth=0
```
في PowerShell جديد:
```powershell
$env:PGHOST = "127.0.0.1"
$env:PGPORT = "55432"
$env:PGDATABASE = "factory_db"
$env:PGUSER = "factory_app"
$secret = Read-Host "Factory App Password" -AsSecureString
$env:PGPASSWORD = [System.Net.NetworkCredential]::new("", $secret).Password
```
اختبار Node الفعلي (لا يطبع كلمة المرور):
```powershell
node -e "const {Client}=require('pg');const c=new Client({connectionTimeoutMillis:5000});(async()=>{try{await c.connect();const r=await c.query('SELECT current_database(), current_user, revision, payload FROM factory.factory_state WHERE id=1');console.log(r.rows);}catch(e){console.error(e.message);process.exitCode=1;}finally{await c.end();}})();"
```
لا ترسل payload إذا احتوى لاحقاً بيانات حساسة. لا تشغل أوامر الإنشاء مجدداً.
## 10. خريطة الكود الحالية والخطوة التالية الدقيقة
- vhq/registry.mjs: SQLite مستقل يحفظ projects/assignments/dependencies/pilot_runs/audit، callbacks متزامنة، لا dispatch. لا ترحله الآن.
- vhq/runtime-monitor.mjs: projectRuntime(state,now) يتحقق من version=1/tasks، يسقط الأسرار، يحسب الحالات، readRuntime يقرأ SQLite فقط. لا يعتبر lease إثبات heartbeat.
- vhq/dashboard-server.mjs: endpoint GET /api/runtime يستدعي runtimeReader() تزامنياً؛ يلزم await runtimeReader() عند إضافة async PG adapter. بقية endpoints تبقى كما هي.
- vhq/start-dashboard.mjs: يبدأ registry المحلي، server على 127.0.0.1:8787، token عشوائي ساعة، يغلق registry عند SIGINT/SIGTERM. يلزم إغلاق pool عند الإنهاء.
- المصنع src/sqlite-store.mjs على coord/parallel-execution-v1: factory_state(id=1,payload TEXT)، BEGIN IMMEDIATE، callback sync، COMMIT/ROLLBACK. src/leases.mjs يطبق claim/submit/review/failExecution. العقد الأوسع يشمل attempts/resources/delivery/independent acceptance؛ يجب إعادة قراءة نسخة D المنسقة الفعلية قبل موصل الكتابة.
- الخطوة التالية الوحيدة: موصل قراءة PostgreSQL في vhq/ (مثلاً postgres-runtime.mjs)، opt-in صريح VHQ_RUNTIME_BACKEND=postgres، pg Pool محدود (مثلاً 2)، timeout واستعلام ثابت parameterized حيث يلزم، قراءة payload وrevision مع حد الحجم، projectRuntime، إرجاع unavailable عند الفشل دون fallback صامت، عدم تسريب الأسرار؛ await في endpoint، إغلاق pool. اختبارات mocks وlive read على factory_app، فحص /api/runtime بعد token، مقارنة revision مع SQL. لا تعديل UI أو ملفات A–F. تثبيت dependency وlockfile بعد فحص النسخة المحلية وتنسيق الملكية.
- بعد قبول القراءة: اتفق مع D على موصل كتابة PostgreSQL المتوافق مع transact(fn): BEGIN، SELECT ... FOR UPDATE، تحقق JSON، callback sync، UPDATE revision=revision+1/updated_at، COMMIT/ROLLBACK، تحرير client في finally. لا شبكة/نموذج داخل transaction؛ لا إعادة محاولة غير idempotent عمياء. اختبار عميلين، rollback، رفض callback async، انهيار واستعادة، fencing، مراجعة مستقلة، عدم تكرار تسليم. لا تشغل SQLite وPG كمصدر كتابة مزدوج لنفس المهام.
- بعدها adapter مدخل VHQ→TaskSpec مصرح، تحديد repo/commit/allowedPaths/testPlan/limits من المشغل، تثبيت عقد إصدار، نقل تكليف واحد من المقر دون فقد أو تكرار، لا إرسال بيانات خاصة. اختبار نموذج مجاني حي، B/E تنفيذ، F اختبار أحمر قبل/أخضر بعد، C PR، F تحقق commit/tree/CI، إظهار أدلة في VHQ. لا تعتبر accepted=delivered.
## 11. معيار إغلاق المرحلة
القاعدة تعمل والقيود والتزامن مثبتان. الصلاحيات واتصال pg مؤكدان لفظياً فقط؛ يطلب دليل منقح عند استئناف العمل. لا يوجد adapter PostgreSQL فعلي في VHQ بعد، ولا ترحيل ولا ربط مصنع حي. لا قاعدة سحابية، لا تشغيل مستقل بعد إغلاق الجهاز. لا اعتماد إنتاجي أو ادعاء تطابق بصري. كل تقدم لاحق يسجل في هذه الوثيقة مع SHA ونتيجة الاختبار والعائق والملفات المتغيرة. لا تعد للخلف إلا عند فشل دليل محدد.

## 12. استئناف 2026-11-27 — موصل القراءة منفذ، القبول معلق
- d5484fc: vhq/postgres-runtime.mjs، قراءة محدودة 8 MiB، revision نصي، إسقاط الأسرار، Pool بحد 2، مهلات، جلسات read-only، محلي factory_app فقط، لا fallback صامت.
- 31d22bf: await runtimeReader() في API.
- a8c20ac: اختيار VHQ_RUNTIME_BACKEND=postgres وإغلاق pool؛ SQLite intake محفوظ.
- 7cc0daa: أربعة اختبارات mock واختبار حي opt-in؛ لم تُنفذ بعد على جهاز المالك. لا اعتماد للربط قبل نتائج فعلية. pg مثبت حسب إفادة المالك فقط، لا package manifest/lockfile مرفوعين بعد.
- الاستئناف: git pull origin feat/vhq-enterprise-ui (لا git add .)، تحقق من pg، اضبط متغيرات PG كما في القسم 9، ثم $env:VHQ_TEST_POSTGRES='1'؛ node --test vhq/postgres-runtime.test.mjs. بعد نجاحه $env:VHQ_RUNTIME_BACKEND='postgres'؛ node vhq/start-dashboard.mjs، تحقق من API /api/runtime باستخدام رمز المشغل دون مشاركته. المطلوب snapshot ومصدر postgresql:factory.factory_state وrevision مطابق لـ SQL. لا تكتب أي بيانات ولا تنقل SQLite الآن. الخطوة اللاحقة بعد القبول: موصل كتابة منسق مع D. لا تعديل UI أو A–F في هذه الدورة.

## 13. قبول اختبار موصل القراءة الحي — 2026-11-27
مصدر الدليل: مخرجات PowerShell التي أرسلها المالك من F:\AI-VHQ؛ لا ادعاء بتشغيل CI مستقل.
- المحاولة الأولى: 4 pass / 1 fail، PostgreSQL local application configuration required. ضبط PGHOST=127.0.0.1 وPGPORT=55432 وPGDATABASE=factory_db وPGUSER=factory_app وكلمة المرور عبر Read-Host -AsSecureString.
- المحاولة الثانية: 4 pass / 1 fail؛ unavailable بدلاً من snapshot. تشخيص مباشر بمكتبة pg أعاد SQLSTATE 28P01 (password authentication failed for factory_app). لم يتطلب الإصلاح تعديل الكود أو إعادة إنشاء القاعدة. أعيد تعيين كلمة مرور التطبيق وحده عبر psql \\password factory_app ثم تحديث PGPASSWORD في الجلسة. لا تحفظ القيمة في المستودع.
- الاختبار النهائي: node --test vhq/postgres-runtime.test.mjs مع VHQ_TEST_POSTGRES=1. tests=5 pass=5 fail=0 skipped=0 cancelled=0 duration_ms=1209.8461. الاختبار الحي 773.7265ms. أربعة اختبارات محاكاة واختبار حي واحد. Snapshot revision=0 counts={queued:0,running:0,review:0,accepted:0,blocked:0,expired:0,unexpired:0}. هذا يثبت قراءة Node.js الفعلية بحساب التطبيق، وليس كتابة المصنع أو تشغيل العامل.
- الحالة: موصل قراءة PostgreSQL مقبول في اختبار المكون. نقطة الاستئناف الوحيدة التالية: اختبار endpoint المقر /api/runtime عبر تشغيل VHQ_RUNTIME_BACKEND=postgres، استخدام رمز المشغل محلياً دون مشاركته، مقارنة source وrevision وcounts مع SQL. اترك بيانات SQLite intake كما هي. لا ترحيل أو كتابة أو توسع قبل نجاح الاختبار.
- إصدار pg المحلي وملف الاعتماديات/lockfile لا يزالان بحاجة للتوثيق بعد فحصهما؛ لا ترفع ملفات opencode-api.json أو SQLite أو node_modules أو الأسرار. صلاحية القراءة بحساب التطبيق مثبتة الآن؛ فحص الصلاحيات السلبية التفصيلي غير مرفق. لا يعد هذا اعتماداً إنتاجياً.

## 14. مرشح موصل الكتابة — 2026-11-27
- المالك أكد إتمام اختبار API /api/runtime بكلمة «تم» فقط؛ لا توجد مخرجات source/revision مرفقة. لا يعد دليلاً مستقلاً على التكامل.
- تمت قراءة src/sqlite-store.mjs على coord/parallel-execution-v1 وعلى coord-v1/d-recovery؛ الأخير يستدعي normalizeDeliveryFailures من src/attempt-store.mjs قبل callback. لذلك موصل الكتابة يطلب normalizer صريحاً من D ولا يكرر تنفيذه أو يتجاهله. لم نعدل ملفات D أو ندمجها.
- f9b8d56: vhq/postgres-store.mjs مرشح غير مفعل. transact(fn) يستخدم BEGIN وSELECT FOR UPDATE ومهلات وحجم محدود وUPDATE parameterized مع revision+1 وCOMMIT/ROLLBACK؛ يرفض callback async ويتوقف عند غموض commit دون إعادة تلقائية. close يغلق pool. لا تشغيل كتابة أو ترحيل في المقر.
- 6f8eff5: vhq/postgres-store.test.mjs خمسة اختبارات mock؛ النتائج لم ترد بعد. الخطوة التالية: git pull origin feat/vhq-enterprise-ui ثم node --test vhq/postgres-store.test.mjs. بعد نجاحها تنسيق مراجعة D واختبار PostgreSQL حي في قاعدة اختبار مستقلة، لا على سجل الحالة الفعلي. لا تفعّل الكتابة قبل اختبار rollback والتزامن وfencing والاستعادة والتوافق مع D. لا توسع UI أو محركات. لم توثق نسخة pg أو lockfile بعد.
