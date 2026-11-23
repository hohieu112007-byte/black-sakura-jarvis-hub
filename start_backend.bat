@echo off
setlocal
cd /d "%~dp0"

set "PY_EXE=python"
if exist "%~dp0.venv\Scripts\python.exe" (
  set "PY_EXE=%~dp0.venv\Scripts\python.exe"
) else if exist "%~dp0venv\Scripts\python.exe" (
  set "PY_EXE=%~dp0venv\Scripts\python.exe"
) else if exist "%LOCALAPPDATA%\Programs\Python\Python313\python.exe" (
  set "PY_EXE=%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
) else if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
  set "PY_EXE=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
) else if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" (
  set "PY_EXE=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
) else if exist "%LOCALAPPDATA%\Programs\Python\Python310\python.exe" (
  set "PY_EXE=%LOCALAPPDATA%\Programs\Python\Python310\python.exe"
)

set "OLLAMA_EXE="
where ollama >nul 2>nul && set "OLLAMA_EXE=ollama"
if not defined OLLAMA_EXE if exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" (
  set "OLLAMA_EXE=%LOCALAPPDATA%\Programs\Ollama\ollama.exe"
)
if not defined OLLAMA_EXE if exist "%ProgramFiles%\Ollama\ollama.exe" (
  set "OLLAMA_EXE=%ProgramFiles%\Ollama\ollama.exe"
)

if defined OLLAMA_EXE (
  curl -s http://127.0.0.1:11434/api/tags >nul 2>nul
  if not %errorlevel%==0 (
    echo [Black Sakura Jarvis-Hub] Starting Ollama serve in background...
    start "" /B "%OLLAMA_EXE%" serve >nul 2>nul
    timeout /t 2 /nobreak >nul
  )
) else (
  echo [Black Sakura Jarvis-Hub] Ollama not detected - Tier 1 Fast-Path and optional Cloud API mode remain available.
)

echo [Black Sakura Jarvis-Hub] Starting FastAPI Server on http://127.0.0.1:8765 ...
"%PY_EXE%" -m uvicorn backend.server:app --host 127.0.0.1 --port 8765
endlocal
