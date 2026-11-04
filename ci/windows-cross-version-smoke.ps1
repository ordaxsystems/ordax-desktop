param(
  [Parameter(Mandatory=$true)][string]$ExpectedOsSha,
  [Parameter(Mandatory=$true)][string]$ExpectedDesktopSha,
  [Parameter(Mandatory=$true)][string]$ExpectedBaselineOsSha
)
$ErrorActionPreference = 'Stop'
# This test intentionally registers and upgrades a per-user NSIS app.
# Run ONLY on an ephemeral GitHub-hosted Windows runner, never on a
# developer's Windows installation or authorized Remote Desktop session.
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_OS -cne 'Windows' -or
    -not $env:RUNNER_TEMP -or -not $env:GITHUB_RUN_ID) {
  throw 'Cross-version installer proof requires an ephemeral Windows CI runner'
}
foreach ($sha in @($ExpectedOsSha,$ExpectedDesktopSha,$ExpectedBaselineOsSha)) {
  if ($sha -cnotmatch '^[0-9a-f]{40}$') { throw 'Invalid expected source SHA' }
}
$root = Join-Path $env:RUNNER_TEMP 'ordax-desktop-cross-version-proof'
$baseline = Join-Path $root 'baseline.exe'
$candidate = Join-Path $root 'candidate.exe'
$dest = Join-Path $root 'isolated-install'
if (-not (Test-Path -LiteralPath $baseline -PathType Leaf) -or
    -not (Test-Path -LiteralPath $candidate -PathType Leaf) -or
    (Test-Path -LiteralPath $dest)) {
  throw 'CI-proven NSIS binaries missing or installation target already exists'
}
$stagedEvidence = 'resources\runtime-template\docs\evidence\desktop-stage-manifest.json'
$compiledReceipt = 'resources\runtime-template\desktop-assets\source-provenance.json'
$installedBinary = 'OrdaX OS Desktop Dev.exe'
function Assert-Installed([string]$owner,[string]$expectedOsSha,[string]$expectedDesktopSha) {
  $exe = Join-Path $dest $installedBinary
  $asar = Join-Path $dest 'resources\app.asar'
  foreach ($path in @($exe,$asar,
      (Join-Path $dest $stagedEvidence),(Join-Path $dest $compiledReceipt))) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw "Missing installed NSIS product material"
    }
  }
  $receipt = Get-Content -LiteralPath (Join-Path $dest $stagedEvidence) -Raw | ConvertFrom-Json
  $native = Get-Content -LiteralPath (Join-Path $dest $compiledReceipt) -Raw | ConvertFrom-Json
  if ($receipt.schema -cne 'ordax.desktop-standalone-stage/1' -or
      $receipt.runtime_owner -cne 'ordaxsystems/ordax-os' -or
      $receipt.product_owner -cne $owner -or
      $receipt.os_sha -cne $expectedOsSha -or
      $native.os_sha -cne $expectedOsSha) {
    throw 'Installed NSIS bytes do not attest expected owner and OS'
  }
  if ($owner -ceq 'ordaxsystems/ordax-desktop') {
    if ($receipt.desktop_owner -cne $owner -or
        $receipt.desktop_sha -cne $expectedDesktopSha -or
        $receipt.source_authority -cne 'ordaxsystems/ordax-desktop/package.json') {
      throw 'New NSIS does not contain exact Desktop owner source'
    }
  } elseif ($receipt.desktop_owner -or
      $receipt.source_authority -cne 'tools/windows-desktop/package.json') {
    throw 'Legacy OS-owned NSIS receipt is not intact'
  }
  return (Get-FileHash -LiteralPath $asar -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Install-NSIS([string]$file,[string]$phase) {
  $process = $null
  try {
    $process = Start-Process -FilePath $file -ArgumentList ("/S /D=" + $dest) -PassThru
    if (-not $process.WaitForExit(300000)) {
      throw "NSIS $phase exceeded five-minute hard gate"
    }
    if ($process.ExitCode -ne 0) { throw "NSIS $phase failed" }
    Write-Output "NSIS_TRANSITION=$phase EXIT=0"
  } finally {
    if ($process) {
      $process.Refresh()
      if (-not $process.HasExited) {
        & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
      }
    }
  }
}
try {
  Install-NSIS $baseline 'baseline'
  $baselineHash = Assert-Installed 'ordaxsystems/ordax-os' $ExpectedBaselineOsSha ''
  # Test that in-place NSIS upgrade does not erase an unmanaged local file.
  # Real userData is stored outside the install directory and is never read.
  $marker = Join-Path $dest 'ordax-upgrade-owned-marker.txt'
  Set-Content -LiteralPath $marker -Value 'preserve-installed-state' -Encoding ascii
  Install-NSIS $candidate 'upgrade'
  $candidateHash = Assert-Installed 'ordaxsystems/ordax-desktop' $ExpectedOsSha $ExpectedDesktopSha
  if ($baselineHash -ceq $candidateHash) {
    throw 'Cross-version NSIS upgrade kept the legacy Electron app.asar'
  }
  if ((Get-Content -LiteralPath $marker -Raw).Trim() -cne 'preserve-installed-state') {
    throw 'NSIS upgrade deleted a pre-existing local marker'
  }
  Write-Output 'OS_TO_DESKTOP_NSIS_UPGRADE=PASS'
  Install-NSIS $baseline 'rollback'
  $rollbackHash = Assert-Installed 'ordaxsystems/ordax-os' $ExpectedBaselineOsSha ''
  if ($rollbackHash -cne $baselineHash) {
    throw 'In-place rollback did not restore the exact baseline Electron bytes'
  }
  if ((Get-Content -LiteralPath $marker -Raw).Trim() -cne 'preserve-installed-state') {
    throw 'NSIS rollback deleted the local marker'
  }
  Write-Output 'DESKTOP_TO_OS_NSIS_ROLLBACK=PASS'
} finally {
  if ($dest.StartsWith($root + [IO.Path]::DirectorySeparatorChar,
       [System.StringComparison]::OrdinalIgnoreCase) -and
      (Test-Path -LiteralPath $dest)) {
    Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue
  }
}
