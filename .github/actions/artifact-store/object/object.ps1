# artifact-store/object (#753) - ONE file to or from the store, for a runner that has PowerShell
# and curl but no bash and no S3 client (a clean-install lane rolled back to a bare snapshot).
# Usage: object.ps1 get|put, configured by AS_* env vars that action.yml maps from its inputs.
# Doc: docs/artifact-store.md, section "A runner with no bash and no S3 client".
#
# Narrow on purpose. The full upload/download logic (globs, directories, publish, patterns) stays
# in lib/artifact-store.sh and is not repeated here. This file knows two things only:
#   - the key layout: [<key-prefix>/]<owner>/<repo>/<run_id>/<run_attempt>/<name>/<file>
#   - the attempt rule: `get` takes the newest attempt that holds the object, as `download` does.
# So the bash actions read what `put` writes and `get` reads what `upload` wrote.
#
# Signing is curl's own --aws-sigv4, path-style. curl before 8.1.0 leaves x-amz-content-sha256
# unsigned and stores refuse every request ("Header x-amz-content-sha256 should be signed",
# measured on 7.75 to 7.88, #753), hence the floor below.
#
# Must stay Windows PowerShell 5.1-clean and pure ASCII: 5.1 reads a script without a BOM in the
# ANSI code page. The secret reaches curl in a config file (-K <file>) inside this step's own temp
# directory, removed when the step ends - never on curl's command line. Not stdin: curl rejected a
# config piped from Windows PowerShell 5.1 ("found an unknown config option") even with a BOM-less
# $OutputEncoding, measured on windows-latest (#753).
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
$work = $null

function Fail([string]$msg) {
  if ($work -and (Test-Path -LiteralPath $work)) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
  Write-Output "::error title=artifact-store::$msg"
  exit 1
}
function SetOutput([string]$k, [string]$v) {
  # AppendAllText writes UTF-8 without a BOM; Add-Content -Encoding UTF8 on 5.1 would start an
  # empty $GITHUB_OUTPUT with one and corrupt the first output's name.
  if ($env:GITHUB_OUTPUT) { [IO.File]::AppendAllText($env:GITHUB_OUTPUT, "$k=$v`n") }
  Write-Output "  $k=$v"
}
function EnvOr([string]$n, [string]$d) {
  $v = [Environment]::GetEnvironmentVariable($n)
  if ([string]::IsNullOrEmpty($v)) { return $d }
  return $v.Trim()
}
# S3's own URI encoding: every byte outside A-Z a-z 0-9 - . _ ~ as %XX. Done by hand because
# [Uri]::EscapeDataString leaves !*'() alone on some .NET Framework targets, and the signature
# then disagrees with the store's.
function Enc([string]$s) {
  $sb = New-Object System.Text.StringBuilder
  foreach ($b in [Text.Encoding]::UTF8.GetBytes($s)) {
    # by byte value: PowerShell's -ge on characters compares without case
    if (($b -ge 65 -and $b -le 90) -or ($b -ge 97 -and $b -le 122) -or ($b -ge 48 -and $b -le 57) -or $b -eq 45 -or $b -eq 46 -or $b -eq 95 -or $b -eq 126) {
      [void]$sb.Append([char]$b)
    } else { [void]$sb.Append(('%{0:X2}' -f $b)) }
  }
  return $sb.ToString()
}
function EncKey([string]$k) { return (($k -split '/') | ForEach-Object { Enc $_ }) -join '/' }

$mode = if ($args.Count -gt 0) { [string]$args[0] } else { '' }
if ($mode -ne 'get' -and $mode -ne 'put') { Fail "mode must be get or put (got '$mode')" }

$bucket = EnvOr 'AS_BUCKET' ''
if (-not $bucket) { Fail "input 'bucket' is empty - pass it from a secret or a variable (docs/artifact-store.md)" }
$region = EnvOr 'AS_REGION' 'us-east-1'
$endpoint = (EnvOr 'AS_ENDPOINT' "https://s3.$region.amazonaws.com").TrimEnd('/')
$prefix = (EnvOr 'AS_KEY_PREFIX' '').Trim('/')
$ak = EnvOr 'AS_ACCESS_KEY' ''
$sk = EnvOr 'AS_SECRET_KEY' ''
if ($sk) { Write-Output "::add-mask::$sk" }

$name = EnvOr 'AS_NAME' ''
if (-not $name) { Fail "input 'name' is empty" }
if ($name -match '[/\\:*?"<>|]' -or $name -eq '.' -or $name -eq '..') {
  Fail "artifact name '$name' contains a character not allowed in a name (/ \ : * ? `" < > |)"
}
$repo = EnvOr 'GITHUB_REPOSITORY' ''
if (-not $repo) { Fail 'GITHUB_REPOSITORY is not set - run this inside a workflow' }
$runId = EnvOr 'AS_RUN_ID' (EnvOr 'GITHUB_RUN_ID' '')
if (-not $runId) { Fail 'GITHUB_RUN_ID is not set' }
$attemptText = EnvOr 'GITHUB_RUN_ATTEMPT' '1'
$attempt = 0
if (-not [int]::TryParse($attemptText, [ref]$attempt) -or $attempt -lt 1) { Fail "GITHUB_RUN_ATTEMPT is not a positive number (got '$attemptText')" }
$runKey = "$repo/$runId"
if ($prefix) { $runKey = "$prefix/$runKey" }

$localPath = EnvOr 'AS_PATH' ''
$file = (EnvOr 'AS_FILE' '').Replace('\', '/').Trim('/')
if ($mode -eq 'put') {
  if (-not $localPath) { Fail "input 'path' is empty - name the one file to put" }
  if (-not (Test-Path -LiteralPath $localPath -PathType Leaf)) {
    Fail "path '$localPath' is not a file. put sends exactly one file: pack a directory into one archive first (Compress-Archive)."
  }
  $localPath = (Resolve-Path -LiteralPath $localPath).ProviderPath
  if (-not $file) { $file = Split-Path -Leaf $localPath }
}
if (-not $file) { Fail "input 'file' is empty - name the file inside the artifact (for example installer.zip)" }
foreach ($seg in $file -split '/') {
  if ($seg -eq '' -or $seg -eq '.' -or $seg -eq '..') { Fail "file '$file' must be a relative path inside the artifact, with no empty, . or .. segment" }
}

# --- curl: the runner's own, never installed here ----------------------------------------------
# curl.exe first: on Windows PowerShell 5.1 a bare `curl` is an alias of Invoke-WebRequest.
$cmd = Get-Command -CommandType Application -Name 'curl.exe', 'curl' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $cmd) { Fail 'no curl on this runner. Windows 10 1803+ and Windows Server 2019+ ship curl.exe; this action never installs one.' }
$curl = $cmd.Path
$verLine = [string](& $curl --version | Select-Object -First 1)
$m = [regex]::Match($verLine, '^curl (\d+)\.(\d+)\.(\d+)')
if (-not $m.Success) { Fail "could not read the version of $curl (got '$verLine')" }
$ver = [Version]('{0}.{1}.{2}' -f $m.Groups[1].Value, $m.Groups[2].Value, $m.Groups[3].Value)
if ($ver -lt [Version]'8.1.0') {
  Fail "curl $ver at $curl cannot sign a request an S3 store accepts: before 8.1.0 curl leaves x-amz-content-sha256 unsigned. Use a runner image whose curl is 8.1.0 or newer - this action never installs one."
}

$tmpRoot = EnvOr 'RUNNER_TEMP' ([IO.Path]::GetTempPath())
$work = Join-Path $tmpRoot ('artifact-store-' + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $work)
$errFile = Join-Path $work 'curl.err'
# A curl config line: backslash and double quote are the only escapes inside a quoted value.
# Written as exact bytes (UTF-8, no BOM) so no shell or console encoding can touch it.
$cfgFile = Join-Path $work 'curl.cfg'
$cfg = 'user = "' + ("${ak}:${sk}".Replace('\', '\\').Replace('"', '\"')) + '"' + "`n"
[IO.File]::WriteAllText($cfgFile, $cfg, (New-Object System.Text.UTF8Encoding $false))

# s3 <method> <key> <body file to write (GET) or to send (PUT)> -> @{ code; exit; body; err }
function S3([string]$method, [string]$key, [string]$bodyFile) {
  $url = "$endpoint/$(Enc $bucket)/$(EncKey $key)"
  $resp = Join-Path $work 'response'
  $a = @('-sS', '--stderr', $errFile, '-K', $cfgFile, '--aws-sigv4', "aws:amz:${region}:s3",
         '--connect-timeout', '30', '--retry', '2', '-w', '%{http_code}')
  if ($method -eq 'PUT') { $a += @('-T', $bodyFile, '-o', $resp) } else { $a += @('-o', $bodyFile) }
  $a += $url
  $code = [string](& $curl @a)
  $exit = $LASTEXITCODE
  $err = ''
  if (Test-Path -LiteralPath $errFile) { $err = ([IO.File]::ReadAllText($errFile)).Trim() }
  $bodyPath = if ($method -eq 'PUT') { $resp } else { $bodyFile }
  $body = ''
  if ((Test-Path -LiteralPath $bodyPath) -and $code -notmatch '^2') { $body = [IO.File]::ReadAllText($bodyPath) }
  return @{ code = $code.Trim(); exit = $exit; body = $body; err = $err }
}
# The store's own words: <Code> and <Message> from its XML error, else the raw start of the body.
function StoreError($r) {
  $c = [regex]::Match($r.body, '<Code>([^<]*)</Code>').Groups[1].Value
  $msg = [regex]::Match($r.body, '<Message>([^<]*)</Message>').Groups[1].Value
  if ($c) { return "HTTP $($r.code) $c - $msg" }
  $raw = $r.body.Trim(); if ($raw.Length -gt 300) { $raw = $raw.Substring(0, 300) }
  return "HTTP $($r.code) $raw"
}
function Unreachable($r) {
  if ($r.exit -ne 0 -and ($r.code -eq '000' -or -not $r.code)) {
    Fail "could not reach the store at ${endpoint}: curl exit $($r.exit) - $($r.err)"
  }
}

if ($mode -eq 'put') {
  $key = "$runKey/$attempt/$name/$file"
  $r = S3 'PUT' $key $localPath
  Unreachable $r
  if ($r.code -notmatch '^2') { Fail "upload of '$name/$file' to s3://$bucket/$key failed: $(StoreError $r)" }
  $size = (Get-Item -LiteralPath $localPath).Length
  Write-Output "artifact-store: put '$name/$file' (attempt $attempt, $size bytes)"
  SetOutput 'key' $key
  SetOutput 'attempt' "$attempt"
} else {
  if (-not $localPath) { $localPath = Split-Path -Leaf $file }
  $dest = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($localPath)
  $dir = Split-Path -Parent $dest
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { [void](New-Item -ItemType Directory -Path $dir -Force) }
  $tmp = Join-Path $work 'object'
  $tried = @()
  $got = 0
  for ($n = $attempt; $n -ge 1; $n--) {
    $key = "$runKey/$n/$name/$file"
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
    $r = S3 'GET' $key $tmp
    Unreachable $r
    if ($r.code -match '^2') { $got = $n; break }
    # 404 NoSuchKey: not in this attempt, try the one before. Anything else - a refused signature,
    # a wrong region, a missing bucket, denied access - is the store's answer, shown as it is.
    $c = [regex]::Match($r.body, '<Code>([^<]*)</Code>').Groups[1].Value
    if ($r.code -ne '404' -or ($c -and $c -ne 'NoSuchKey')) { Fail "download of s3://$bucket/$key failed: $(StoreError $r)" }
    $tried += "$n"
  }
  if (-not $got) {
    Fail "no object '$name/$file' - looked for s3://$bucket/$runKey/<attempt>/$name/$file in attempts [$($tried -join ' ')] of run $runId. Was it uploaded by this run, with the same bucket and key-prefix?"
  }
  Move-Item -LiteralPath $tmp -Destination $dest -Force
  Write-Output "artifact-store: got '$name/$file' (attempt $got) to $dest"
  SetOutput 'path' $dest
  SetOutput 'attempt' "$got"
}
Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
