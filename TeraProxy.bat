@setlocal enableextensions
@cd /d "%~dp0/bin/lib"

WHERE node > NUL 2> NUL
IF %ERRORLEVEL% NEQ 0 (
  ECHO Node.js is not installed. Please go to the #proxy channel of https://discord.gg/maqBmJV and follow the installation guide.
  PAUSE
) ELSE (
  START cmd.exe /k "node index.js"
)
