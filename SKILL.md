---
name: chuanban-antigravity-theme-patch
description: Antigravity 2.0 主题、字体与汉化补丁（macOS 专用融合版 5.5.3-eric.1 · 适配 Antigravity 2.34.0+、Browser 级 CDP 事件发现与在线快路径、Swarm 跨域子帧同步、原生幕布底色桥接、昼夜双模式独立配色、1,956 条无大小写冲突词典与 DICT_CI 兜底、SQLite 实时指标胶囊与设置弹窗 Token 统计）。采用「core/ 只读核心目录 + user/ 独立改装层 + install.mjs 生命周期 CLI」，支持直接部署、2.5 秒热重载定制与 --safe-mode 排障。当用户提到“安装船板 Antigravity 主题”、“升级/修复 Antigravity 汉化与字体”、“定制 Antigravity 界面样式或汉化词条”时触发。
---

> **2.33.0+ 启动边界**：默认不再暴露本地 CDP。融合版不引入自动退出/重启、`--force` 接力、快捷方式改写或启动器回收。必须先取得本地调试及启动/部署授权，再在已保存工作、退出客户端后按诊断提示显式启动；文件存在不等于端口可用。

> **融合分支说明（5.5.3-eric.1 · macOS 专用）**：此源码包选择性精简融合上游至 `v5.5.3`（`0aec663`）的 macOS 可用改进（2.34.0 三层浏览器打孔与行内文件胶囊隔离、1,956 条词典与上下文翻译门禁、Browser 级 CDP 事件发现与在线快路径、渲染器与 CSS 性能优化、以及 Anthropic 视觉风格的设置弹窗「Token 统计」Tab），移除 Windows/WSL/Linux 客户端与服务代码。详细差异见 [FORK.md](FORK.md)。本分支保留用户文件、自定义 `allowedOrigins`（显式空列表仍禁止注入）与 selectors，不使用 `--sync-user`；不自动执行仓库外的中文标题 Python 补丁。真实安装会配置 macOS `LaunchAgent` 守护服务；本地调试启动须单独授权。

# Antigravity 主题、字体与汉化补丁（macOS · 5.5.3-eric.1）

> **说明（致用户与执行端 AI Agent）**：
> - **设计目标**：通过运行时 CDP 注入，参考 Anthropic 设计规范为 Google Antigravity 提供**昼夜暖调主题与排版调整**：
>   - **白天模式（`body:not(.dark)`）**：提供三套暖羊皮纸配色预设（默认 `high-contrast`：`#F0EEE6` 侧栏 + `#FAF9F5` 阅读区 + `#141413` 暖墨字 + `1px solid #CCCBC8` 石色细边，不使用 `#FFFFFF` 纯冷白和悬浮投影），输入框采用扁平层叠与 `1px` 细边三态过渡，仅发送主按钮使用 `#D97757` 陶土色；
>   - **黑夜模式（`body.dark`）**：切换客户端「深色 / Dark」（或跟随系统深色）时，保持三族字体排版与扁平几何结构不变，切换为暖墨黑反色配色（`#141413` 主背景 / `#191917` 侧栏 / `#1F1E1C` 卡片 / `1px solid #3D3D3A` 细边 / `#FAF9F5` 文字 / `#D97757` 发送主按钮）；
>   - **全局共享能力**：Anthropic 三族中西文排版（`Anthropic Sans` / `Anthropic Serif` / `Anthropic Serif Display` / `Anthropic Mono` + 中文优先 `PingFang SC` 回退更纱黑体，适配 `[data-markdown-root]`、`data-agy-font` 与 Lexical 输入框）、1,956 条静态界面汉化（内置 `DICT_CI` 首字母大写与省略号兜底）以及基于 SQLite 只读游标的同行实时指标胶囊与设置弹窗「Token 统计」面板（使用 `Anthropic Sans` + `tabular-nums`）。
> - **执行原则**：
>   1. **直接部署预封装核心，不要重写**：样式、词典、DOM 引擎与守护进程已存放在只读的 `core/` 目录，**不要让 Agent 重写守护代码**，直接运行 `node install.mjs install` 完成部署；
>   2. **个性化改动仅限 `user/` 目录**：`user/` 目录在升级时默认保留不覆盖，修改保存后守护进程每 2.5 秒检测变更并热重载。

---

## 一、资源链接（上游字体资源与融合版源码分开）

1. **Google Drive 资源包（上游包 + 字体库）**
   - 链接：<https://drive.google.com/drive/folders/1NX92SgVUqtSjWg6bt6sIJXy-cn7J_boC>
   - 包含：**上游资源（版本需另行核对，不含本融合版）+ 字体包（Anthropic 字体族 `Anthropic Sans` / `Anthropic Serif` / `Anthropic Mono` + 更纱黑体 `Sarasa-SuperTTC.ttc`）**。
   - *备用字体获取渠道*：若大文件 `Sarasa-SuperTTC.ttc`（~791 MB）触发 Google Drive 24 小时下载配额限制，macOS 可执行 `brew install --cask font-sarasa-gothic`。
2. **GitHub 代码库（本融合分支与 `SKILL.md`）**
   - 仓库：<https://github.com/pumblus/chuanban-antigravity-theme-patch>
   - 包含：`core/` 核心代码、`user/` 改装模板、`install.mjs` CLI 与本 `SKILL.md`（字体文件请从上方 Google Drive 链接下载）。
3. **Notion 引导主页**
   - 链接：<https://chuanban.notion.site/chuanban-antigravity-theme-patch-db7c5846f37546be9481cd791aed0554>

### 上游历史实机样式参考（非本融合版验收依据）
- **三栏对话与工件视图（上游历史截图）**：[`assets/preview-workspace-chat-and-artifact.png`](assets/preview-workspace-chat-and-artifact.png)
- **新建对话首页视图（上游历史截图）**：[`assets/preview-home-new-conversation.png`](assets/preview-home-new-conversation.png)

---

## 二、Node.js 分级兼容策略

守护进程（`core/daemon.mjs`）按运行时版本自动分级，避免因 Node 小版本缺少内置 SQLite 而异常退出：

| 运行时版本 | 昼夜主题 / 扁平三态 / Anthropic 三族字体 | 1,956 条静态汉化 + 原型安全词典 | 死锁自愈 + 缩放快捷键修复 | SQLite 实时指标胶囊 & Token 统计 (`node:sqlite`) |
| :--- | :---: | :---: | :---: | :---: |
| **Node.js `>= 22.13.0`**（推荐） | ✅ 启用 | ✅ 启用 | ✅ 启用 | ✅ 自动启用（显示生成速度、耗时、上下文窗口、缓存命中率与设置弹窗 Token 统计） |
| **Node.js `22.0.0 ~ 22.12.x`** | ✅ 启用 | ✅ 启用 | ✅ 启用 | ⚠️ 自动降级关闭（无需 `--experimental-sqlite` 标志） |
| **Node.js `< 22.0.0`** | ❌ `install.mjs` 拦截提示 | ❌ 需升级至 Node 22+ | — | — |

---

## 三、目录结构：`core/` 只读核心 + `user/` 改装层

安装后部署于 macOS 路径 `~/.gemini/antigravity/theme-patch/`：

```text
chuanban-antigravity-theme-patch/
├── install.mjs                 # macOS 生命周期 CLI（install / install-fonts / doctor / verify / rollback / uninstall / pack）
├── SKILL.md                    # 面向 AI Agent 的部署与二次改装规范（本文件）
├── README.md                   # 项目说明与使用指南
├── CHANGELOG.md                # 历次版本演进与修复记录
├── core/                       # 【只读核心】随版本升级整体替换，Agent 不得直接修改
│   ├── manifest.json           # 版本号（5.5.3-eric.1）、仓库地址与 core/* 文件 SHA-256 清单
│   ├── daemon.mjs              # Node CDP 守护进程（Browser 级 CDP 事件发现与快路径、SQLite 指标与 Token 统计、Swarm 子帧裁剪注入、2.5s 热重载感知）
│   ├── runtime.js              # 浏览器端注入引擎（昼夜模式与 curtainView 底色联动、表面同步签名短路、实验性冷启动检测（默认关）、弯引号/省略号与 DICT_CI 兜底索引、设置弹窗 Token 统计、macOS 防双倍缩放保护）
│   ├── theme.css               # 五段式 CSS 样式表（Part I 共享排版与几何 / Part II 白天暖纸 / Part III 独立黑夜 / Part IV 指标胶囊 / Part V Token 统计）
│   └── i18n.json               # 1,956 条无大小写冲突标准 JSON 基准词典（挂载至 Object.create(null)）
└── user/                       # 【用户改装层】升级时默认保留不覆盖，守护进程每 2.5s 检测 mtimeMs 热重载
    ├── config.json             # 开关配置（enabled / channel / preset / contextLimit / contextLimitOverride / modules / themeVars）
    ├── custom.css              # 自定义追加 CSS（独立挂载于 #antigravity-user-custom-style）
    ├── i18n.override.json      # 自定义词条覆盖或新增（支持扁平键值对或 "exact": { ... }，优先级高于 core/i18n.json）
    └── custom.js               # 前端自定义 JS 钩子（支持 ctx.onCleanup(fn) 在热重载或卸载前清理）
```

---

## 四、AI Agent 标准部署流程

当用户要求安装或更新本补丁时，按顺序执行以下 3 步：

### Step 1：环境与字体前置检查
```bash
node install.mjs doctor
```
- **若缺少字体**：引导用户从 [Google Drive 资源包](https://drive.google.com/drive/folders/1NX92SgVUqtSjWg6bt6sIJXy-cn7J_boC) 下载字体并安装到 `~/Library/Fonts/`（或运行 `node install.mjs install-fonts --from <解压目录>`；若 `Sarasa-SuperTTC.ttc` 受限流，可用 `brew install --cask font-sarasa-gothic`）。

### Step 2：确认本次安装权限后安装并注册守护服务
```bash
# 默认安装（channel="auto"，单守护进程同时监听 Stable 与 Insiders 窗口）
node install.mjs install

# 如需仅监听单一通道，显式指定 --channel stable 或 --channel insiders
node install.mjs install --channel stable
```
`install.mjs install` 会依次完成：
1. 校验 `core/manifest.json` SHA-256 完整性；
2. 当 `core/` 有变化时，先原样校验旧快照；有效核心才更新 `core.prev/`，损坏或手改核心保存到 `backups/*-invalid-*/snapshot` 且不参与自动回滚；
3. 更新 `core/`，**初始化或保留已有的 `user/` 文件**（保留自定义 `selectors`，兼容处理在守护进程内存中完成）；
4. 优先读取 `DevToolsActivePort` 并实际探测本地端点，再尝试旧版 `9222/9223` 回退。2.33.0+ 不再默认开放端口；不能把端口文件或 `argv.json` 条目存在当作连接成功。未连通时只报告诊断与显式启动建议，不自动关闭或启动客户端；
5. 生成 `~/.gemini/antigravity/scripts/antigravity-font-daemon.mjs` 兼容包装入口，解析稳定的 Homebrew/fnm Node 软链，并注册 macOS `LaunchAgent` 后台自启服务。

### Step 3：CDP 实机注入验收
```bash
node install.mjs verify
```
当终端输出 `"ok": true` 且显示 `"version": "20261121-v5.5.3-eric.1-..."`、`"bodyReady": true`、`"themeStyle": true`、`"themeMode": "light" | "dark"` 时，说明基础运行时与样式已注入。仍需实际检查明暗切换、字体命中、界面翻译、指标数据与设置弹窗 Token 统计，不能仅凭这些标志认定所有功能通过验收。

---

## 隔离与重载边界

- 本融合版不支持 `--sync-user`，不以“备份后覆盖”替代用户文件保留。
- 显式 `--target-dir` 是隔离演练边界：不修改宿主 argv、wrapper 或系统服务。`--register-service` 不得用来绕过隔离；真实部署使用默认目标，另行取得本次安装权限。
- 回滚候选必须含完整 manifest 和四个核心文件，并匹配字节数与 SHA-256；用户文件备份不能作为核心备份。回滚只恢复 core，不恢复 user 或其他全局配置。
- `modules.coldBootHealer` 默认为 `false`，只有布尔 `true` 才启用实验功能。页面需通过首页/前台/无草稿/无输入/无弹窗任务等门禁，daemon 只对发起主上下文回调，最后在同一同步调用内复查再普通重载。不使用 daemon `Page.reload(ignoreCache)` 或 280ms 延迟强刷，不能保证绕过缓存；实机草稿与多窗口安全尚未验证。本轮维护不启用它。

## 五、个性化改装与排障

**修改原则**：所有个性化配置仅在 `~/.gemini/antigravity/theme-patch/user/` 下修改，**无需重启守护进程或 Antigravity**（`core/daemon.mjs` 每 2.5 秒检测 `user/*` 文件的 `mtimeMs` 变化并热更新已连接窗口）。

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
    "cdpEventDiscovery": true,
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
- **`preset`（白天模式暖纸预设）**：支持 `"high-contrast"`（默认暖纸）、`"claude-desktop-purewhite"`（轻浅象牙纸，不使用 `#FFFFFF` 纯冷白）、`"vintage-deep"`（深暖燕麦羊皮纸），保存后 2.5 秒内热切换；在客户端切换为深色（Dark）模式时进入暖墨黑深色模式。
- **`modules`**：支持单独开关任意子模块（含 `zoomShortcuts` 与 `cdpEventDiscovery`）；将顶层 `"enabled": false` 保存后，页面会在 2.5 秒内移除注入样式并将已翻译文字还原为英文。
- **`themeVars`**：由 `runtime.js` 注入到独立 `<style id="ag-user-theme-vars">` 节点（位于 `#ag-custom-fonts` 之后、`#antigravity-user-custom-style` 之前；`--ag-dark-*` 作用于黑夜模式，`--ag-*` 全局排版变量作用于 `:root, body`，普通色彩变量如 `--sidebar` 仅作用于白天模式，不影响黑夜模式）。

### 2. 追加或微调界面 CSS（编辑 `user/custom.css`）
直接编写标准 CSS（无需反斜杠转义），保存后 2.5 秒内在独立 `<style id="antigravity-user-custom-style">` 节点生效（位于 `#ag-user-theme-vars` 之后，优先级高于内置主题变量）。若只针对白天或黑夜微调，请分别加上 `body:not(.dark)` 或 `body.dark` 前缀。

### 3. 覆盖或新增汉化词条（编辑 `user/i18n.override.json`）
支持写入扁平键值对 `"英文原词": "自定义中文"`（或包裹在 `"exact": { ... }` 对象中）。由于运行时使用 `WeakMap` 记录原始英文文本，新增、修改或删除覆盖词条后，2.5 秒内页面上已渲染的文字会相应更新或还原。

### 4. 编写前端自定义 JS 扩展（编辑 `user/custom.js`）
脚本在 `try/catch` 隔离中执行（仅隔离异常，非安全沙箱），可访问入参 `ctx`（或同义入参 `boot`）：
- `ctx.version`、`ctx.preset`、`ctx.config`、`ctx.modules`、`ctx.themeVars`、`ctx.dict`、`ctx.metrics`、`ctx.syncPreset()`、`ctx.ensureMetricsPill(true)`、`ctx.onCleanup(fn)`（注册清理回调，在下一轮热重载或卸载前执行）。

### 5. 故障隔离、回滚与卸载（Safe Mode / Rollback / Uninstall）
```bash
# 安全模式：绕过 user/ 层，仅注入 core/ 以定位自定义配置冲突
node install.mjs verify --safe-mode

# 查看核心文件 SHA-256 校验、字体与守护进程状态
node install.mjs doctor

# 回滚到上一次有效备份并重新注入
node install.mjs rollback

# 卸载：停止守护进程与 macOS LaunchAgent，并还原当前打开窗口的样式与英文界面（保留 user/ 配置）
node install.mjs uninstall
```
