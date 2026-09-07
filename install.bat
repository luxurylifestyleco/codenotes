@echo off
REM ============================================================================
REM  CodeNotes - a VDX product  |  installer (provisions deps + optional exe)
REM  Creates a local venv, installs the STT + web deps, and (optionally) builds a
REM  standalone code-notes.exe via PyInstaller.
REM ============================================================================
setlocal
set "PYTHON=python"
echo.
echo =====================================================================
echo   CodeNotes installer - a VDX product
echo =====================================================================

REM 1. Find a python to provision a local venv.
where "%PYTHON%" >nul 2>nul || (
  echo [X] Python 3 not found. Install Python from python.org and re-run.
  pause & exit /b 1
)
"%PYTHON%" -c "import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)" >nul 2>nul || (
  echo [X] Python 3.9+ required. Install a newer Python from python.org.
  pause & exit /b 1
)

REM 2. Create (or reuse) a local venv.
set "TARGET_PY=.venv\Scripts\python.exe"
if not exist "%TARGET_PY%" (
  echo [I] Creating local venv...
  "%PYTHON%" -m venv .venv || ( echo [X] venv creation failed. & pause & exit /b 1 )
)

echo [I] Ensuring STT dependencies (fastapi, uvicorn, av, numpy, faster-whisper)...
"%TARGET_PY%" -c "import fastapi, uvicorn, av, numpy, faster_whisper" 2>nul || (
  echo [I] Installing deps (this downloads faster-whisper weights on first run too)...
  "%TARGET_PY%" -m pip install --upgrade pip >nul
  "%TARGET_PY%" -m pip install fastapi "uvicorn[standard]" av numpy "faster-whisper" >nul || (
    echo [X] Failed to install deps. Check internet and retry.
    pause & exit /b 1
  )
)

echo.
echo =====================================================================
echo   Optional: build a standalone code-notes.exe installer?
echo   (Packages the STT server into one exe via PyInstaller.)
echo =====================================================================
choice /c YN /m "Build standalone code-notes.exe now"
if errorlevel 2 (
  echo [I] Skipped exe build. Use start-codenotes.bat to run.
) else (
  echo [I] Installing PyInstaller and building...
  "%TARGET_PY%" -m pip install pyinstaller >nul
  "%TARGET_PY%" -m PyInstaller --onefile --name code-notes "%CD%\local_stt_server.py"
  if exist "dist\code-notes.exe" (
    echo [OK] Built:  dist\code-notes.exe
    echo      Run it to start the Whisper server; then use start-codenotes.bat for the app.
  ) else (
    echo [X] Build failed. Use start-codenotes.bat instead.
  )
)

echo.
echo [OK] CodeNotes is ready. Run  start-codenotes.bat  to launch.
pause
