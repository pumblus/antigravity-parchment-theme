# Antigravity 主题融合分支 · 5.3.0-eric.1

基于 [Anarcadia 上游 v5.3.0](https://github.com/Anarcadia/chuanban-antigravity-theme-patch/commit/6a263b50cb575b22059f4429a9ba9625c0c540df)，选择性融合 [Eric 的字体与汉化改进](https://github.com/Anarcadia/chuanban-antigravity-theme-patch/pull/2) 并严格对齐 Anthropic 官方设计规范重构全界面字体选型。保留上游昼夜主题、2.31.2 / 2.32.1 兼容、实时指标与生命周期清理，补齐 Serif/Sans/Display 全字重及真斜体别名，统一西文 Anthropic 三族 + 中文 `PingFang SC` 优先回退，将输入框、快捷键与指标面板回归 `Anthropic Sans`，首页欢迎语改用 `Anthropic Serif Display`，改善权限文案与常用汉化。词典共 1756 条，保留上游全部 1740 个词条与新的大小写兜底查找。

**本分支为独立集成版，不是上游发布。** 移除了自动调用仓库外 Python 二进制补丁的行为；不引入 `--sync-user`，安装保留已有用户文件及自定义选择器。变更边界、验证方法与限制见 [FORK.md](FORK.md)。下方截图为上游参考，不代表本分支已完成 Antigravity 实机验收。

本次更新保存在本机仓库的 `main` 分支，版本 `5.3.0-eric.1`，尚未推送远端。安装请使用已同步的本地源码；不要假定远端 `main` 已包含本次更新。

5.3.0 合入 2.32.1 新增翻译、动态上下文窗口、缓冲输出识别、子 Agent 指标汇总与 WSL 慢路径退避；保留 Anthropic/PingFang 字体、暖调配色、macOS 连续圆角和 Turbo 的“完全模式”权限含义。实验性冷启动重载默认关闭，不能将草稿安全视为已在真实客户端充分验证。

安装前请阅读 `SKILL.md`。安装会配置本地调试端口和系统自启服务，不能把 `doctor` 的完整性通过等同于客户端实机生效。

---

# 船板的 Antigravity 书卷暖纸 × 暖墨黑昼夜双模式主题、字体优化与深度汉化全栈补丁 (v5.3.0 · Antigravity 2.31.2 / 2.32.1 源码适配)

[![Version](https://img.shields.io/badge/version-5.3.0-7A1F1A.svg)](https://github.com/pumblus/chuanban-antigravity-theme-patch)
[![Antigravity](https://img.shields.io/badge/Antigravity-2.31.2%2B-D97757.svg)](https://github.com/pumblus/chuanban-antigravity-theme-patch)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0%20(22.13%2B%20Full)-339933.svg)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)](https://github.com/pumblus/chuanban-antigravity-theme-patch)

> **本页面为补丁主介绍、极简部署指南与版本演进说明。**  
> 供 AI Agent 执行一键安装与二次改装读取的完整技术契约独立存放于仓库根目录的 **[`SKILL.md`](SKILL.md)**。

---

## 🔗 核心资源链接与三端入口

| 端点名称 | 链接地址 | 定位与包含内容 |
| :--- | :--- | :--- |
| **1. Google Drive 全套资源包（含字体）** | [**Google Drive 官方共享文件夹**](https://drive.google.com/drive/folders/1NX92SgVUqtSjWg6bt6sIJXy-cn7J_boC) | **全项目成品包 + 全套必备字体库**。内置 **Anthropic 官方原版字体族**（`Anthropic Sans` / `Anthropic Serif` / `Anthropic Mono`）与 **更纱黑体超集**（`Sarasa-SuperTTC.ttc`）。 |
| **2. GitHub 项目代码库** | [**pumblus/chuanban-antigravity-theme-patch**](https://github.com/pumblus/chuanban-antigravity-theme-patch) | **成品补丁代码完全体**。包含预封装只读内核 `core/`、个人改装层 `user/`、一键安装器 `install.mjs` 及 Agent 专用的 [`SKILL.md`](SKILL.md)（字体请从上方 Google Drive 下载）。 |
| **3. Notion 引导安装页** | [**chuanban-antigravity-theme-patch**](https://chuanban.notion.site/chuanban-antigravity-theme-patch-db7c5846f37546be9481cd791aed0554) | 备用说明与部署引导主页。 |

---

## 🖼️ 上游历史样式参考（非本融合版）

### 1. 三栏工作台：高对比暖纸主题 + 古朴暗红蜡封输入框 + 同行实时指标胶囊 + 书卷衬线工件
![三栏对话与工件阅读视图](assets/preview-workspace-chat-and-artifact.png)

### 2. 新建对话首页：全界面深度汉化 + 聚焦浮现淡雅暗红蜡封外框
![新建对话首页视图](assets/preview-home-new-conversation.png)

---

## ✨ 补丁简介：核心定位与五大亮点（v5.3.0）

### 1. 设计目的
Google Antigravity 原生浅色界面偏冷刺眼、全局仅使用单一无衬线字体，长时间高强度阅读与编码容易视觉疲劳。本补丁以**纯运行时非侵入注入**的方式，严格遵循 **Anthropic 设计规范**，将 Antigravity 重塑为兼具 **暖羊皮纸扁平纸张美学、暖墨黑深色模式、三族中西文精密排版、全界面母语级汉化与实时模型遥测** 的主力工作台：

- **🌓 昼夜双模式同源暖调体系（官方暖羊皮纸白天 + 暖墨黑反色黑夜，零 `#FFFFFF` / 零悬浮投影）**：
  - **白天模式（Light）**：内置 **Anthropic 官方标准暖纸**（默认 `high-contrast`：暖羊皮纸侧栏 `#F0EEE6` + 象牙纸主阅读区 `#FAF9F5` + 暖墨文字 `#141413` + `1px` 石色细边 `#CCCBC8`，严守零 `#FFFFFF` 纯冷白）、**轻浅象牙纸**（`claude-desktop-purewhite`）与 **深暖燕麦羊皮纸**（`vintage-deep`）三套护眼预设；
  - **黑夜模式（Dark）**：当你点击设置中的「深色 / Dark」按钮（或跟随系统深色）时，**100% 保持三族字体与扁平几何要素不变**，同时 `0ms` 切换至 **Anthropic / Claude 暖墨黑反色体系**（`#141413` Slate Dark 主背景 / `#191917` 侧栏 / `#1F1E1C` 扁平卡片 / `1px solid #3D3D3A` 暖墨细边 / `#FAF9F5` 象牙亮字 / `#D97757` 陶土色主按钮），昼夜气质完全统一。
- **🔤 Anthropic 规范三族排版（昼夜完全共用 · 原生适配 `2.31.2` `[data-markdown-root]`、`data-agy-font` 与 Lexical 编辑器）**：西文与数字严格按角色分工——UI 控件、输入框、快捷键与实时指标面板（配 `tabular-nums`）统一采用 `Anthropic Sans`，阅读散文采用 `Anthropic Serif`（首页欢迎语采用 `Anthropic Serif Display`，正文链接常驻 `1px` 细下划线），代码块、文件路径、Monaco 编辑器与终端严格限定 `Anthropic Mono`；中文统一优先采用 `PingFang SC`（跨平台自动回退更纱/雅黑）。
- **📐 扁平纸张层叠、macOS 同心连续圆角与单一陶土主色纪律**：移除全部悬浮投影（`box-shadow: none`），输入框采用「暖纸外托盘 `12px` + 抬升内卡片 `11px` + `1px` 细边三态过渡（常态 `#CCCBC8` → 悬停 `#87867F` → 聚焦 `#3D3D3A`）」，全界面矩形容器对齐 macOS HIG 同心梯度（主画布/弹窗 `12px`、气泡/代码块/菜单 `10px`、菜单项与侧栏行 `6px`）与 `superellipse(1.5)` 连续曲率；全场仅将 `#D97757`（悬停 `#C6613F`）陶土色保留给唯一发送主按钮。
- **🇨🇳 1,756 条零大小写冲突深度汉化 + 首字母大写不敏感兜底索引（`DICT_CI`） + ⚡ `O(1)` 增量实时指标胶囊**：全覆盖 `2.31.2` 新增的 Fork / Best of N / 定时任务（Scheduled Tasks）/ 快捷键编辑器 / 远程控制二维码 / 沙箱与浏览器执行权限 / 插件主题外观及全部命令面板标签（基于 `WeakMap` `O(1)` 隔离保护代码块、Monaco 编辑器、终端与对话正文不误伤），并在输入框底部同行实时展示生成速度（`tok/s`）、首字耗时（`TTFT`）、动态上下文水位及缓存命中率详情面板。

### 2. 五大工程亮点
1. **🤖 Agent 3 秒一键部署，零构建零依赖**：所有 CSS、词典、DOM 引擎与守护进程已预封装在 `core/` 只读内核中，无需任何 npm 依赖或编译构建，交给你的 Agent 即可 3 秒一键安装。
2. **🛠️ 开放 `user/` 独立改装层，2.5 秒热重载**：内置升级永不覆盖的 `user/` 改装层（`config.json` / `custom.css` / `i18n.override.json` / `custom.js`）。想换配色、改字号、微调颜色或增改汉化词条，只需直接跟 Agent 对话，保存后 2.5 秒内自动热生效。
3. **🛡️ 纯运行时 CDP 注入**：通过本机 Chrome DevTools Protocol 注入，不拆包 `.asar`；原生主题色会保存到应用配置。冷启动漂移检测/重载保留为**默认关闭的实验功能**，显式开启后仍须通过首页、无草稿、无交互、无弹窗/运行任务等门禁。融合版不调用 `Page.reload(ignoreCache)`，也没有延迟强刷兜底，不能承诺清除缓存或解决所有旧包问题。
4. **🔄 客户端日常小版本更新后自动延续**：配合系统常驻守护服务（macOS `LaunchAgent` / Windows 计划任务自启 / Linux `systemd`）自动探测窗口与重连注入，单守护进程同时兼容 **Stable 正式版** 与 **Insiders 预览版**。
5. **💻 macOS 与 Windows 双平台原生统一体验**：内置 Windows 字体一键注册表写入命令 `install-fonts`、ClearType 抗锯齿自动适配、SQLite `O(1)` 增量只读游标缓存与 `Cmd/Ctrl + -/=/0` 缩放快捷键修复（兼容 `2.31.0` `resetZoom`）。

---

## 🚀 极简部署与日常使用指南

### 一、新用户初次安装
1. **前置准备**：从 [**Google Drive 全套资源包**](https://drive.google.com/drive/folders/1NX92SgVUqtSjWg6bt6sIJXy-cn7J_boC) 下载并安装字体文件（macOS 双击安装到「字体册」，Windows 可让 Agent 用内置命令一键注册），并确保本机已安装 **Node.js `>= 22.0.0`**（推荐 `>= 22.13.0` 以解锁实时指标胶囊）。
2. **复制发给你的 AI Agent（Antigravity / Claude Code / Codex / Cursor 等）**：

> **💬 复制发给 Agent（新用户一键安装）**：  
> 请读取我本机 `~/Repositories/chuanban-antigravity-theme-patch` 中的 `main` 分支，先核对版本为 `5.3.0-eric.1` 并确认工作区状态，不覆盖已有文件或盲目切换分支。阅读 `SKILL.md`，在取得本次安装与本地调试/自启权限确认后，运行 `node install.mjs install --channel stable` 和 `node install.mjs verify --channel stable`。保留 `user/` 中的配置、CSS、词典和脚本。

### 二、老版本用户无缝升级至 v5.3.0
`node install.mjs install` 会自动备份旧内核、接管旧版常驻服务，并无损保留你在 `~/.gemini/antigravity/theme-patch/user/` 中的个人配置：

> **💬 复制发给 Agent（老用户无缝升级）**：  
> 请读取我本机 `~/Repositories/chuanban-antigravity-theme-patch` 中的 `main` 分支，先核对版本为 `5.3.0-eric.1` 并确认工作区状态，不覆盖已有文件或盲目切换分支。阅读 `SKILL.md`，在取得本次安装与本地调试/自启权限确认后，运行 `node install.mjs install --channel stable` 和 `node install.mjs verify --channel stable`。保留 `user/` 中的配置、CSS、词典和脚本。

### 三、后续与 Agent 对话定制风格或排障
- **🎨 切换白天预设、调整字号或微调外观**：
  > 请参考 `~/.gemini/antigravity/theme-patch/SKILL.md` 的 `user/` 改装规范，只修改 `user/` 目录下的配置文件：帮我把白天配色预设切换为「ClaudeDesktop 净白」（或「复古深色」） / 把对话正文字号调为 `16.5px` / 在 `user/custom.css` 里微调某处样式。
- **🇨🇳 自定义修改或新增某条汉化词条**：
  > 请在 `~/.gemini/antigravity/theme-patch/user/i18n.override.json` 中添加或修改词条，把界面上的 `"某英文原词"` 改成 `"我想要的中文"`，确认 2.5 秒内页面实时热更新生效。
- **🔍 自我 Debug 或一键回滚**：
  > 当前 Antigravity 界面有点异常，请按照 `~/.gemini/antigravity/theme-patch/SKILL.md` 先运行 `node install.mjs doctor`，再用 `node install.mjs verify --safe-mode` 排查是否是 `user/` 自定义层冲突；如需恢复上一版本请执行 `node install.mjs rollback`。
  - *若冷启动后看不到 `Remote`，先保存草稿并确认无运行任务，再考虑手动刷新。融合版实验性自动重载默认关闭，真实多窗口/草稿行为未在本轮实机验证，不承诺刷新即可解决。*

---

## 🕒 上游版本演进参考（完整变更日志见 [`CHANGELOG.md`](CHANGELOG.md)）

以下保留上游历史记录，并非融合版全部行为或本次验收结果；自动外部标题脚本、默认来源并集、--sync-user 与默认开启的冷启动强刷策略未合入，具体差异见 [FORK.md](FORK.md)。

- **2026-11-15（v5.3.0 现行版 · Antigravity `2.32.1` 双平台全量适配、子 Agent `+N sub` 血缘遥测聚合、动态上下文水位与 `1,740` 条零冲突词典）**：
  融合社区共建（特别感谢 [@honlam996](https://github.com/honlam996) [#3](https://github.com/Anarcadia/chuanban-antigravity-theme-patch/issues/3)/[#4](https://github.com/Anarcadia/chuanban-antigravity-theme-patch/issues/4)/[#5](https://github.com/Anarcadia/chuanban-antigravity-theme-patch/issues/5)/[#6](https://github.com/Anarcadia/chuanban-antigravity-theme-patch/pull/6)/[#7](https://github.com/Anarcadia/chuanban-antigravity-theme-patch/pull/7)）与 macOS × Windows 11 双端 `2.32.1` 真机压测加固：新增子 Agent 与本地 `/swarm` 全树血缘汇总（`+N sub` 胶囊徽标与悬浮明细，`4,096` 缓存容量 + `<= 45 DB / 60ms` 渐进分片预算 + WSL2 UNC `45s` `0-I/O` 熔断闭环）；支持动态读取模型真实上下文窗口（`256k` / `840k` / `1M+` 及 `contextLimitOverride`）与缓冲型调用 `streamRatio` 守卫（`Hold X.Xs`）；全量适配 `2.32.1` `.pdf-sdk-root` 局部字体变量、恢复被 `no-contextual` 误关的全局连字、支持 `[data-markdown-root]` 内嵌表格/外链/胶囊按钮无障碍属性定向汉化与 Swarm 2.0 子帧隔离词典，静态词条扩充至 **1,740 条**。
- **2026-11-14（v5.2.0 · Antigravity `2.32.0` 适配、全词库系统性去机翻精校与 1,630 条统一母语词典）**：
  完成 Antigravity `2.32.0` 客户端实机零漂移核验与新增 UI 全覆盖（34 条 `2.32.0` 新增快捷键/SSH/授权码登录兜底/MCP 状态/GitHub 远程克隆词条 + 2 条动态正则），并对全量词库与动态模板实施系统性去机翻重构：将生硬直译的 `"Local Checkout"`（`本地检出`）修正为 **`本地`** 并补齐非 Git 目录下的 9 条环境选择器说明；统一全界面五大高频术语规范（保留约定俗成英文 **`Artifact`** 与 **`Worktree`**，统一 **`Agent / 子 Agent`**、**`支线提问`**、**`对话`**、**`沙盒`** 与 Swarm **`纪要员`**），清理 23 处按钮与菜单冗余英文括号尾巴（如 `极速模式`、`自动判断`、`始终直接执行`），修正 `可操控网址`、顶栏 `审阅`、`今天想做点什么？` 等直译硬伤，静态词条总计达 **1,630 条**。
- **2026-11-14（v5.1.9 · Windows PowerShell 5.1 打包/字体注册修复、`rollback` 与沙箱目录安全隔离、1,587 条词典及动态人名问候补全）**：
  联合 Windows 11 真机全链路发版后回归热修与 macOS 沙箱验证：修复 Windows PowerShell `5.1` `ConvertFrom-Json` 嵌套二维数组导致的 `pack` 报错与 `install-fonts` 多字体静默漏注册（新增 `AddFontResourceW` 真实计数校验与同目录自拷贝保护）；为 `rollback` 增加核心文件完整性校验并隔离 `--sync-user` 生成的 `-user` 备份目录，为 `--target-dir` 自定义沙箱测试目录增加全生命周期系统服务隔离与 macOS 软链接路径等价识别；扩充静态词条至 **1,587 条**，新增 `2.31.2` 首页带用户名动态问候语、Worktree/Fig 分支工作区副标题与 Swarm `File` 标签汉化，并排除非文本滑块/取色 `<input>` 对冷启动自愈器的误阻断。
- **2026-11-14（v5.1.8 · 冷启动兜底包零流量安全自愈、1,575 条词典补全、未装更纱中文字形兜底与社区共建合流）**：
  核验并择优吸收社区反馈（特别感谢 [@webber181](https://github.com/webber181) [#1](https://github.com/Anarcadia/chuanban-antigravity-theme-patch/issues/1) 与 [@pumblus](https://github.com/pumblus) [#2](https://github.com/Anarcadia/chuanban-antigravity-theme-patch/pull/2)）：新增基于 `HEAD /main.js` `ETag` 零流量比对与六重空输入安全门禁的冷启动内嵌兜底包无感自愈器（解决客户端冷启动竞态偶发丢失 `Remote` 入口且绝不吞草稿）；修复 `Auto (Preview)` 带括号权限预设的无障碍标签匹配与运行态会话 `Stop` 标签；扩充 21 条 `2.31.2` 跨平台原生漏翻词条至 **1,575 条**；补充 `Anthropic Sans/Serif Text` 桌面版字体别名兼容、未安装更纱黑体时输入框中文字体回退链（防 Windows 新宋体退化）、`install.mjs install --sync-user` 备份同步开关与更纱黑体 Homebrew / GitHub 官方备用下载源说明。
- **2026-11-14（v5.1.7 · Windows `2.31.2` 全栈热修合流、`DirectWrite` 可变字体全字重轴、WSL 会话遥测懒探测与 1,554 条弯引号兼容词典）**：
  联合 Windows 端 `2.31.2` 实机排障热修与 macOS 端全量交叉验证完成双端合流：
  1. **Windows `DirectWrite` 可变字体粗体/斜体回退根治与原生标题栏同步**：补齐 `Anthropic Serif` 粗体 `@font-face` `local('Anthropic Serif Web Text Light')` 声明与 `html[data-ag-os="win32"]` `font-variation-settings` 正文/斜体/粗体/粗斜体显式轴控制，彻底解决 Windows 下 `<strong>` 退化为中文等宽衬线体的顽疾；新增 `syncWinTitleBarOverlay()` 实时桥接 Windows 顶层窗口最小化/最大化/关闭按钮昼夜反差；
  2. **Windows 计划任务拔电常驻、WSL 会话遥测按需懒探测与连发缩放修复**：修复 Windows 任务计划程序电池断电强杀与 72 小时时限，新增 `Win32_Process.CommandLine` PID 复用防误杀、`install-fonts` 运行期字体内存锁容错与 `WM_FONTCHANGE` 异步广播、`.NET ZipFile` 原生流式打包；支持从 `%APPDATA%\Antigravity\wsl_state.json` 按需懒探测 `\\wsl.localhost` 会话数据库（本地会话 0 UNC 开销）；Windows / Linux 缩放快捷键改为 `0ms` 即时响应（修复长按 `Ctrl + =/-` 连发吞键，完整保留 macOS `60ms` `NSMenu` 防双倍跳变保护与德语 QWERTZ `Ctrl+ß` 豁免）；
  3. **Swarm 隐藏预加载感知与 1,554 条零冲突词典**：修复 `plugin://swarm--` OOPIF 子帧顶层导航重注入条件，接入 `~/.gemini/config/config.json` `userSettings.themeMode` 兜底对齐，新增弯单引号（`’`/`‘` → `'`）归一化查找、54 条新词条与 Swarm 任务进度及 `Version X.Y.Z` 动态汉化。
- **2026-11-13（v5.1.6 · Antigravity `2.31.2` 全栈漂移修复、新模型汉化、Swarm 跨域子帧注入、原生幕布底色桥接与 Sonnet 对抗审阅加固）**：
  面向 Antigravity `2.31.2`（`CL=1019359392`）完成全量静态/实机审计修复与 `Claude Sonnet 5.5` 对抗复核加固：
  1. **原生缩放防双倍跳变与 `curtainView` 底色同步**：针对 `2.31.2` 新增的原生 `View` 菜单加速器（`hubZoom.js` / `menu.js`）引入 `resize` 缩放水位跟踪与 `80ms/60ms` 双向差值保护，根治 `Cmd/Ctrl + -/=/0` 双倍缩放跳变同时保留数字小键盘与欧式键盘兼容；新增 `electronNative.wcvBrowser.setThemeColor` 主动桥接（兼容 `#hex`、`rgb()`、`color(srgb)`），修复 `preload.js` 漏检导致的 `curtainView` 与 `app_storage.json` 底色失步闪白；移除宿主布尔空属性 `data-agy-theme` 误判依赖；
  2. **内置浏览器 `WebContentsView` 打孔与 `.agy-titlebar` 透明兼容**：补齐 `data-has-drawer-browser-hole="true"`、`.surface-opaque`、`.browser-hole-ancestor` 与 `[data-browser-hole="true"]` 伪元素内嵌描边豁免，保持 `.agy-sheet .agy-titlebar.bg-sidebar` 原生透明设计；
  3. **`plugin://swarm--` 蜂群协作 OOP 子帧全量接管与双向昼夜联动**：在严格隔离 HTML/Artifact 预览沙箱的前提下，打通 `plugin://swarm--` 跨域子帧的四层字体（补齐 `--font-family` 映射）、内联 `--background` 亮度双向昼夜同步与中文界面（跳过子帧 SQLite 指标空轮询），同时保护 `.msg-body`、`#raw` 与 `#swarm-title` 用户/Agent 内容零误伤；
  4. **1,500 条零大小写冲突词典、新模型家族汉化与无障碍翻译加固**：新增 406 条 `2.31.2` 界面与云端新模型词条及动态正则（全覆盖 `Orchestrator (Carbon/Argon)` 编排器与分流说明提示、`Gemini 4 Hydrogen Extra/Extra High/XHigh`、模型下线预告与周期限额标题、Swarm 面板、Automations、Coordinators、Environments、Marketplace、归档筛选与队列快捷键），放开 Lexical `[contenteditable="true"]` 与对话轮次导航点（`conversation-navigator-turn`）无障碍属性翻译并保持正文零干扰；加固 macOS `LaunchAgent` 启停竞态保护与 TCC 拦截日志收敛。
- **2026-11-12（v5.1.5 · Antigravity `2.31.1` 双端漂移合流、1,094 条零大小写冲突词典与 `DICT_CI` 兜底引擎）**：
  联合 macOS 与 Windows 双端 `2.31.1` 实机审计完成无损合流：`core/runtime.js` 新增首字母大写不敏感兜底索引 `DICT_CI`（自动兼容 `Toggle Sidebar` / `Toggle sidebar`、`Archive Conversation` / `Archive conversation` 等大小写漂移且零误伤小写标识符），补齐 `No more older messages, showing X of Y` 与 `Go to turn X of Y` 动态无障碍翻译；`core/i18n.json` 扩充至 **1,094 条严格零大小写冲突词条**（原生兼容 Windows PowerShell 5.1 `ConvertFrom-Json`，全覆盖 `2.31.1` Fork / Best of N / 定时任务 / 快捷键编辑器 / 沙箱与浏览器权限 / 插件主题外观 / 命令面板标签并统一「置顶」用语）；`core/theme.css` 兼容 `2.31.1` 布尔空属性 `[data-active=""]`；`install.mjs` 屏蔽 Node 22 `node:sqlite` `ExperimentalWarning` 保持 CLI JSON 输出绝对纯净。
- **2026-11-11（v5.1.4 · 实时指标胶囊运行态同行稳定化与 `flex-col` 越界根治）**：
  修复 `2.31.0` `.surface-composer-card`（`flex-direction: column`）下折行胶囊 `flex-basis: 100%` 纵向撑高溢出输入框底边的 CSS 缺陷；回调常规窗口恒定同行阈值（`< 165px` 窄栏进入、`>= 180px` 滞回恢复），并为 `ResizeObserver` 补齐左右按钮组宽度签名监听与会话路由切换强制重算，彻底消除会话运转时指标行掉出框外及跨会话状态串染。
- **2026-11-11（v5.1.3 · Antigravity `2.31.0` 双端全量合并与性能/安全深度加固）**：
  1. **`2.31.0` 新架构全量对齐与 900 条汉化词典**：适配 `[data-markdown-root]` 流式渲染容器、Lexical 输入框与占位符等距 Slab 排版、生成中止按钮（`input-cancel-button`）昼夜双态样式、Base UI `[role="listbox"]` 弹层排版、`electronNative.resetZoom` 重置缩放 API 与内置浏览器透明打孔（`data-has-browser-hole`）；词典扩充至 **900 条零重复词条**，并补齐模型努力程度（`Low/Medium/High/Max`）、权限模式、对话轮次与相对时间的动态翻译及权限编辑器 `aria-label="Cancel"` 安全豁免；
  2. **`O(1)` 性能跃迁与全生命周期无逃逸治理**：`core/daemon.mjs` SQLite 遥测引擎升级为双游标独立坐标系 `O(1)` 增量读取（支持 `Undo` 回退自愈与 `200ms` 锁超时），消除超长会话全表扫描开销；`core/runtime.js` 引入 `WeakMap` 不可变容器 `O(1)` 缓存短路、早期 `<head>` 注入 `DOMContentLoaded` 自愈挂载、胶囊实测宽度滞回防抖与 `ctx.onCleanup(fn)` 生命周期钩子；`install.mjs` 升级为 JSONC 注释安全 `argv.json` 解析、Windows 单一权威 `schtasks` 自启与无竞态卸载还原。
- **2026-11-11（v5.1.2 · `2.31.0` 内置浏览器透明打孔、用量/右侧边栏汉化与 Opus 对抗审查加固）**：
  修复内置浏览器 `data-has-browser-hole="true"` 透明打孔兼容、`html[style]` 昼夜切换竞争、`<input>` 占位符翻译引擎、`applyThemeVars` 样式表优先级顺序及 macOS `LaunchAgent` 孤立进程 `PATH` 注入。
- **2026-11-10（v5.1.1 · Windows DirectWrite 双轴可变字体与计划任务常驻修复）**：
  兼容 OpenType `STAT` 表 `opsz` 轴生成的 `'Anthropic Serif/Sans Web Display Light'` 家族名及 macOS `CoreText` PostScript 名称，接入 Windows `schtasks` 计划任务常驻与 `.gitattributes` `CRLF -> LF` 自动自愈。
- **2026-11-10（v5.1.0 · 昼夜双模式独立解耦 & 全栈去冗余精简）**：
  白天模式保留三套暖纸预设与古朴暗红蜡封，黑夜模式还原官方 `onyx` Default Dark 碳黑配色（`#070708` / `#111114` / `#15151A` / `#2F71E3`），并通过 CSS 变量化重构精简 47% 样式体积。
- **2026-11-04 ~ 2026-11-10（v5.0.0 ~ v5.0.1）**：
  升级为「`core/` 只读黄金内核 + `user/` 2.5 秒可逆热重载改装层 + `install.mjs` 生命周期 CLI」架构，完整对齐 `2.30.0` `Knowledge Work` 模式。
