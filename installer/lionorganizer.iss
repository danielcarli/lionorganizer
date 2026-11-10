; LionOrganizer - Copyright (C) 2026 LionOrganizer Team.
; Created and conceived by Daniel Michelon De Carli.
; Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
;
; Graphical installer for Windows (Inno Setup 6.5 or newer), built like the LEBR installer: it does not carry the
; app. During setup it runs install.ps1 -AssembleTo, which downloads the latest release from GitHub, checks every
; file (SHA-256 for the release files, Electron's own checksums for the runtime) and assembles LionOrganizer in a
; temporary folder. The assembled files are then installed like with any installer.
;
; Build:  iscc /DAppVersion=1.1.6 installer\lionorganizer.iss    (creates dist-installer\LionOrganizer-Setup.exe)
; The release workflow builds it on every v* tag. Signing (recommended once there is a certificate): define a
; SignTool with the code-signing certificate and uncomment SignTool= below.

#define AppName "LionOrganizer"
#define Repo "danielcarli/lionorganizer"
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{3DB12C40-AF27-4CC9-93C6-10C9EB0AA79B}
AppName={#AppName}
AppVersion={code:AssembledVersion}
AppVerName={#AppName}
AppPublisher=LionOrganizer Team
AppPublisherURL=https://github.com/{#Repo}
AppSupportURL=https://github.com/{#Repo}/issues
AppUpdatesURL=https://github.com/{#Repo}/releases
AppCopyright=Copyright (C) 2026 LionOrganizer Team - GPL-3.0-or-later
AppComments=Created and conceived by Daniel Michelon De Carli
VersionInfoVersion={#AppVersion}
VersionInfoDescription=LionOrganizer setup (installs the latest version from GitHub)
VersionInfoProductName={#AppName}
; per-user install, no administrator rights - the same folder as the VS Code user setup and install.ps1
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\{#AppName}
DisableDirPage=yes
DisableProgramGroupPage=yes
UsePreviousAppDir=no
ArchitecturesAllowed=x64compatible or arm64
ArchitecturesInstallIn64BitMode=x64compatible or arm64
MinVersion=10.0.17763
LicenseFile=..\LICENSE
ShowLanguageDialog=auto
SetupIconFile=..\build\icon.ico
WizardSmallImageFile=..\build\icons\64x64.png,..\build\icons\128x128.png
UninstallDisplayIcon={app}\LionOrganizer.exe
UninstallDisplayName={#AppName}
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
CloseApplications=force
RestartApplications=no
SetupLogging=yes
OutputDir=..\dist-installer
OutputBaseFilename=LionOrganizer-Setup
; SignTool=signing

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"; InfoBeforeFile: "info\en.txt"
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"; InfoBeforeFile: "info\pt-BR.txt"
Name: "portuguese"; MessagesFile: "compiler:Languages\Portuguese.isl"; InfoBeforeFile: "info\pt-PT.txt"
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"; InfoBeforeFile: "info\es.txt"
Name: "french"; MessagesFile: "compiler:Languages\French.isl"; InfoBeforeFile: "info\fr.txt"
Name: "german"; MessagesFile: "compiler:Languages\German.isl"; InfoBeforeFile: "info\de.txt"
Name: "italian"; MessagesFile: "compiler:Languages\Italian.isl"; InfoBeforeFile: "info\it.txt"
Name: "chinesesimplified"; MessagesFile: "languages\ChineseSimplified.isl"; InfoBeforeFile: "info\zh-CN.txt"
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"; InfoBeforeFile: "info\ja.txt"
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"; InfoBeforeFile: "info\ko.txt"

[CustomMessages]
english.AppComment=Disk space analysis & cleanup
brazilianportuguese.AppComment=Análise e limpeza de espaço em disco
portuguese.AppComment=Análise e limpeza de espaço em disco
spanish.AppComment=Análisis y limpieza de espacio en disco
french.AppComment=Analyse et nettoyage de l’espace disque
german.AppComment=Speicherplatz analysieren und aufräumen
italian.AppComment=Analisi e pulizia dello spazio su disco
chinesesimplified.AppComment=磁盘空间分析与清理
japanese.AppComment=ディスク容量の分析とクリーンアップ
korean.AppComment=디스크 공간 분석 및 청소

english.UpdateShortcut=Update LionOrganizer
brazilianportuguese.UpdateShortcut=Atualizar o LionOrganizer
portuguese.UpdateShortcut=Atualizar o LionOrganizer
spanish.UpdateShortcut=Actualizar LionOrganizer
french.UpdateShortcut=Mettre à jour LionOrganizer
german.UpdateShortcut=LionOrganizer aktualisieren
italian.UpdateShortcut=Aggiorna LionOrganizer
chinesesimplified.UpdateShortcut=更新 LionOrganizer
japanese.UpdateShortcut=LionOrganizer を更新
korean.UpdateShortcut=LionOrganizer 업데이트

english.UpdateComment=Downloads and installs the latest LionOrganizer version published on GitHub
brazilianportuguese.UpdateComment=Baixa e instala a última versão do LionOrganizer publicada no GitHub
portuguese.UpdateComment=Transfere e instala a última versão do LionOrganizer publicada no GitHub
spanish.UpdateComment=Descarga e instala la última versión de LionOrganizer publicada en GitHub
french.UpdateComment=Télécharge et installe la dernière version de LionOrganizer publiée sur GitHub
german.UpdateComment=Lädt die neueste auf GitHub veröffentlichte Version von LionOrganizer herunter und installiert sie
italian.UpdateComment=Scarica e installa l'ultima versione di LionOrganizer pubblicata su GitHub
chinesesimplified.UpdateComment=下载并安装 GitHub 上发布的最新版 LionOrganizer
japanese.UpdateComment=GitHub で公開されている最新の LionOrganizer をダウンロードしてインストールします
korean.UpdateComment=GitHub에 게시된 최신 LionOrganizer를 내려받아 설치합니다

english.PageCaption=Downloading LionOrganizer
brazilianportuguese.PageCaption=Baixando o LionOrganizer
portuguese.PageCaption=A transferir o LionOrganizer
spanish.PageCaption=Descargando LionOrganizer
french.PageCaption=Téléchargement de LionOrganizer
german.PageCaption=LionOrganizer wird heruntergeladen
italian.PageCaption=Download di LionOrganizer
chinesesimplified.PageCaption=正在下载 LionOrganizer
japanese.PageCaption=LionOrganizer をダウンロードしています
korean.PageCaption=LionOrganizer 내려받는 중

english.PageDescription=The installer downloads the latest version published on GitHub, checks every file and prepares the app. This takes about a minute; please don't close this window.
brazilianportuguese.PageDescription=O instalador baixa a última versão publicada no GitHub, confere cada arquivo e prepara o programa. Isso leva cerca de um minuto; não feche esta janela.
portuguese.PageDescription=O instalador transfere a última versão publicada no GitHub, verifica cada ficheiro e prepara o programa. Demora cerca de um minuto; não feche esta janela.
spanish.PageDescription=El instalador descarga la última versión publicada en GitHub, verifica cada archivo y prepara el programa. Tarda alrededor de un minuto; no cierres esta ventana.
french.PageDescription=L'installateur télécharge la dernière version publiée sur GitHub, vérifie chaque fichier et prépare le programme. Cela prend environ une minute ; ne fermez pas cette fenêtre.
german.PageDescription=Das Installationsprogramm lädt die neueste auf GitHub veröffentlichte Version, prüft jede Datei und bereitet die App vor. Das dauert etwa eine Minute; bitte schließen Sie dieses Fenster nicht.
italian.PageDescription=Il programma di installazione scarica l'ultima versione pubblicata su GitHub, verifica ogni file e prepara l'applicazione. Ci vuole circa un minuto; non chiudere questa finestra.
chinesesimplified.PageDescription=安装程序正在下载 GitHub 上发布的最新版本，校验每个文件并准备应用。大约需要一分钟，请不要关闭此窗口。
japanese.PageDescription=GitHub で公開されている最新バージョンをダウンロードし、すべてのファイルを検証してアプリを準備しています。1 分ほどかかります。このウィンドウを閉じないでください。
korean.PageDescription=GitHub에 게시된 최신 버전을 내려받고 모든 파일을 검증한 뒤 앱을 준비합니다. 약 1분 정도 걸립니다. 이 창을 닫지 마세요.

english.Starting=Starting…
brazilianportuguese.Starting=Iniciando…
portuguese.Starting=A iniciar…
spanish.Starting=Iniciando…
french.Starting=Démarrage…
german.Starting=Wird gestartet …
italian.Starting=Avvio…
chinesesimplified.Starting=正在启动…
japanese.Starting=開始しています…
korean.Starting=시작하는 중…

english.Step1=Looking for the latest version on GitHub…
brazilianportuguese.Step1=Consultando a última versão no GitHub…
portuguese.Step1=A consultar a última versão no GitHub…
spanish.Step1=Buscando la última versión en GitHub…
french.Step1=Recherche de la dernière version sur GitHub…
german.Step1=Neueste Version auf GitHub wird gesucht …
italian.Step1=Ricerca dell'ultima versione su GitHub…
chinesesimplified.Step1=正在 GitHub 上查找最新版本…
japanese.Step1=GitHub で最新バージョンを確認しています…
korean.Step1=GitHub에서 최신 버전을 확인하는 중…

english.Step2=Downloading LionOrganizer and checking its SHA-256…
brazilianportuguese.Step2=Baixando o LionOrganizer e conferindo o SHA-256…
portuguese.Step2=A transferir o LionOrganizer e a verificar o SHA-256…
spanish.Step2=Descargando LionOrganizer y verificando su SHA-256…
french.Step2=Téléchargement de LionOrganizer et vérification du SHA-256…
german.Step2=LionOrganizer wird heruntergeladen und der SHA-256-Wert geprüft …
italian.Step2=Download di LionOrganizer e verifica dello SHA-256…
chinesesimplified.Step2=正在下载 LionOrganizer 并校验 SHA-256…
japanese.Step2=LionOrganizer をダウンロードして SHA-256 を検証しています…
korean.Step2=LionOrganizer를 내려받고 SHA-256을 검증하는 중…

english.Step3=Downloading the official Electron runtime and checking it…
brazilianportuguese.Step3=Baixando o Electron oficial e conferindo…
portuguese.Step3=A transferir o Electron oficial e a verificar…
spanish.Step3=Descargando el entorno oficial de Electron y verificándolo…
french.Step3=Téléchargement de l'environnement Electron officiel et vérification…
german.Step3=Offizielle Electron-Laufzeit wird heruntergeladen und geprüft …
italian.Step3=Download del runtime ufficiale di Electron e verifica…
chinesesimplified.Step3=正在下载官方 Electron 运行时并校验…
japanese.Step3=公式の Electron ランタイムをダウンロードして検証しています…
korean.Step3=공식 Electron 런타임을 내려받고 검증하는 중…

english.Step4=Assembling the app…
brazilianportuguese.Step4=Montando o programa…
portuguese.Step4=A montar o programa…
spanish.Step4=Montando el programa…
french.Step4=Assemblage du programme…
german.Step4=App wird zusammengestellt …
italian.Step4=Assemblaggio dell'applicazione…
chinesesimplified.Step4=正在组装应用…
japanese.Step4=アプリを組み立てています…
korean.Step4=앱을 구성하는 중…

english.VersionSuffix=(version %1)
brazilianportuguese.VersionSuffix=(versão %1)
portuguese.VersionSuffix=(versão %1)
spanish.VersionSuffix=(versión %1)
french.VersionSuffix=(version %1)
german.VersionSuffix=(Version %1)
italian.VersionSuffix=(versione %1)
chinesesimplified.VersionSuffix=（版本 %1）
japanese.VersionSuffix=（バージョン %1）
korean.VersionSuffix=(버전 %1)

english.Failed=LionOrganizer could not be downloaded or verified. Nothing was changed on this computer.
brazilianportuguese.Failed=Não foi possível baixar ou conferir o LionOrganizer. Nada foi alterado neste computador.
portuguese.Failed=Não foi possível transferir ou verificar o LionOrganizer. Nada foi alterado neste computador.
spanish.Failed=No se pudo descargar o verificar LionOrganizer. No se ha cambiado nada en este equipo.
french.Failed=LionOrganizer n'a pas pu être téléchargé ou vérifié. Rien n'a été modifié sur cet ordinateur.
german.Failed=LionOrganizer konnte nicht heruntergeladen oder geprüft werden. Auf diesem Computer wurde nichts geändert.
italian.Failed=Non è stato possibile scaricare o verificare LionOrganizer. Non è stato modificato nulla su questo computer.
chinesesimplified.Failed=无法下载或校验 LionOrganizer。此计算机上未做任何更改。
japanese.Failed=LionOrganizer をダウンロードまたは検証できませんでした。このコンピューターには何も変更されていません。
korean.Failed=LionOrganizer를 내려받거나 검증하지 못했습니다. 이 컴퓨터에는 아무것도 변경되지 않았습니다.

english.ExitCode=PowerShell ended with code %1.
brazilianportuguese.ExitCode=O PowerShell terminou com o código %1.
portuguese.ExitCode=O PowerShell terminou com o código %1.
spanish.ExitCode=PowerShell terminó con el código %1.
french.ExitCode=PowerShell s’est terminé avec le code %1.
german.ExitCode=PowerShell wurde mit Code %1 beendet.
italian.ExitCode=PowerShell è terminato con il codice %1.
chinesesimplified.ExitCode=PowerShell 退出代码为 %1。
japanese.ExitCode=PowerShell はコード %1 で終了しました。
korean.ExitCode=PowerShell이 코드 %1(으)로 종료되었습니다.

english.SeeLog=The full log is in %1
brazilianportuguese.SeeLog=O registro completo está em %1
portuguese.SeeLog=O registo completo está em %1
spanish.SeeLog=El registro completo está en %1
french.SeeLog=Le journal complet se trouve dans %1
german.SeeLog=Das vollständige Protokoll befindet sich in %1
italian.SeeLog=Il registro completo si trova in %1
chinesesimplified.SeeLog=完整日志位于 %1
japanese.SeeLog=詳しいログ: %1
korean.SeeLog=전체 로그 위치: %1

english.Incomplete=The download script ended without finishing (exit code %1).
brazilianportuguese.Incomplete=O script de download terminou sem concluir (código %1).
portuguese.Incomplete=O script de transferência terminou sem concluir (código %1).
spanish.Incomplete=El script de descarga terminó sin completar (código %1).
french.Incomplete=Le script de téléchargement s’est arrêté sans terminer (code %1).
german.Incomplete=Das Download-Skript wurde ohne Abschluss beendet (Code %1).
italian.Incomplete=Lo script di download è terminato senza completare (codice %1).
chinesesimplified.Incomplete=下载脚本未完成即退出（代码 %1）。
japanese.Incomplete=ダウンロード スクリプトが完了せずに終了しました（コード %1）。
korean.Incomplete=다운로드 스크립트가 완료되지 않고 종료되었습니다(코드 %1).

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\scripts\install.ps1"; Flags: dontcopy
; the app assembled by install.ps1 (temporary folder)
Source: "{code:AssembledDir}\*"; DestDir: "{app}"; Flags: external recursesubdirs createallsubdirs ignoreversion
; a copy of this installer, used by the "Update LionOrganizer" shortcut
Source: "{srcexe}"; DestDir: "{localappdata}\LionOrganizer-Installer"; DestName: "LionOrganizer-Setup.exe"; Flags: external ignoreversion; Check: NotRunningFromCopy

[InstallDelete]
; files of the previous version (only Electron/LionOrganizer files, never the whole folder or the unins* uninstaller:
; no wildcard may match unins000.exe / unins000.dat, or every update would leave a new uninstaller behind)
Type: filesandordirs; Name: "{app}\resources"
Type: filesandordirs; Name: "{app}\locales"
Type: files; Name: "{app}\*.dll"
Type: files; Name: "{app}\*.pak"
Type: files; Name: "{app}\*.bin"
Type: files; Name: "{app}\icudtl.dat"
Type: files; Name: "{app}\vk_swiftshader_icd.json"
Type: files; Name: "{app}\version"
Type: files; Name: "{app}\LICENSE*"
Type: files; Name: "{app}\LionOrganizer.exe"
Type: files; Name: "{app}\lionorganizer-install.txt"
; left behind by an earlier install made with install.ps1
Type: files; Name: "{app}\install.ps1"

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\LionOrganizer.exe"; Comment: "{cm:AppComment}"
Name: "{autoprograms}\{cm:UpdateShortcut}"; Filename: "{localappdata}\LionOrganizer-Installer\LionOrganizer-Setup.exe"; Parameters: "/UPDATE"; Comment: "{cm:UpdateComment}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\LionOrganizer.exe"; Comment: "{cm:AppComment}"; Tasks: desktopicon

[Run]
Filename: "{app}\LionOrganizer.exe"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent
; update (/UPDATE, from the shortcut): reopen the app at the end
Filename: "{app}\LionOrganizer.exe"; Flags: nowait; Check: UpdateMode and not WizardSilent

[UninstallDelete]
; the installer copy and its temporary files (the user's settings and catalog are kept)
Type: filesandordirs; Name: "{localappdata}\LionOrganizer-Installer"

[Code]
const
  TOTAL_STEPS = 4;
  SCRIPT_UNINSTALL_KEY = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\LionOrganizer';

var
  ProgressPage: TOutputProgressWizardPage;
  Staging, Version, ErrorText: String;
  Step: Integer;
  Done: Boolean;

function AssembledDir(Param: String): String;
begin
  Result := Staging;
end;

function AssembledVersion(Param: String): String;
begin
  if Version <> '' then Result := Version else Result := '{#AppVersion}';
end;

{ /UPDATE: update from the "Update LionOrganizer" shortcut - skips the first and last pages }
function UpdateMode: Boolean;
var
  I: Integer;
begin
  Result := False;
  for I := 1 to ParamCount do
    if CompareText(ParamStr(I), '/UPDATE') = 0 then Result := True;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := UpdateMode and ((PageID = wpWelcome) or (PageID = wpLicense) or (PageID = wpInfoBefore) or
    (PageID = wpSelectTasks) or (PageID = wpReady) or (PageID = wpFinished));
end;

function NotRunningFromCopy: Boolean;
begin
  Result := CompareText(ExpandConstant('{srcexe}'),
    ExpandConstant('{localappdata}\LionOrganizer-Installer\LionOrganizer-Setup.exe')) <> 0;
end;

function StepText(N: Integer): String;
begin
  case N of
    1: Result := CustomMessage('Step1');
    2: Result := CustomMessage('Step2');
    3: Result := CustomMessage('Step3');
    4: Result := CustomMessage('Step4');
  else
    Result := CustomMessage('Starting');
  end;
  if Version <> '' then Result := Result + '   ' + FmtMessage(CustomMessage('VersionSuffix'), [Version]);
end;

{ receives the output of install.ps1 line by line: "@@STEP|n|total|text", "@@VERSION|x.y.z", "@@DONE", "@@ERROR|text" }
procedure OnOutputLine(const S: String; const Error, FirstLine: Boolean);
var
  Rest: String;
  P: Integer;
begin
  if Error then
  begin
    Log('Could not read the output: ' + S);
    Exit;
  end;
  Log(S);
  if Copy(S, 1, 7) = '@@STEP|' then
  begin
    Rest := Copy(S, 8, Length(S));
    P := Pos('|', Rest);
    if P > 0 then Step := StrToIntDef(Copy(Rest, 1, P - 1), Step);
    ProgressPage.SetText(StepText(Step), '');
    ProgressPage.SetProgress(Step - 1, TOTAL_STEPS);
  end
  else if Copy(S, 1, 10) = '@@VERSION|' then
    Version := Trim(Copy(S, 11, Length(S)))
  else if Trim(S) = '@@DONE' then
    Done := True
  else if Copy(S, 1, 8) = '@@ERROR|' then
    ErrorText := Trim(Copy(S, 9, Length(S)))
  else if Trim(S) <> '' then
    ProgressPage.SetText(StepText(Step), Copy(Trim(S), 1, 120));
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ExitCode: Integer;
  Ok: Boolean;
  PowerShell, Params: String;
begin
  Result := '';
  Version := '';
  ErrorText := '';
  Step := 0;
  Done := False;
  Staging := ExpandConstant('{localappdata}\LionOrganizer-Installer\staging');
  ExtractTemporaryFile('install.ps1');
  ProgressPage := CreateOutputProgressPage(CustomMessage('PageCaption'), CustomMessage('PageDescription'));
  ProgressPage.SetText(CustomMessage('Starting'), '');
  ProgressPage.SetProgress(0, TOTAL_STEPS);
  ProgressPage.Show;
  try
    PowerShell := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
    Params := '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
      ExpandConstant('{tmp}\install.ps1') + '" -AssembleTo "' + Staging + '"';
    try
      Ok := ExecAndLogOutput(PowerShell, Params, ExpandConstant('{tmp}'), SW_HIDE, ewWaitUntilTerminated,
        ExitCode, @OnOutputLine);
    except
      Ok := False;
      ErrorText := GetExceptionMessage;
    end;
    if Ok and (ExitCode = 0) and Done and FileExists(AddBackslash(Staging) + 'LionOrganizer.exe') then
      ProgressPage.SetProgress(TOTAL_STEPS, TOTAL_STEPS)
    else
    begin
      if (ErrorText = '') and Ok and (ExitCode = 0) then
        ErrorText := FmtMessage(CustomMessage('Incomplete'), [IntToStr(ExitCode)])
      else if ErrorText = '' then
        ErrorText := FmtMessage(CustomMessage('ExitCode'), [IntToStr(ExitCode)]);
      Result := CustomMessage('Failed') + #13#10#13#10 + ErrorText + #13#10#13#10 +
        FmtMessage(CustomMessage('SeeLog'), [ExpandConstant('{log}')]);
      DelTree(Staging, True, True, True);
    end;
  finally
    ProgressPage.Hide;
  end;
end;

{ Closes every process started from the app folder (LionOrganizer.exe and Electron's helpers), so that the
  uninstaller can remove all files even if the app is open. Uses .NET only, so it does not depend on any
  PowerShell module. }
procedure StopRunningApp;
var
  Dir, Cmd: String;
  ResultCode: Integer;
begin
  Dir := AddBackslash(ExpandConstant('{app}'));
  StringChangeEx(Dir, '''', '''''', True);
  Cmd := '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "' +
    '[Diagnostics.Process]::GetProcesses() | ForEach-Object { try { if ($_.MainModule.FileName.StartsWith(''' + Dir +
    ''', [StringComparison]::OrdinalIgnoreCase)) { $_.Kill(); $_.WaitForExit(5000) | Out-Null } } catch { } }"';
  Log('Closing processes started from ' + Dir);
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Cmd, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then StopRunningApp;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Location: String;
begin
  if CurStep = ssPostInstall then
  begin
    { the assembled copy is no longer needed }
    DelTree(Staging, True, True, True);
    { an earlier install made with install.ps1 in the same folder: drop its entry in Settings > Apps,
      so only this installer's entry remains }
    if RegQueryStringValue(HKCU, SCRIPT_UNINSTALL_KEY, 'InstallLocation', Location) and
       (CompareText(RemoveBackslashUnlessRoot(Location), RemoveBackslashUnlessRoot(ExpandConstant('{app}'))) = 0) then
      RegDeleteKeyIncludingSubkeys(HKCU, SCRIPT_UNINSTALL_KEY);
  end;
end;
