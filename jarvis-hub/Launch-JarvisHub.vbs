Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
hubDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = hubDir
sakuraExe = hubDir & "\runtime\BlackSakuraJarvisHub.exe"
legacyExe = hubDir & "\runtime\JarvisHub.exe"
If fso.FileExists(sakuraExe) Then
    targetExe = sakuraExe
ElseIf fso.FileExists(legacyExe) Then
    targetExe = legacyExe
Else
    targetExe = hubDir & "\node_modules\electron\dist\electron.exe"
End If
WshShell.Run """" & targetExe & """ .", 0, False
