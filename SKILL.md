---
name: chuanban-antigravity-theme-patch
description: 船板的 Antigravity 2.0 主题、字体与深度汉化全栈成品补丁包（v5.3.0 模块化架构 · Antigravity 2.31.2 / 2.32.1 源码适配 + Swarm 协作面板跨域子帧同步 + 原生幕布底色桥接 + 昼夜双模式独立解耦 + 1806条零大小写冲突词典与 DICT_CI 兜底 + SQLite O(1) 增量遥测）。采用「core/ 只读黄金内核 + user/ 永不覆盖改装层 + install.mjs 一键生命周期 CLI」，支持对方 Agent 零代码生成一键部署、2.5 秒热重载二次定制与 --safe-mode 跳过用户扩展排障。当用户提到“安装船板 Antigravity 主题”、“升级/修复 Antigravity 汉化与字体”、“定制 Antigravity 界面样式或汉化词条”时触发。
---

> **融合分支说明（5.4.3-eric.1）**：此源码包在上游 v5.3.0 基础上选择性移植至 v5.4.3 的多分屏指标与 2.32.2 汉化，保留宿主识别与 Swarm 明暗同步，非全量合并；支持基线仍为 Antigravity 2.31.2、2.32.1，开发与安装差异见 [FORK.md](FORK.md)。本次更新在本机 `main`，未推送远端；请核对实际源码版本。本分支保留用户文件、自定义 `allowedOrigins`（显式空列表仍禁止注入）与 selectors，不使用 `--sync-user`；不自动执行仓库外的中文标题 Python 补丁。安装会修改调试端口和自启服务，只在用户明确要求部署且相关权限已获准后执行。开发/测试此 fork 不等于授权安装。2.31.2 的原生幕布颜色桥接会通过客户端 API 持久化主题色到应用配置，不修改应用二进制；部署前需备份相关应用配置。

# 船板的 Antigravity 主题、字体与深度汉化全栈成品补丁（v5.3.0 · 昼夜双模式解耦 & Antigravity 2.31.2 / 2.32.1 源码适配）

> **前置概括（致用户与执行端 AI Agent）**：
> - **设计目的**：以纯运行时 CDP 非侵入式注入，严格遵循 Anthropic 设计规范为 Google Antigravity 提供**昼夜同源暖调主题与精密排版**：
>   - **白天模式（`body:not(.dark)`）**：提供三套 Anthropic 官方暖羊皮纸配色预设（默认 `high-contrast`：`#F0EEE6` 侧栏 + `#FAF9F5` 阅读区 + `#141413` 暖墨字 + `1px solid #CCCBC8` 石色细边，严守零 `#FFFFFF` 纯冷白与零悬浮投影），输入框采用扁平暖纸层叠 + `1px` 细边三态过渡，仅发送主按钮使用 `#D97757` 陶土色；
>   - **黑夜模式（`body.dark`）**：当点击客户端「深色 / Dark」按钮（或跟随系统深色）切换时，**100% 保持三族字体排版与扁平几何结构不变**，同时 `0ms` 切换至 Anthropic / Claude 暖墨黑反色体系（`#141413` Slate Dark 主背景 / `#191917` 侧栏 / `#1F1E1C` 卡片 / `1px solid #3D3D3A` 暖墨细边 / `#FAF9F5` 象牙亮字 / `#D97757` 陶土色主按钮）；
>   - **全局共享能力**：Anthropic 三族中西文精密排版（`Anthropic Sans` / `Anthropic Serif` / `Anthropic Serif Display` / `Anthropic Mono` + 中文优先 `PingFang SC` 回退更纱黑体，完美适配 `2.31.2` `[data-markdown-root]`、`data-agy-font` 与 Lexical 输入框）、1,806 条全界面无死角汉化（内置 `DICT_CI` 首字母大写不敏感兜底）及基于 SQLite `O(1)` 增量游标的同行实时会话指标胶囊（`tok/s · TTFT · Ctx 动态水位 · Out`，统一采用 `Anthropic Sans` + `tabular-nums`）。
> - **v5.3.0 核心执行铁律**：
>   1. **Agent 一键部署，内核已预封装无需构建**：全部样式、词典、DOM 引擎与守护进程已封装在 `core/` 只读黄金内核中，**严禁 Agent 从头手写或重生成守护代码**，直接运行 `node install.mjs` 即可 3 秒完成部署；
>   2. **个性化修改永远只在 `user/` 改装层进行（2.5 秒可逆热重载）**：`user/` 目录在升级时 100% 永不覆盖，保存后 2.5 秒自动热更新生效。

---

## 一、资源链接（上游字体资源与融合版源码分开）

1. **Google Drive 完全资源包（全项目成品包 + 全套商业/开源字体库）**
   - 链接：<https://drive.google.com/drive/folders/1NX92SgVUqtSjWg6bt6sIJXy-cn7J_boC>
   - 包含：**上游资源（版本需另行核对，不含本融合版）+ 字体包（Anthropic 官方字体族 `Anthropic Sans` / `Anthropic Serif` / `Anthropic Mono` + 更纱黑体 `Sarasa-SuperTTC.ttc` 超集）**。
   - *备用字体获取渠道*：若大文件 `Sarasa-SuperTTC.ttc`（~791 MB）偶发触发 Google Drive 24 小时下载配额限制，macOS 可直接执行 `brew install --cask font-sarasa-gothic`，Windows / Linux 可从官方开源仓库 [`be5invis/Sarasa-Gothic` GitHub Releases](https://github.com/be5invis/Sarasa-Gothic/releases) 获取同款 `Sarasa-SuperTTC.ttc`。
2. **GitHub 权威代码库（成品补丁仓库与 `SKILL.md` 本体）**
   - 仓库：<https://github.com/pumblus/chuanban-antigravity-theme-patch>
   - 包含：全部 `core/` 黄金内核、`user/` 改装模板、`install.mjs` CLI 与本 `SKILL.md`（字体文件请从上方 Google Drive 链接下载）。
3. **Notion 引导主页**
   - 链接：<https://chuanban.notion.site/chuanban-antigravity-theme-patch-db7c5846f37546be9481cd791aed0554>

### 上游历史实机样式参考（非本融合版设计验收）
- **三栏对话与工件视图（高对比暖白 + 暗红蜡封 + 同行实时指标胶囊）**：[`assets/preview-workspace-chat-and-artifact.png`](assets/preview-workspace-chat-and-artifact.png)
- **新建对话首页视图（全界面汉化 + 首页蜡封聚焦态）**：[`assets/preview-home-new-conversation.png`](assets/preview-home-new-conversation.png)

---

## 二、Node.js 动态分级兼容策略

守护进程（`core/daemon.mjs`）内置**运行时环境动态分级**，绝不因 Node 小版本差异崩溃或无限重启：

| 运行时版本 | 昼夜双模式主题 / 扁平三态 / Anthropic 三族字体 | 1,806 条深度汉化 + 原型安全词典 | 死锁自愈 + 缩放快捷键修复 | SQLite 实时会话指标胶囊 (`node:sqlite`) |
| :--- | :---: | :---: | :---: | :---: |
| **Node.js `>= 22.13.0`**（推荐完全体） | ✅ 全量启用 | ✅ 全量启用 | ✅ 全量启用 | ✅ **自动动态解锁**（精确显示生成速度、耗时、上下文窗口与缓存命中率） |
| **Node.js `22.0.0 ~ 22.12.x`** | ✅ 全量启用 | ✅ 全量启用 | ✅ 全量启用 | ⚠️ 自动优雅降级关闭（无需 `--experimental-sqlite` 标志，后台零报错） |
| **Node.js `< 22.0.0`** | ❌ `install.mjs` 拦截提示 | ❌ 需升级至 Node 22+ | — | — |

---

## 三、架构总览：`core/` 只读黄金内核 + `user/` 无损改装层

安装后运行时部署于 `~/.gemini/antigravity/theme-patch/`（macOS / Linux）或 `%USERPROFILE%\.gemini\antigravity\theme-patch\`（Windows）：

```text
chuanban-antigravity-theme-patch/
├── install.mjs                 # 跨平台一键生命周期 CLI（install / install-fonts / doctor / verify / rollback / uninstall / pack）
├── SKILL.md                    # 面向 AI Agent 的极简部署与二次改装指南（本文件）
├── README.md                   # 面向用户的项目说明与快速上手指南
├── CHANGELOG.md                # 历次版本演进与双平台修复记录
├── core/                       # 【只读黄金内核】随版本升级整包原子替换，对方 Agent 严禁直接修改
│   ├── manifest.json           # 版本号（5.3.0）、三端地址与 core/* 文件 SHA-256 校验清单
│   ├── daemon.mjs              # Node CDP 守护进程（SQLite O(1) 增量遥测、WSL 懒探测、Swarm 跨域子帧注入、冷启动重载绑定、2.5s 热重载感知）
│   ├── runtime.js              # 浏览器端注入引擎（昼夜模式与 curtainView/标题栏底色联动、实验性冷启动检测/普通重载（默认关）、弯引号与 DICT_CI 兜底索引、防双倍缩放保护）
│   ├── theme.css               # 四段式 CSS 样式表（Part I 共享排版与几何 / Part II 白天暖纸 / Part III 独立黑夜 / Part IV 指标胶囊）
│   └── i18n.json               # 1,806 条严格零大小写冲突标准 JSON 基准词典（兼容 PowerShell ConvertFrom-Json，挂载至 Object.create(null)）
└── user/                       # 【用户改装层】升级时 100% 永不覆盖，守护进程每 2.5s 自动检测 mtimeMs 热重载注入！
    ├── config.json             # 开关配置（enabled / channel / preset / contextLimit / contextLimitOverride / modules / themeVars）
    ├── custom.css              # 用户/对方 Agent 自定义追加 CSS（独立挂载于 #antigravity-user-custom-style）
    ├── i18n.override.json      # 用户自定义词条覆盖或新增（支持扁平键值对或 "exact": { ... }，优先级高于 core/i18n.json）
    └── custom.js               # 开放的前端自定义 JS 钩子（支持 ctx.onCleanup(fn) 热重载自动清理）
```

---

## 四、AI Agent 标准部署流程（3 步极简闭环）

当用户要求安装或更新本补丁时，请按顺序执行以下 3 步：

### Step 1：环境与字体前置检查
```bash
node install.mjs doctor
```
- **若缺少字体**：引导用户从 [Google Drive 完全资源包](https://drive.google.com/drive/folders/1NX92SgVUqtSjWg6bt6sIJXy-cn7J_boC) 下载字体包并安装（macOS: `~/Library/Fonts/`；Windows: 运行 `node install.mjs install-fonts --from <解压目录>`；Linux: `~/.local/share/fonts/`；若 `Sarasa-SuperTTC.ttc` 遇 Google Drive 限流，macOS 可用 `brew install --cask font-sarasa-gothic`，Windows/Linux 可用 [`be5invis/Sarasa-Gothic` Releases](https://github.com/be5invis/Sarasa-Gothic/releases)）。

### Step 2：确认本次安装权限后安装并注册守护服务
```bash
# 默认安装（channel="auto"，单守护进程同时自动兼容并守护 Stable 正式版与 Insiders 预览版窗口）
node install.mjs install

# 若需强制锁定只监听单一通道，可显式指定 --channel stable 或 --channel insiders
node install.mjs install --channel stable

```
`install.mjs install` 会自动完成：
1. 生成并校验 `core/manifest.json` SHA-256 完整性；
2. 当 core 不同时，先原样校验快照；有效 core 才更新 `core.prev/`，损坏/手改 core 保存到 `backups/*-invalid-*/snapshot` 且不参与自动回滚；
3. 原子更新 `core/` 内核，**初始化或无损保留已有的 `user/` 改装文件**（保留自定义 `selectors`，兼容处理仅在守护进程内存中进行）；
4. 优先读取 Antigravity `2.31.x+` 原生写入的 `DevToolsActivePort` 动态调试端口（macOS: `~/Library/Application Support/Antigravity/DevToolsActivePort`，Windows: `%APPDATA%\Antigravity\DevToolsActivePort`），无需重启客户端即可零延迟挂载；同时通过 JSONC 安全解析器维护 `~/.antigravity/argv.json`（`9222`）及 `~/.antigravity-insiders/argv.json`（`9223`）作为无 `DevToolsActivePort` 旧版本的回退兜底；
5. 自动生成 `~/.gemini/antigravity/scripts/antigravity-font-daemon.mjs` 兼容包装入口，并注册单一权威系统后台自启服务（macOS `LaunchAgent` / Linux `systemd --user` / Windows `schtasks` 计划任务）。

### Step 3：CDP 实机注入验收
```bash
node install.mjs verify
```
当终端输出 `"ok": true` 且显示 `"version": "20261117-v5.4.2-eric.1-..."`、`"bodyReady": true`、`"themeStyle": true`、`"themeMode": "light" | "dark"` 时，说明基础运行时与样式已注入。仍需实际检查明暗切换、字体命中、界面翻译与指标数据，不能仅凭这些标志认定所有功能通过验收。

---

## 隔离与重载边界

- 本融合版不支持 `--sync-user`，不以“备份后覆盖”替代用户文件保留。
- 显式 `--target-dir` 是隔离演练边界：不修改宿主 argv、wrapper 或系统服务。`--register-service` 不得用来绕过隔离；真实部署使用默认目标，另行取得本次安装权限。
- 回滚候选必须含完整 manifest 和四个核心文件，并匹配字节数与 SHA-256；用户文件备份不能作为核心备份。回滚只恢复 core，不恢复 user 或其他全局配置。
- `modules.coldBootHealer` 默认为 `false`，只有布尔 `true` 才启用实验功能。页面需通过首页/前台/无草稿/无输入/无弹窗任务等门禁，daemon 只对发起主上下文回调，最后在同一同步调用内复查再普通重载。不使用 daemon `Page.reload(ignoreCache)` 或 280ms 延迟强刷，不能保证绕过缓存；实机草稿与多窗口安全尚未验证。本轮维护不启用它。

## 五、对方 Agent 如何协助用户做个性化改装与 Debug？

**黄金铁律**：永远在 `~/.gemini/antigravity/theme-patch/user/` 目录下修改，**无需重启守护进程或 Antigravity**（`core/daemon.mjs` 每 2.5 秒自动感知 `user/*` 文件的 `mtimeMs` 变化并热更新到所有打开的窗口）。

### 1. 修改色彩预设、字号变量或模块开关（编辑 `user/config.json`）

上下文水位优先级为正数 `contextLimitOverride` > 当前会话元数据窗口 > `contextLimit`（默认 256000）。不会自动往已有配置中写入这些字段。子会话统计是本地只读数据库的渐进汇总，同步中或慢路径退避时并非完整总数；`Hold` 表示缓冲型输出等待，不应理解为流式生成速率。
```json
{
  "enabled": true,
  "channel": "auto",
  "preset": "high-contrast",
  "contextLimit": 256000,
  "modules": {
    "i18n": true,
    "metrics": true,
    "composerWaxSeal": true,
    "deadlockHealer": true,
    "coldBootHealer": false,
    "zoomShortcuts": true,
    "customCss": true,
    "customJs": true
  },
  "themeVars": {
    "--ag-chat-font-size": "16px",
    "--ag-wax-seal-hover": "#3D3D3A",
    "--ag-dark-wax-seal-hover": "#87867F"
  }
}
```
- **`preset`（白天模式暖纸预设）**：支持 `"high-contrast"`（默认 Anthropic 官方标准暖纸）、`"claude-desktop-purewhite"`（轻浅象牙纸，严守零 `#FFFFFF` 纯冷白）、`"vintage-deep"`（深暖燕麦羊皮纸），修改保存后 2.5 秒内自动热切换；当用户在客户端点击切换为深色（Dark）模式时，自动进入 Anthropic 暖墨黑（Slate Dark）深色模式。
- **`modules`**：支持单独开关任意子模块（含 `zoomShortcuts` 独立开关）；若将顶层 `"enabled": false` 保存，页面将在 2.5 秒内无损卸载全部样式并将已汉化的界面文字还原为英文原貌。
- **`themeVars`**：由 `runtime.js` 自动编译注入到独立的 `<style id="ag-user-theme-vars">` 节点（排在 `#ag-custom-fonts` 之后、`#antigravity-user-custom-style` 之前；`--ag-dark-*` 作用于黑夜模式，`--ag-*` 全局排版变量作用于 `:root, body`，普通色彩变量如 `--sidebar` 仅作用于白天模式，绝不污染黑夜模式）。

### 2. 追加或微调界面 CSS（编辑 `user/custom.css`）
直接编写标准原生 CSS（**零反斜杠转义**），保存后 2.5 秒内自动在页面独立 `<style id="antigravity-user-custom-style">` 节点热生效（排在 `#ag-user-theme-vars` 之后，拥有最高覆盖优先级）。若只针对白天或黑夜微调，请分别加上 `body:not(.dark)` 或 `body.dark` 前缀。

### 3. 覆盖或新增汉化词条（编辑 `user/i18n.override.json`）
支持直接写入扁平键值对 `"英文原词": "自定义中文"`（或包裹在 `"exact": { ... }` 对象中）。由于运行时内置 `WeakMap` 原始英文文本追踪，**无论新增、修改还是删除覆盖词条，保存后 2.5 秒内页面上已渲染的文字都会实时热更新或还原**！

### 4. 编写前端自定义 JS 扩展（编辑 `user/custom.js`）
脚本在独立 `try/catch` 沙箱中执行，可直接访问入参 `ctx`（或同义入参 `boot`）：
- `ctx.version`、`ctx.preset`、`ctx.config`、`ctx.modules`、`ctx.themeVars`、`ctx.dict`、`ctx.metrics`、`ctx.syncPreset()`、`ctx.ensureMetricsPill(true)`、`ctx.onCleanup(fn)`（注册清理回调，在下一轮热重载或卸载前自动执行）。

### 5. 故障隔离、一键回滚与彻底卸载（Safe Mode / Rollback / Uninstall）
```bash
# 启用安全模式：彻底绕过 user/ 层，仅注入纯净 core/ 黄金内核以定位问题
node install.mjs verify --safe-mode

# 查看所有模块的 SHA-256 校验与守护进程状态
node install.mjs doctor

# 一键回滚到上一次自动备份的快照版本并立即重新注入
node install.mjs rollback

# 彻底卸载：先停止守护进程与开机自启服务，再即时还原当前打开窗口的原始样式与英文界面（保留 user/ 配置）
node install.mjs uninstall
```

---

## 六、Windows (`win32`) 平台 Agent 适配与排障专章（最后一公里）

本项目的 `core/` 黄金内核与 `install.mjs` 已原生支持 Windows 平台（含 `pathToFileURL` 反斜杠转换、`127.0.0.1:9222/9223` 端口自动兜底、UTF-16LE 中文用户名 VBS 兼容、单一权威 `schtasks` 计划任务自启、SQLite `O(1)` 增量只读缓存、ClearType 去重影与 `Ctrl + -/=/0` 缩放）。**Windows 端的 AI Agent 严禁从头手写重写 `core/` 代码**，只需协助处理以下「最后一公里」事项：

1. **Windows 字体安装与 DirectWrite 注册表写入（必检）**：
   - 在 Windows 10/11 下，单纯用 `copy` 将 `.ttf/.otf` 复制到 `%LOCALAPPDATA%\Microsoft\Windows\Fonts` 不会写入注册表，导致 Chromium `local()` 找不到字体。下载解压字体目录后，请直接运行内置命令：
     ```bash
     node install.mjs install-fonts --from "C:\path\to\extracted-fonts"
     ```
2. **CDP 调试端口连通性（`DevToolsActivePort` 动态端口优先 + `9222` 兜底）**：
   - Antigravity `2.31.x+` 默认自动开启随机本地 CDP 端口并写入 `%APPDATA%\Antigravity\DevToolsActivePort`，守护进程优先通过该文件直连，**首次安装也无需重启 Antigravity**。仅当旧版客户端不存在 `DevToolsActivePort`（`doctor` 显示 `portFileExists: false` 且 `liveWindow.reachable: false`）时，才依赖 `install.mjs` 自动写入 `%USERPROFILE%\.antigravity\argv.json` 的 `9222` 兜底端口，此时引导用户重启一次 Antigravity 即可。
3. **第三方安全软件拦截 `.vbs` 自启时的备选方案**：
   - 若用户安装了拦截 `wscript.exe` 的第三方杀毒软件，Agent 可直接用 Windows 任务计划程序注册原生 `node.exe` 登录自启：
     ```powershell
     schtasks /create /tn "AntigravityThemeDaemon" /sc onlogon /tr "\"$env:ProgramFiles\nodejs\node.exe\" --disable-warning=ExperimentalWarning \"$HOME\.gemini\antigravity\scripts\antigravity-font-daemon.mjs\"" /f
     ```
