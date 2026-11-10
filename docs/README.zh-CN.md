<div align="center">

<img src="../src/workbench/browser/media/logo.svg" width="96" height="96" alt="LionOrganizer 徽标">

# LionOrganizer

**适用于 Windows 的磁盘空间分析与清理工具。**<br>
查看文件夹中是什么占用了空间，按内容找出真正的重复文件，并安全地释放不再需要的空间。

<sub>由 <b>LionOrganizer Team</b> 开发 · 由 <b>Daniel Michelon De Carli</b> 创建和构思</sub>

[English](../README.md) · [Português (Brasil)](README.pt-BR.md) · [Português (Portugal)](README.pt-PT.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Italiano](README.it.md) · **简体中文** · [日本語](README.ja.md) · [한국어](README.ko.md)

![Version 1.0.0](https://img.shields.io/badge/version-1.0.0-161214)
![许可证：GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-d4145a)
![平台：Windows](https://img.shields.io/badge/platform-Windows-161214)
![Electron](https://img.shields.io/badge/Electron-45-f4a30c)
![界面语言：10 种](https://img.shields.io/badge/UI%20languages-10-0a8bb5)

<img src="screenshots/i18n/overview-zh-CN.png" alt="LionOrganizer 概览：按文件类型划分的空间、最大的文件夹和文件" width="900">

</div>

## 为什么选择 LionOrganizer？

磁盘分析工具会告诉你*什么*占用了大量空间。LionOrganizer 还能帮你判断*哪些可以删除*——并确保不会误删任何文件。它源于一个非常具体的问题：建筑和设计项目会不断堆积 CAD 备份（`.skb`、`.0001.rvt`、`.bak`）、渲染图、视频以及副本的副本，直到磁盘被占满。

一切都在**本地**运行。无需账户，没有遥测，也不访问网络。

## 功能

| | |
|---|---|
| **分析** | 扫描文件夹及其子文件夹——默认深入 3 层，可设置为最多 50 层或无限制。提供带大小信息的文件夹树、路径导航栏，以及一个可排序、可筛选、列出所有文件的表格。 |
| **可视化** | 按文件类型划分的空间（玫瑰图）、最大的子文件夹（矩形树图）、100 点矩阵（每个点代表 1% 的空间）、占用最多的扩展名以及文件新旧。 |
| **清理** | 按原因分组的建议：SketchUp/Revit/AutoCAD 备份、临时文件、日志、未完成的下载、安装程序、大且旧的文件。 |
| **真正的重复文件** | 使用 SHA-256 比较内容，仅在需要时读取（大小 → 开头/结尾 64 KB → 整个文件）。可选择保留哪个副本；还能看到同一文件是否也存在于索引库中的另一个文件夹（例如备份驱动器）。 |
| **整理** | 将零散文件按类型移入子文件夹，并使用 `{date}-{n}-{name}` 之类的模式批量重命名。始终先预览，并且可以撤消。 |
| **索引库与历史记录** | 本地 SQLite 索引库，保存名称、大小、日期和哈希。可在所有分析过的文件夹中搜索——即使驱动器已断开连接——并比较扫描结果，查看新增、移除或增长的内容。 |
| **10 种语言** | English、Português (Brasil)、Português (Portugal)、Español、Français、Deutsch、Italiano、简体中文、日本語、한국어——自动检测系统语言，可在状态栏中切换。 |
| **浅色与深色** | 自动或手动切换主题，配色方案已针对色觉障碍进行检查。 |

## 安全第一

删错文件比磁盘满了更糟糕，因此 LionOrganizer 在设计上格外谨慎：

- **手动输入确认代码。** 每个会更改文件的操作——*任何*删除（无论一个还是多个文件）、整理、重命名、撤消以及清除索引库——都会显示一个 6 位代码，必须**手动输入**（已禁用粘贴）后按钮才会解锁。代码由主进程生成和校验，因此界面无法绕过。输错五次即取消操作。
- **移到回收站，而非永久删除。** 被删除的文件会进入 Windows 回收站。
- **限定操作范围。** 主进程只处理属于你所分析的文件夹、且在上次扫描中出现过的文件。
- **撤消。** 整理和重命名操作都会被记录，可以在 *索引库 → 最近的操作* 中还原。
- **默认只读。** 分析和检查重复文件绝不会修改任何内容。

<div align="center">
<img src="screenshots/confirmation.png" alt="删除文件前需手动输入确认代码" width="760">
</div>

## 截图

| | |
|---|---|
| ![重复文件](screenshots/duplicates.png) **重复文件**——按 SHA-256 分组的完全相同副本 | ![清理](screenshots/cleanup.png) **清理**——按原因分组的建议 |
| ![整理](screenshots/organize.png) **整理**——按类型整理和批量重命名，带预览 | ![索引库](screenshots/catalog.png) **索引库**——搜索、历史记录和撤消 |
| ![文件](screenshots/files.png) **文件**——所有文件，可排序、可筛选 | ![深色主题](screenshots/overview-dark.png) **深色主题** |

除页首截图外，其余截图显示的是英文界面。

<div align="center">
<img src="screenshots/languages.png" alt="十种语言的界面" width="900">
<br><sub>同一界面在十种受支持语言中的显示效果。</sub>
</div>

## 快速上手

### 从源代码运行（Windows）

1. 安装 [Node.js LTS](https://nodejs.org)。
2. 下载或克隆此仓库。
3. 双击 **`start.bat`**——首次运行时会安装依赖项。

或者在终端中运行：

```powershell
npm install
npm start
```

> 在 PowerShell 中，如果脚本被禁用，请使用 `npm.cmd` 代替 `npm`。

### 构建安装程序

双击 **`build-installer.bat`**（或运行 `npm run dist`）。安装程序和便携版 `.exe` 会生成在 `dist/` 中。

## 键盘快捷键

| 快捷键 | 操作 |
|---|---|
| `Ctrl+O` | 打开文件夹 |
| `F5` | 重新分析 |
| `Ctrl+1` … `Ctrl+6` | 概览 · 文件 · 清理 · 重复文件 · 整理 · 索引库 |
| `Ctrl+B` | 显示/隐藏侧边栏 |
| `Esc` | 取消正在进行的分析或重复文件检查 |

## 语言

| 语言 | 代码 | | 语言 | 代码 |
|---|---|---|---|---|
| English | `en` | | Deutsch | `de` |
| Português (Brasil) | `pt-BR` | | Italiano | `it` |
| Português (Portugal) | `pt-PT` | | 简体中文 | `zh-CN` |
| Español | `es` | | 日本語 | `ja` |
| Français | `fr` | | 한국어 | `ko` |

默认情况下，语言跟随 Windows，也可以在状态栏中更改。数字、日期和大小单位会遵循所选语言的习惯（例如，法语显示 *Mo* 和 *Go*）。缺少的翻译会回退为英文。

想要新增或改进某种语言？请参阅 [CONTRIBUTING.md](../CONTRIBUTING.md#translations)——只需要一个 JSON 文件。

## 隐私

LionOrganizer 离线运行。索引库是你电脑上的一个文件：

```
%APPDATA%\LionOrganizer\catalog.sqlite
```

你可以随时关闭记录（侧边栏中的“保存到索引库”）、将其导出为 CSV，或在*索引库*视图中清除它。清除索引库绝不会删除你的文件。

## 架构

代码沿用 [Visual Studio Code](https://github.com/microsoft/vscode) 的分层方式：`base` 不依赖其上的任何层，`platform` 提供系统服务，`workbench` 构建界面。主进程（Node.js）与界面（无法访问 Node 的沙盒渲染进程）之间只通过 `preload` 桥接通信。

```
src/
  base/
    common/              pure utilities: events, formatting, i18n (nls.js)
    browser/             DOM helpers, icons, charts (rose, treemap, dot matrix, bars, hatched columns)
  platform/              main-process services
    files/               folder scanner with depth limit
    catalog/             SQLite catalog, history, operation log, duplicate finder (SHA-256)
    operations/          file-changing operations guarded by the typed confirmation code
    shell/ · dialogs/    Explorer integration, native dialogs
    nls/                 i18n for the main process
  code/
    electron-main/       entry point: window, app:// protocol, service wiring
    electron-sandbox/    preload bridge
  nls/                   message catalogs: en.json, pt-BR.json, … (one file per language)
  workbench/
    browser/             bootstrap, layout parts (title bar, activity bar, side bar, editor, status bar), styles
    services/            analysis model, scan, layout, notifications, operations, confirmation, duplicates, catalog
    contrib/             views: overview, files, cleanup, duplicates, organize, catalog
```

安全性：启用 `contextIsolation` 和 `sandbox`，不启用 `nodeIntegration`，采用严格的内容安全策略（CSP），并且每个会更改文件的请求都在主进程中进行校验。

## 开发

| 命令 | 作用 |
|---|---|
| `npm start` | 运行应用 |
| `npm run dist` | 构建 Windows 安装程序和便携版应用 |
| `npm run test:e2e` | 端到端测试：分析一个**一次性**文件夹，依次测试重复文件、删除、整理、重命名、撤消和索引库，并在磁盘上检查结果 |
| `npm run docs:screenshots` | 重新生成 `docs/screenshots` 中的截图 |

```powershell
# the end-to-end test changes files: always point it to a throwaway folder
$env:E2E_FOLDER="C:\temp\lion-test"; $env:E2E_OUT="C:\temp\lion-out"; npm run test:e2e
```

## 参与贡献

欢迎提交错误报告、想法和拉取请求——尤其欢迎翻译。请阅读 [CONTRIBUTING.md](../CONTRIBUTING.md)。

## 致谢

LionOrganizer 由建筑与城市规划专业的学生 **Daniel Michelon De Carli 创建和构思**，由 **LionOrganizer Team** 与各位贡献者和译者共同维护。

内置字体：[Plus Jakarta Sans](https://github.com/tokotype/PlusJakartaSans) 和 [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono)，采用 SIL Open Font License 授权。架构设计受 [Visual Studio Code](https://github.com/microsoft/vscode) 启发。

## 许可证

Copyright © 2026 LionOrganizer Team.

LionOrganizer 是自由软件：你可以依据自由软件基金会发布的 **[GNU 通用公共许可证 v3.0](../LICENSE)**（第 3 版，或你选择的任何更高版本）的条款重新分发和/或修改它。发布本软件是希望它能有所帮助，但**不提供任何担保**；详情请参阅许可证。

简而言之：你可以自由地使用、研究、分享和修改 LionOrganizer；如果你分发修改后的版本，也必须以 GPL 发布并附带源代码。

本译文仅供参考，具有法律效力的是英文版许可证文本。
