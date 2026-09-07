@echo off
REM ============================================================================
REM  CodeNotes - a VDX product  |  one-click Windows launcher
REM  Boots the local Whisper STT server + the web app, then opens your browser.
REM  Usage:  double-click  start-codenotes.bat   (after running install.bat once)
REM ============================================================================
setlocal
set "PYTHON=%USERPROFILE%\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe"
if not exist "%PYTHON%" (
  echo [!] Hermes venv not found. Trying a local venv...
  set "PYTHON=.venv\Scripts\python.exe"
  if not exist "%PYTHON%" (
    echo [X] No python found. Run install.bat first, or install Python + deps.
    pause
    exit /b 1
  )
)
set "DIR=%~dp0"
echo [I] Starting local Whisper STT on http://localhost:8010 ...
start "CodeNotes-Whisper" cmd /k ""%PYTHON%" "%DIR%local_stt_server.py" --port 8010"

echo [I] Starting CodeNotes web app on http://localhost:8741 ...
start "CodeNotes-App" cmd /k ""%PYTHON%" -m http.server 8741 --directory "%DIR%""

timeout /t 4 >nul
echo [I] Opening browser...
start "" "http://localhost:8741"
echo.
echo CodeNotes running:
echo   App:  http://localhost:8741
echo   STT:  http://localhost:8010/v1/audio/transcriptions
echo Set the STT endpoint in Settings to point at the local Whisper server.
echo Close the two "cmd" windows to stop.
pause
