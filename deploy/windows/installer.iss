#define AppName "BizTracker"
#define AppPublisher "Cebu DigiBox"
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef StageDir
  #error "StageDir define is required"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\release\installer"
#endif

[Setup]
AppId={{4DD1EFCF-9D7D-49B4-A55C-94139A39FAD1}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
WizardStyle=modern
Compression=lzma
SolidCompression=yes
OutputDir={#OutputDir}
OutputBaseFilename=biztracker-setup-{#AppVersion}
SetupLogging=yes
ChangesEnvironment=no

[Dirs]
Name: "{app}\logs"
Name: "{commonappdata}\BizTracker\logs"

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\launch-app.cmd"; WorkingDir: "{app}"
Name: "{commondesktop}\{#AppName}"; Filename: "{app}\launch-app.cmd"; WorkingDir: "{app}"

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\install-db.ps1"" -AppDir ""{app}"""; StatusMsg: "Configuring local database and runtime..."; Flags: runhidden waituntilterminated
Filename: "{app}\launch-app.cmd"; Description: "Launch {#AppName}"; Flags: postinstall nowait skipifsilent unchecked

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\uninstall-db.ps1"""; RunOnceId: "RemoveGCashPosLocalMariaDB"; Flags: runhidden waituntilterminated
