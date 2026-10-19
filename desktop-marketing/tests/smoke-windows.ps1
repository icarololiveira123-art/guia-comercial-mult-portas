$ErrorActionPreference = 'Stop'
$exe = Join-Path $PSScriptRoot '../release/Marketing-Diario-Mult-Portas-1.0.1-Windows.exe'
if (!(Test-Path $exe)) { throw 'O executável portátil não foi gerado.' }
$process = Start-Process -FilePath $exe -PassThru
try {
  $window = $null
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 750
    $window = Get-Process | Where-Object { $_.MainWindowTitle -eq 'Marketing Diário | Mult Portas' } | Select-Object -First 1
    if ($window -and $window.MainWindowHandle -ne 0) { break }
  }
  if (!$window -or $window.MainWindowHandle -eq 0) { throw 'A janela do aplicativo portátil não abriu no Windows.' }
  Write-Output 'PASS: o .exe portátil abriu a janela nativa do aplicativo no Windows.'
  $null = $window.CloseMainWindow()
  if (!$window.WaitForExit(15000)) { $window.Kill(); throw 'O aplicativo não encerrou normalmente.' }
} finally {
  Get-Process | Where-Object { $_.ProcessName -eq 'Marketing Diário - Mult Portas' } | Stop-Process -Force -ErrorAction SilentlyContinue
  if (!$process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
}
