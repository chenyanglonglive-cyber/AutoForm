@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$portOpen = $false; " ^
  "try { $portOpen = [bool](Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 3000 -State Listen -ErrorAction Stop) } catch { $portOpen = $false }; " ^
  "if (-not $portOpen) { Start-Process -FilePath 'D:\node.js\npm.cmd' -ArgumentList 'start' -WorkingDirectory (Get-Location).Path -WindowStyle Minimized }; " ^
  "Start-Sleep -Seconds 2; " ^
  "Start-Process 'http://127.0.0.1:3000/'"

endlocal
