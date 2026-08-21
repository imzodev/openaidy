@echo off
set OPENAIDY_HOME=%USERPROFILE%\.config\openaidy
if exist "%OPENAIDY_HOME%\.env" call "%OPENAIDY_HOME%\.env"
start /B "" node "%USERPROFILE%\.config\openaidy\..\..\apps\server\dist\index.js"