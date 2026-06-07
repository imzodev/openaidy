!macro customInstall
  ; Install the service wrapper script
  File /nonfatal "scripts\openaidy-service.bat"

  ; Create config directory
  CreateDirectory "$APPDATA\openaidy"

  ; Write a default .env file pointing to sqlite
  FileOpen $0 "$APPDATA\openaidy\.env" w
  FileWrite $0 "DB_KIND=sqlite$\r$\n"
  FileWrite $0 "OPENAIDY_HOME=$APPDATA\openaidy$\r$\n"
  FileClose $0

  ; Register scheduled task for auto-start
  nsExec::ExecToLog 'schtasks /Create /TN OpenAidy /TR "$INSTDIR\openaidy-service.bat" /SC ONLOGON /F'
!macroend

!macro customUnInstall
  ; Remove scheduled task
  nsExec::ExecToLog 'schtasks /Delete /TN OpenAidy /F'

  ; Optionally remove user data (ask first)
  MessageBox MB_YESNO "Remove OpenAidy data and settings?" IDNO +2
    RMDir /r "$APPDATA\openaidy"
!macroend