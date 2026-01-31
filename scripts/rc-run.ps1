$ErrorActionPreference = "Stop"

function Write-Section($text) {
  Write-Host ""
  Write-Host "=== $text ==="
}

$repoRoot = (Get-Location).Path
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$artifactsRoot = Join-Path $repoRoot "artifacts"
$rcDir = Join-Path $artifactsRoot "rc-$timestamp"
New-Item -ItemType Directory -Path $rcDir -Force | Out-Null

Write-Section "Node 20.11.1 (local)"
$nodeDir = Join-Path $repoRoot ".trcoder\\node-v20.11.1"
$nodeExe = Join-Path $nodeDir "node-v20.11.1-win-x64\\node.exe"
if (-not (Test-Path $nodeExe)) {
  New-Item -ItemType Directory -Path $nodeDir -Force | Out-Null
  $zipPath = Join-Path $nodeDir "node-v20.11.1-win-x64.zip"
  $url = "https://nodejs.org/dist/v20.11.1/node-v20.11.1-win-x64.zip"
  Write-Host "Downloading $url"
  Invoke-WebRequest -Uri $url -OutFile $zipPath
  Expand-Archive -Path $zipPath -DestinationPath $nodeDir -Force
}

$env:PATH = (Split-Path $nodeExe) + ";" + $env:PATH
$nodeVersion = & $nodeExe -v
$pnpmVersion = pnpm -v
"node20=$nodeVersion`npnpm=$pnpmVersion" | Set-Content -Path (Join-Path $rcDir "env.txt")

Write-Section "Tests"
pnpm -r test | Tee-Object -FilePath (Join-Path $rcDir "test.log") | Out-Null

Write-Section "Build"
pnpm -r build | Tee-Object -FilePath (Join-Path $rcDir "build.log") | Out-Null

Write-Section "Start server"
$env:PORT = "3333"
$env:HOST = "127.0.0.1"
$env:TRCODER_DB_PATH = (Join-Path $repoRoot ".trcoder\\rc.db")
$serverLog = Join-Path $rcDir "server.log"
$serverErr = Join-Path $rcDir "server.err.log"
$serverProc = Start-Process -FilePath $nodeExe -ArgumentList "packages/server/dist/index.js" -WorkingDirectory $repoRoot -PassThru -RedirectStandardOutput $serverLog -RedirectStandardError $serverErr

Write-Host "Waiting for server..."
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  try {
    $headers = @{ Authorization = "Bearer dev" }
    Invoke-RestMethod -Uri "http://127.0.0.1:3333/v1/whoami" -Headers $headers | Out-Null
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
& $nodeExe "packages/cli/dist/index.js" connect --server "http://127.0.0.1:3333" --api-key "dev" | Tee-Object -FilePath (Join-Path $rcDir "connect.log") | Out-Null

Write-Section "Secret file + permissions override"
$secretPath = Join-Path $env:TEMP "trcoder-rc-secret.txt"
@"
API_KEY=supersecret
password=demo
AKIA1234567890ABCD12
"@ | Set-Content -Path $secretPath -Encoding UTF8

$permissionsOverride = @{
  allow = @(
    "git worktree add*",
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

$logWriter = New-Object System.IO.StreamWriter($cliLog, $false)
$logWriter.AutoFlush = $true

$handler = {
  param($sender, $args)
  if ($args.Data) {
    $line = $args.Data
    $logWriter.WriteLine($line)
    if ($line -match "Run started:\\s+(\\S+)") {
      $script:runId = $Matches[1]
    }
  }
}

$proc.add_OutputDataReceived($handler)
$proc.add_ErrorDataReceived($handler)
$proc.BeginOutputReadLine()
$proc.BeginErrorReadLine()

$commands = @(
  @{ cmd = "/init"; wait = 2 },
  @{ cmd = "/pins add @$secretPath"; wait = 1 },
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
    $proc.StandardInput.WriteLine($entry.cmd)
    Start-Sleep -Seconds 1
    if ($entry.followups) {
      foreach ($resp in $entry.followups) {
        $proc.StandardInput.WriteLine($resp)
        Start-Sleep -Seconds 1
      }
    }
    if ($entry.cmd -like "/start*") {
      $deadline = (Get-Date).AddSeconds(20)
      while (-not $script:runId -and (Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 1
      }
      if ($script:runId -and -not $script:sseCaptured) {
        $script:sseCaptured = $true
        $sseLog = Join-Path $rcDir "sse.log"
        $client = New-Object System.Net.Http.HttpClient
        $req = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Get, "http://127.0.0.1:3333/v1/runs/$($script:runId)/stream")
        $req.Headers.Add("Authorization", "Bearer dev")
        $resp = $client.SendAsync($req, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).Result
        $stream = $resp.Content.ReadAsStreamAsync().Result
        $reader = New-Object System.IO.StreamReader($stream)
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $sseWriter = New-Object System.IO.StreamWriter($sseLog, $false)
        while ($sw.Elapsed.TotalSeconds -lt 6) {
          $lineTask = $reader.ReadLineAsync()
          if (-not $lineTask.Wait(1000)) { continue }
          $line = $lineTask.Result
          if ($line -eq $null) { break }
          $sseWriter.WriteLine($line)
        }
        $sseWriter.Close()
        $reader.Close()
        $client.Dispose()
      }
    }
    Start-Sleep -Seconds $entry.wait
  }
} catch {
  $_ | Out-String | Set-Content -Path (Join-Path $rcDir "cli-runbook.err") -Encoding UTF8
  throw
}

Start-Sleep -Seconds 5
$logWriter.Flush()

try {
  $proc.Kill()
} catch {}

$logWriter.Close()

Write-Section "Collect artifacts"
$configPath = Join-Path $env:USERPROFILE ".trcoder\\cli.json"
$cliConfig = Get-Content $configPath -Raw | ConvertFrom-Json
$runId = $cliConfig.last_run_id
$packId = $cliConfig.last_context_pack.pack_id

# ledger.jsonl
$ledger = Invoke-RestMethod -Uri "http://127.0.0.1:3333/v1/ledger/export" -Headers @{ Authorization = "Bearer dev" }
$ledger | Set-Content -Path (Join-Path $rcDir "ledger.jsonl") -Encoding UTF8

# invoice preview
$invoice = Invoke-RestMethod -Uri "http://127.0.0.1:3333/v1/invoice/preview" -Headers @{ Authorization = "Bearer dev" }
$invoice | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $rcDir "invoice-preview.json") -Encoding UTF8

# logs tail
$logs = Invoke-RestMethod -Uri "http://127.0.0.1:3333/v1/logs/tail?run_id=$runId" -Headers @{ Authorization = "Bearer dev" }
$logs | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $rcDir "logs-tail.txt") -Encoding UTF8

# ctx redaction report
$body = @{ path = $secretPath } | ConvertTo-Json
$ctx = Invoke-RestMethod -Uri "http://127.0.0.1:3333/v1/packs/$packId/read" -Method Post -Headers @{ Authorization = "Bearer dev"; "Content-Type" = "application/json" } -Body $body
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
$doctorLines = Select-String -Path $cliLog -Pattern "^storage\\.|^server\\.connectivity|^runner\\.ws|^config\\.path|^file\\.permissions" | ForEach-Object { $_.Line }
$doctorLines | Set-Content -Path $doctorPath -Encoding UTF8

Write-Section "Shutdown server"
try { $serverProc.Kill() } catch {}

Write-Host "RC artifacts: $rcDir"
