$repoRoot = "C:\Users\ixayl\Desktop\trcoder"
$nodeExe = "C:\Users\ixayl\Desktop\trcoder\.trcoder\node-v20.11.1\node-v20.11.1-win-x64\node.exe"
$secretPath = "C:\Users\ixayl\AppData\Local\Temp\trcoder-rc-secret.txt"
$rcDir = "C:\Users\ixayl\Desktop\trcoder\artifacts\rc-20260131-135524"

$cliLog = Join-Path $rcDir "cli.log"
$cliErr = Join-Path $rcDir "cli.err.log"

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
foreach ($entry in $commands) {
  $proc.StandardInput.WriteLine($entry.cmd)
  Start-Sleep -Seconds 1
  if ($entry.followups) {
    foreach ($resp in $entry.followups) {
      $proc.StandardInput.WriteLine($resp)
      Start-Sleep -Seconds 1
    }
  }
  Start-Sleep -Seconds $entry.wait
}

Start-Sleep -Seconds 5
try { $proc.Kill() } catch {}
$proc.WaitForExit()

$stdout = $proc.StandardOutput.ReadToEnd()
$stderr = $proc.StandardError.ReadToEnd()
$stdout | Set-Content -Path $cliLog -Encoding UTF8
$stderr | Set-Content -Path $cliErr -Encoding UTF8

