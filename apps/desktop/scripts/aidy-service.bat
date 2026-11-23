@echo off
set AIDY_HOME=%USERPROFILE%\.config\aidy
if exist "%AIDY_HOME%\.env" call "%AIDY_HOME%\.env"
start /B "" node "%USERPROFILE%\.config\aidy\..\..\apps\server\dist\index.js"