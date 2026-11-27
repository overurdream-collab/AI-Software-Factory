param([ValidateSet('intake','recovery','write','read')][string]$Mode='intake')
$ErrorActionPreference='Stop'
$env:PGHOST='127.0.0.1'
$env:PGPORT='55432'
$env:PGUSER='factory_app'
$env:PGDATABASE=if($Mode -eq 'read'){'factory_db'}else{'factory_test_db'}
$secret=Read-Host 'Factory App Password' -AsSecureString
$env:PGPASSWORD=[System.Net.NetworkCredential]::new('', $secret).Password
try {
 switch ($Mode) {
 'intake' { $env:VHQ_TEST_TASK_INTAKE='1'; node --test vhq/task-intake.test.mjs }
 'recovery' { $env:VHQ_TEST_POSTGRES_RECOVERY='1'; node --test vhq/postgres-recovery.live.test.mjs }
 'write' { $env:VHQ_TEST_POSTGRES_WRITE='1'; node --test vhq/postgres-store.test.mjs vhq/postgres-store.live.test.mjs }
 'read' { $env:VHQ_TEST_POSTGRES='1'; node --test vhq/postgres-runtime.test.mjs }
 }
 if ($LASTEXITCODE -ne 0) { throw "Test failed: $LASTEXITCODE" }
} finally {
 Remove-Item Env:PGPASSWORD,Env:VHQ_TEST_TASK_INTAKE,Env:VHQ_TEST_POSTGRES_RECOVERY,Env:VHQ_TEST_POSTGRES_WRITE,Env:VHQ_TEST_POSTGRES -ErrorAction SilentlyContinue
 $env:PGDATABASE='factory_db'
}
