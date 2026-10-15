$ErrorActionPreference = 'Stop'
$exe = Join-Path $PSScriptRoot '../release/Recorta-Planta-Windows.exe'
if (!(Test-Path $exe)) { throw 'O executável portátil não foi gerado.' }
$process = Start-Process -FilePath $exe -PassThru
try {
  $window = $null
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    Start-Sleep -Milliseconds 750
    $window = Get-Process | Where-Object { $_.MainWindowTitle -eq 'Recorta Planta' } | Select-Object -First 1
    if ($window -and $window.MainWindowHandle -ne 0) { break }
  }
  if (!$window -or $window.MainWindowHandle -eq 0) { throw 'A janela do Recorta Planta não abriu no Windows.' }
  Write-Output 'PASS: o executável portátil abriu sua janela no Windows.'
  $null = $window.CloseMainWindow()
  Start-Sleep -Seconds 2
} finally {
  Get-Process -Name RecortaPlanta -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  if (!$process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
}
