@echo off
REM ============================================================================
REM  CodeNotes - a VDX product  |  dependency installer (browser product)
REM  CodeNotes IS a web app that runs in Chrome - there is no .exe to build.
REM  This script only provisions a local Python venv for the OPTIONAL live
REM  Whisper transcription helper. The core app needs nothing installed.
REM ============================================================================
setlocal
set "PYTHON=python"
echo.
echo =====================================================================
echo   CodeNotes installer - a VDX product
echo =====================================================================
echo   CodeNotes is a web app that runs in your browser. No installer needed.
echo   This step is ONLY for the optional live voice transcription helper.
echo =====================================================================

where "%PYTHON%" >nul 2>nul || (
  echo [X] Python 3 not found. Install Python from python.org and re-run,
  echo     or skip this - the app works fully without live voice.
  pause & exit /b 1
)

REM Create (or reuse) a local venv.
set "TARGET_PY=.venv\Scripts\python.exe"
if not exist "%TARGET_PY%" (
  echo [I] Creating local venv...
  "%PYTHON%" -m venv .venv || ( echo [X] venv creation failed. & pause & exit /b 1 )
)

echo [I] Ensuring STT dependencies (fastapi, uvicorn, av, numpy, faster-whisper)...
"%TARGET_PY%" -c "import fastapi, uvicorn, av, numpy, faster_whisper" 2>nul || (
  echo [I] Installing deps (downloads faster-whisper weights on first run too)...
  "%TARGET_PY%" -m pip install --upgrade pip >nul
  "%TARGET_PY%" -m pip install fastapi "uvicorn[standard]" av numpy "faster-whisper" >nul || (
    echo [X] Deps install failed. Check internet and retry.
    pause & exit /b 1
  )
)

echo.
echo [OK] Live voice helper ready. Run  start-codenotes.bat  to launch the app.
echo     (The web app needs no install - just open the served URL in Chrome.)
pause
