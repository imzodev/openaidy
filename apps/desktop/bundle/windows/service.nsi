; openaidy.nsi — NSIS installer snippet for Windows service registration
; This file is included by the main installer .nsi script

; Register OpenAidy as a scheduled task that runs at logon
!macro CUSTOM_INSTALL
  ; Create the scheduled task using schtasks
  NSExec::ExecToLog 'schtasks /Create /TN "OpenAidy" /TR "$INSTDIR\openaidy-service.bat" /SC ONLOGON /F'
!macroend

!macro CUSTOM_UNINSTALL
  ; Remove the scheduled task
  NSExec::ExecToLog 'schtasks /Delete /TN "OpenAidy" /F'
!macroend