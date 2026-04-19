Set shell = CreateObject("WScript.Shell")
scriptPath = Chr(34) & Replace(WScript.ScriptFullName, ".vbs", ".cmd") & Chr(34)
shell.Run scriptPath, 0, False
