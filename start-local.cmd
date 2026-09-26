@echo off
rem Starts Uhandisi School on this PC: the API (port 8090) and the website (port 5180).
rem Needs: XAMPP MySQL running, Node.js installed. Settings live in artifacts\api-server\.env
cd /d "%~dp0"

rem MySQL (XAMPP) must be listening on 3306.
rem (findstr, not find: Git for Windows can put a Unix "find" first on PATH.)
netstat -an | %SystemRoot%\System32\findstr.exe /R /C:":3306 .*LISTENING" >nul
if errorlevel 1 (
  echo MySQL is not running. Open the XAMPP Control Panel and click Start next to MySQL, then run this again.
  pause
  exit /b 1
)

rem First run only: install packages.
if not exist node_modules (
  echo Installing packages, this takes a minute...
  call npx -y pnpm@10 install
)

rem Minimized: clicking inside a console window pauses the program running in it.
start "Uhandisi API - keep open, do not click inside" /min cmd /k "cd /d %~dp0artifacts\api-server && set NODE_ENV=development&& node build.mjs && node --env-file-if-exists=.env --enable-source-maps dist\index.mjs"
start "Uhandisi Website - keep open, do not click inside" /min cmd /k "cd /d %~dp0artifacts\uhandisi-school && set PORT=5180&& set BASE_PATH=/&& set API_URL=http://localhost:8090&& npx vite --config vite.config.ts"

echo Starting... two minimized windows run the app (close them to stop it).
echo The site will open in your browser in a few seconds.
ping -n 9 127.0.0.1 >nul
start "" http://localhost:5180
