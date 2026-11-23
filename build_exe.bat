@echo off
setlocal
cd /d "%~dp0jarvis-hub"

echo [Black Sakura Jarvis-Hub] Step 1/2: Building React HUD...
call npm run build
if not %errorlevel%==0 exit /b %errorlevel%

echo [Black Sakura Jarvis-Hub] Step 2/2: Packaging standalone BlackSakuraJarvisHub.exe...
node scripts\package-exe.mjs
if not %errorlevel%==0 exit /b %errorlevel%

echo.
echo [DONE] Portable executable and single downloadable ZIP pack created:
echo   EXE: %~dp0dist-exe\Black-Sakura-Jarvis-Hub\BlackSakuraJarvisHub.exe
echo   ZIP: %~dp0dist-exe\Black-Sakura-Jarvis-Hub-v1.0.0-Windows-Portable.zip
endlocal
