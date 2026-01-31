$ErrorActionPreference = "Stop"

function Write-Section($text) {
  $line = "=== $text ==="
  Write-Output ""
  Write-Output $line
  if ($script:tracePath) {
    ("{0} {1}" -f (Get-Date -Format o), $line) | Add-Content -Path $script:tracePath
  }
}

function Write-Log($text) {
  $line = ("{0} {1}" -f (Get-Date -Format o), $text)
  Write-Output $line
  if ($script:tracePath) {
    $line | Add-Content -Path $script:tracePath
  }
}

function Get-FreePort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = $listener.LocalEndpoint.Port
  $listener.Stop()
  return $port
}

$repoRoot = (Get-Location).Path
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$artifactsRoot = Join-Path $repoRoot "artifacts"
$rcDir = Join-Path $artifactsRoot "rc-$timestamp"
New-Item -ItemType Directory -Path $rcDir -Force | Out-Null
$script:tracePath = Join-Path $rcDir "rc-run.trace.log"
$rcErr = Join-Path $rcDir "rc-run.err"

$serverProc = $null
$proc = $null
$logWriter = $null

try {

Write-Section "Node 20.11.1 (local)"
$nodeDir = Join-Path $repoRoot ".trcoder\\node-v20.11.1"
$nodeExe = Join-Path $nodeDir "node-v20.11.1-win-x64\\node.exe"
if (-not (Test-Path $nodeExe)) {
  New-Item -ItemType Directory -Path $nodeDir -Force | Out-Null
  $zipPath = Join-Path $nodeDir "node-v20.11.1-win-x64.zip"
  $url = "https://nodejs.org/dist/v20.11.1/node-v20.11.1-win-x64.zip"
  Write-Log "Downloading $url"
  Invoke-WebRequest -Uri $url -OutFile $zipPath
  Expand-Archive -Path $zipPath -DestinationPath $nodeDir -Force
}

$env:PATH = (Split-Path $nodeExe) + ";" + $env:PATH
$null = Add-Type -AssemblyName System.Net.Http
$nodeVersion = & $nodeExe -v
$pnpmVersion = pnpm -v
$serverPort = Get-FreePort
$serverUrl = "http://127.0.0.1:$serverPort"
"node20=$nodeVersion`npnpm=$pnpmVersion`nserver=$serverUrl" | Set-Content -Path (Join-Path $rcDir "env.txt")

Write-Section "Tests"
pnpm -r test | Tee-Object -FilePath (Join-Path $rcDir "test.log") | Out-Null

Write-Section "Build"
pnpm -r build | Tee-Object -FilePath (Join-Path $rcDir "build.log") | Out-Null

Write-Section "Start server"
$env:PORT = "$serverPort"
$env:HOST = "127.0.0.1"
$env:TRCODER_DB_PATH = (Join-Path $repoRoot ".trcoder\\rc.db")
$serverLog = Join-Path $rcDir "server.log"
$serverErr = Join-Path $rcDir "server.err.log"
$serverProc = Start-Process -FilePath $nodeExe -ArgumentList "packages/server/dist/index.js" -WorkingDirectory $repoRoot -PassThru -RedirectStandardOutput $serverLog -RedirectStandardError $serverErr

Write-Log "Waiting for server..."
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  try {
    $headers = @{ Authorization = "Bearer dev" }
    Invoke-RestMethod -Uri "$serverUrl/v1/whoami" -Headers $headers | Out-Null
    $ready = $true
    break
  } catch {
    Start-Sleep -Seconds 1
  }
}
if (-not $ready) {
  throw "Server did not become ready."
}

Write-Section "CLI connect"
& $nodeExe "packages/cli/dist/index.js" connect --server $serverUrl --api-key "dev" | Tee-Object -FilePath (Join-Path $rcDir "connect.log") | Out-Null

Write-Section "Secret file + permissions override"
$secretPath = Join-Path $env:TEMP "trcoder-rc-secret.txt"
$secretPathCli = $secretPath -replace '\\', '/'
@"
API_KEY=supersecret
password=demo
AKIA1234567890ABCD12
"@ | Set-Content -Path $secretPath -Encoding UTF8

$permissionsOverride = @{
  allow = @(
    "git status*",
    "git diff*",
    "git rev-parse*",
    "git log*",
    "pnpm -w test*",
    "pnpm -w typecheck*",
    "pnpm -w lint*",
    "pnpm -w build*",
    "node --version",
    "pnpm --version",
    "git worktree add*",
    "git worktree remove*",
    "git -C * apply*",
    "git -C * commit*"
  );
  ask = @();
  deny = @(
    "git -C * push*"
  )
}
$permPath = Join-Path $env:USERPROFILE ".trcoder\\permissions.json"
New-Item -ItemType Directory -Path (Split-Path $permPath) -Force | Out-Null
$permissionsOverride | ConvertTo-Json -Depth 4 | Set-Content -Path $permPath -Encoding ascii

Write-Section "CLI shell runbook"
$cliLog = Join-Path $rcDir "cli.log"

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $nodeExe
$psi.Arguments = "packages/cli/dist/index.js shell"
$psi.WorkingDirectory = $repoRoot
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true

$proc = New-Object System.Diagnostics.Process
$proc.StartInfo = $psi
$null = $proc.Start()

$commands = @(
  @{ cmd = "/init"; wait = 2 },
  @{ cmd = "/pins add @$secretPathCli"; wait = 1 },
  @{ cmd = "/plan from @docs/prd.md"; wait = 2 },
  @{ cmd = "/plan approve"; wait = 2 },
  @{ cmd = "/start --task task-001"; wait = 5; followups = @("START") },
  @{ cmd = "/verify"; wait = 4 },
  @{ cmd = "/diff"; wait = 1 },
  @{ cmd = "/apply"; wait = 8; followups = @("APPLY") },
  @{ cmd = "/invoice preview"; wait = 1 },
  @{ cmd = "/export ledger"; wait = 1 },
  @{ cmd = "/doctor"; wait = 1 }
)

Start-Sleep -Seconds 2
try {
  foreach ($entry in $commands) {
    Write-Log "CLI: $($entry.cmd)"
    $proc.StandardInput.WriteLine($entry.cmd)
    Start-Sleep -Seconds 1
    if ($entry.followups) {
      foreach ($resp in $entry.followups) {
        Write-Log "CLI: $resp"
        $proc.StandardInput.WriteLine($resp)
        Start-Sleep -Seconds 1
      }
    }
    Start-Sleep -Seconds $entry.wait
  }
} catch {
  $_ | Out-String | Set-Content -Path (Join-Path $rcDir "cli-runbook.err") -Encoding UTF8
  throw
}

Start-Sleep -Seconds 5

Write-Section "Collect artifacts"
$configPath = Join-Path $env:USERPROFILE ".trcoder\\cli.json"
$cliConfig = Get-Content $configPath -Raw | ConvertFrom-Json
$runId = $cliConfig.last_run_id
$packId = $cliConfig.last_context_pack.pack_id

if ($runId) {
  Write-Log "Capturing SSE..."
  $sseLog = Join-Path $rcDir "sse.log"
  $client = New-Object System.Net.Http.HttpClient
  $req = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Get, "$serverUrl/v1/runs/$runId/stream")
  $req.Headers.Add("Authorization", "Bearer dev")
  $resp = $client.SendAsync($req, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).Result
  $stream = $resp.Content.ReadAsStreamAsync().Result
  $reader = New-Object System.IO.StreamReader($stream)
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $sseWriter = New-Object System.IO.StreamWriter($sseLog, $false)
  $lineTask = $reader.ReadLineAsync()
  while ($sw.Elapsed.TotalSeconds -lt 6) {
    if (-not $lineTask.Wait(1000)) { continue }
    $line = $lineTask.Result
    if ($line -eq $null) { break }
    $sseWriter.WriteLine($line)
    $lineTask = $reader.ReadLineAsync()
  }
  $sseWriter.Close()
  $reader.Close()
  $client.Dispose()
} else {
  Write-Log "Skipping SSE capture: run id not found."
}

# ledger.jsonl
$ledger = Invoke-RestMethod -Uri "$serverUrl/v1/ledger/export" -Headers @{ Authorization = "Bearer dev" }
$ledger | Set-Content -Path (Join-Path $rcDir "ledger.jsonl") -Encoding UTF8

# invoice preview
$invoice = Invoke-RestMethod -Uri "$serverUrl/v1/invoice/preview" -Headers @{ Authorization = "Bearer dev" }
$invoice | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $rcDir "invoice-preview.json") -Encoding UTF8

# logs tail
$logs = Invoke-RestMethod -Uri "$serverUrl/v1/logs/tail?run_id=$runId" -Headers @{ Authorization = "Bearer dev" }
$logs | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $rcDir "logs-tail.txt") -Encoding UTF8

# ctx redaction report
$body = @{ path = $secretPath } | ConvertTo-Json
$ctx = Invoke-RestMethod -Uri "$serverUrl/v1/packs/$packId/read" -Method Post -Headers @{ Authorization = "Bearer dev"; "Content-Type" = "application/json" } -Body $body
$ctxReport = @(
  "# Context Redaction Report",
  "",
  "Path: $($ctx.path)",
  "",
  '```',
  $ctx.text,
  '```'
)
$ctxReport -join "`n" | Set-Content -Path (Join-Path $rcDir "ctx-redaction-report.md") -Encoding UTF8

Write-Section "Capture CLI logs"
try {
  if (-not $proc.HasExited) {
    $proc.Kill()
  }
} catch {}

try {
  $stdout = $proc.StandardOutput.ReadToEnd()
  $stderr = $proc.StandardError.ReadToEnd()
  $stdout | Set-Content -Path $cliLog -Encoding UTF8
  $stderr | Set-Content -Path (Join-Path $rcDir "cli.err.log") -Encoding UTF8
} catch {
  Write-Log "CLI log capture failed: $_"
}

# apply report (use CLI log)
$applyReportPath = Join-Path $rcDir "apply-report.md"
$applyLines = Select-String -Path $cliLog -Pattern "Apply|Strict verify|Worktree|Command failed" | ForEach-Object { $_.Line }
@(
  "# Apply Report",
  "",
  "CLI Log: $(Split-Path $cliLog -Leaf)",
  "",
  "## Summary",
  ($applyLines -join "`n")
) | Set-Content -Path $applyReportPath -Encoding UTF8

# doctor report (extract from CLI log)
$doctorPath = Join-Path $rcDir "doctor.txt"
$doctorLines = Select-String -Path $cliLog -Pattern "storage\\.|server\\.connectivity|runner\\.ws|config\\.path|file\\.permissions" | ForEach-Object {
  $_.Line -replace "^trcoder\\[[^\\]]+\\]>\\s*", ""
}
@($doctorLines) | Set-Content -Path $doctorPath -Encoding UTF8

Write-Section "Shutdown server"
try { $serverProc.Kill() } catch {}

Write-Output "RC artifacts: $rcDir"

} catch {
  $_ | Out-String | Set-Content -Path $rcErr -Encoding UTF8
  throw
} finally {
  try { if ($logWriter) { $logWriter.Close() } } catch {}
  try { if ($proc -and -not $proc.HasExited) { $proc.Kill() } } catch {}
  try { if ($serverProc -and -not $serverProc.HasExited) { $serverProc.Kill() } } catch {}
}
