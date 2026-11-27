param()
$ErrorActionPreference='Stop'
$env:PGHOST='127.0.0.1'
$env:PGPORT='55432'
$env:PGUSER='factory_app'
$env:PGDATABASE='factory_test_db'
$env:VHQ_RUNTIME_BACKEND='sqlite'
$env:VHQ_TEST_INTAKE_MODE='1'
$env:VHQ_ENABLE_FREE_PILOT='0'
$secret=Read-Host 'Factory App Password' -AsSecureString
$env:PGPASSWORD=[System.Net.NetworkCredential]::new('', $secret).Password
try {
 node vhq/start-dashboard.mjs
 if ($LASTEXITCODE -ne 0) { throw "Dashboard exited: $LASTEXITCODE" }
} finally {
 Remove-Item Env:PGPASSWORD,Env:VHQ_TEST_INTAKE_MODE -ErrorAction SilentlyContinue
}
