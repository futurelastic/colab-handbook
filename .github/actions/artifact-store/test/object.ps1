# Round-trip of object/object.ps1 against a REAL store (#753): AS_ENDPOINT, AS_BUCKET, AS_ACCESS_KEY,
# AS_SECRET_KEY and AS_REGION must be set. Runs under Windows PowerShell 5.1 and pwsh 7 alike (the
# workflow runs it on both). Pure ASCII, like the script it tests.
# Checks: put -> get round-trip of a binary file, a re-run (attempt 3) finds attempt 1's object, the
# newest attempt wins, a missing object fails naming the key and the attempts searched, a wrong
# secret and a wrong region fail with the store's own error, and put refuses a directory.
# With AS_INTEROP_OUT set, it also leaves a file put under name `from-ps` for the bash download
# action to read (the workflow checks the other direction too).
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
$obj = Join-Path $PSScriptRoot '../object/object.ps1'
foreach ($v in 'AS_ENDPOINT', 'AS_BUCKET', 'AS_ACCESS_KEY', 'AS_SECRET_KEY') {
  if (-not [Environment]::GetEnvironmentVariable($v)) { Write-Output "object test: $v is not set"; exit 2 }
}
$t = Join-Path ([IO.Path]::GetTempPath()) ('as-object-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $t)
$keep = @{}
foreach ($v in 'GITHUB_OUTPUT', 'GITHUB_RUN_ATTEMPT', 'GITHUB_RUN_ID', 'GITHUB_REPOSITORY', 'AS_NAME', 'AS_FILE', 'AS_PATH', 'AS_SECRET_KEY', 'AS_REGION') {
  $keep[$v] = [Environment]::GetEnvironmentVariable($v)
}
if (-not $env:GITHUB_REPOSITORY) { $env:GITHUB_REPOSITORY = 'acme/widget' }
if (-not $env:GITHUB_RUN_ID) { $env:GITHUB_RUN_ID = 'obj-' + [guid]::NewGuid().ToString('N').Substring(0, 12) }

function Done([int]$code, [string]$msg) {
  foreach ($k in $keep.Keys) { [Environment]::SetEnvironmentVariable($k, $keep[$k]) }
  Remove-Item -LiteralPath $t -Recurse -Force -ErrorAction SilentlyContinue
  Write-Output $msg
  exit $code
}
function Fail([string]$msg) { Done 1 "object test: FAIL - $msg" }
# run <mode> <name> <file> <path> [attempt] -> @{ exit; text }
function Run([string]$mode, [string]$name, [string]$file, [string]$path, [string]$attempt = '1') {
  $env:AS_NAME = $name; $env:AS_FILE = $file; $env:AS_PATH = $path; $env:GITHUB_RUN_ATTEMPT = $attempt
  $env:GITHUB_OUTPUT = Join-Path $t 'out'
  # ::add-mask:: lines are dropped: echoed back inside a FAIL message they would print the secret.
  $text = ((& $obj $mode 2>&1) | Where-Object { "$_" -notmatch '^::add-mask::' } | Out-String)
  return @{ exit = $LASTEXITCODE; text = $text }
}
function Bytes([string]$p) { return [Convert]::ToBase64String([IO.File]::ReadAllBytes($p)) }

$src = Join-Path $t 'handoff.bin'
$rnd = New-Object byte[] 300000; (New-Object Random 753).NextBytes($rnd); [IO.File]::WriteAllBytes($src, $rnd)

$r = Run 'put' 'handoff' '' $src
if ($r.exit -ne 0) { Fail "put: $($r.text)" }
if ($r.text -notmatch "key=acme/widget/$($env:GITHUB_RUN_ID)/1/handoff/handoff.bin|key=.+/$($env:GITHUB_RUN_ID)/1/handoff/handoff.bin") { Fail "put must key owner/repo/run/attempt/name/file: $($r.text)" }
$out = [IO.File]::ReadAllBytes((Join-Path $t 'out'))
if ($out.Length -ge 3 -and $out[0] -eq 0xEF) { Fail 'GITHUB_OUTPUT must not start with a BOM' }

$r = Run 'get' 'handoff' 'handoff.bin' (Join-Path $t 'got/a/handoff.bin')
if ($r.exit -ne 0) { Fail "get: $($r.text)" }
if ((Bytes (Join-Path $t 'got/a/handoff.bin')) -ne (Bytes $src)) { Fail 'get must return the same bytes' }

# A re-run of a failed job: attempt 3 finds attempt 1's object; once attempt 3 puts it, it wins.
$r = Run 'get' 'handoff' 'handoff.bin' (Join-Path $t 'got/b.bin') '3'
if ($r.exit -ne 0 -or $r.text -notmatch '\(attempt 1\)') { Fail "attempt 3 must find attempt 1's object: $($r.text)" }
$v2 = Join-Path $t 'v2.txt'; [IO.File]::WriteAllText($v2, 'second')
$r = Run 'put' 'handoff' 'handoff.bin' $v2 '3'
if ($r.exit -ne 0) { Fail "put attempt 3: $($r.text)" }
$r = Run 'get' 'handoff' 'handoff.bin' (Join-Path $t 'got/c.bin') '3'
if ($r.exit -ne 0 -or [IO.File]::ReadAllText((Join-Path $t 'got/c.bin')) -ne 'second') { Fail "the newest attempt must win: $($r.text)" }

# A file name that needs encoding still round-trips (the signature covers the encoded path).
$odd = Join-Path $t 'odd.txt'; [IO.File]::WriteAllText($odd, 'odd')
$r = Run 'put' 'logs' "dir one/it's (1)+x.txt" $odd
if ($r.exit -ne 0) { Fail "put of an encoded name: $($r.text)" }
$r = Run 'get' 'logs' "dir one/it's (1)+x.txt" (Join-Path $t 'got/odd.txt')
if ($r.exit -ne 0 -or [IO.File]::ReadAllText((Join-Path $t 'got/odd.txt')) -ne 'odd') { Fail "get of an encoded name: $($r.text)" }

# Loud failures.
$r = Run 'get' 'never-uploaded' 'x.zip' (Join-Path $t 'got/m.zip') '2'
if ($r.exit -eq 0) { Fail 'a missing object must fail' }
if ($r.text -notmatch '/<attempt>/never-uploaded/x\.zip' -or $r.text -notmatch 'attempts \[2 1\]') { Fail "the missing-object error must name the key and the attempts: $($r.text)" }
if (Test-Path -LiteralPath (Join-Path $t 'got/m.zip')) { Fail 'a failed get must not leave the error body behind as the file' }

$env:AS_SECRET_KEY = 'wrong-secret'
$r = Run 'get' 'handoff' 'handoff.bin' (Join-Path $t 'got/w.bin')
$env:AS_SECRET_KEY = $keep['AS_SECRET_KEY']
if ($r.exit -eq 0 -or $r.text -notmatch 'HTTP 40[03] ') { Fail "a wrong secret must fail with the store's error: $($r.text)" }

if ($env:AS_EXPECT_REGION_CHECK -eq 'true') {
  $env:AS_REGION = 'xx-wrong-1'
  $r = Run 'get' 'handoff' 'handoff.bin' (Join-Path $t 'got/r.bin')
  $env:AS_REGION = $keep['AS_REGION']
  if ($r.exit -eq 0 -or $r.text -notmatch 'HTTP 400 ') { Fail "a wrong region must fail with the store's error: $($r.text)" }
}

$r = Run 'put' 'dir' '' $t
if ($r.exit -eq 0 -or $r.text -notmatch 'is not a file') { Fail "put must refuse a directory: $($r.text)" }

if ($env:AS_INTEROP_OUT) {
  $f = Join-Path $t 'from-ps.txt'; [IO.File]::WriteAllText($f, 'written by object.ps1')
  $r = Run 'put' 'from-ps' 'nested/from-ps.txt' $f $keep['GITHUB_RUN_ATTEMPT']
  if ($r.exit -ne 0) { Fail "interop put: $($r.text)" }
}
Done 0 'artifact-store object round-trip: ok'
