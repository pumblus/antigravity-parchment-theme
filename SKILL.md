---
name: antigravity-parchment-theme
description: Antigravity 暖纸主题与增强补丁（macOS 专版 6.0.6-eric.1，基于 Anarcadia/chuanban-antigravity-theme-patch）。适配 Antigravity 2.36.0+，提供类 Anthropic 暖羊皮纸/暖墨黑零投影昼夜主题（支持 modules.theme=false 独立关闭以保留官方原生皮肤）、Anthropic 三族字体 + PingFang SC、2,258 条静态汉化与原生右键菜单 REV=3 跨隔离世界汉化、仿 Claude 扁平右键浮窗与 macOS 外部 IDE 桥接、外观 [EN | 中文] 免刷新切换、底部圆环指标胶囊与实时模型配额（含 2.36.0 浮动展开框）、以及冷热分层双语 Token 统计。采用「core/ 只读核心 + user/ 2.5s 热重载改装层 + install.mjs CLI」。当用户提到安装、升级、定制或排查 antigravity-parchment-theme / 暖纸主题补丁时触发。
---

> **上游致谢与分支定位**：本仓库（`antigravity-parchment-theme`）是基于 **[忒修斯的船板（@Anarcadia）的 `chuanban-antigravity-theme-patch`](https://github.com/Anarcadia/chuanban-antigravity-theme-patch)**（MIT 协议）维护的 **macOS 专用个人融合分支（`6.0.6-eric.1`）**。移除了 Windows/WSL/Linux 代码、上游莫兰迪与 5 槽切换器、自动重启（`relaunch`）、`--sync-user`、字体自动下载镜像、`coldBootHealer` 与外部中文标题 Python 脚本路径；保留上游核心热重载架构、Browser 级 CDP 事件发现、只读 SQLite 遥测/冷热分层双语 Token 统计、Electron 原生右键菜单汉化、macOS 精简版仿 Claude 右键浮窗/IDE 桥接与 `2,258` 条汉化基线，并加入 Anthropic 暖纸/暖墨视觉规范（可独立关闭 `modules.theme: false`）与底部模型配额显示（`modules.quota`）。完整差异与验证边界见 [FORK.md](FORK.md)。

> **2.33.0+ 启动边界**：客户端默认不再暴露本地 CDP。本分支不引入自动退出/重启、`--force` 接力、快捷方式改写或启动器回收。必须先取得本地调试及安装授权，再在已保存工作、退出客户端后由用户显式以 `--remote-debugging-port=0` 启动；端口文件存在不等于端点可用。

# Antigravity 暖纸主题与增强补丁（macOS · `6.0.6-eric.1`）

> **致执行端 AI Agent 的核心原则**：
> 1. **直接部署预封装核心，不要重写**：样式、词典、DOM 引擎与守护进程都在只读的 `core/` 目录，直接运行 `node install.mjs install` 完成部署；
> 2. **个性化改动仅限 `user/` 目录**：`user/` 目录在升级时默认原样保留不覆盖，修改保存后守护进程每 `2.5s` 自动热重载；
> 3. **严守平台与隔离边界**：仅支持 macOS（全局安装会注册 `LaunchAgent`）；任何 `--target-dir` 沙箱演练不得触发宿主服务或客户端操作。

---

## 一、项目入口与字体前提

- **本分支仓库**：<https://github.com/pumblus/antigravity-parchment-theme>
- **上游原版仓库（致谢）**：<https://github.com/Anarcadia/chuanban-antigravity-theme-patch>
- **字体说明**：本仓库不打包闭源商业字体。若本机未安装 `Anthropic Sans` / `Anthropic Serif` / `Anthropic Mono`，请引导用户自行安装至 `~/Library/Fonts/`（或运行 `node install.mjs install-fonts --from <字体目录>`）；未安装时将自动回退至 `PingFang SC` 与系统字体族。

---

## 二、Node.js 分级兼容策略

守护进程（`core/daemon.mjs`）按运行时版本自动分级：

| 运行时版本 | 昼夜主题 / 字体 / 2,258 条汉化 / 右键浮窗 / 底部配额 | 死锁自愈 / 中文输入法缩放兜底 | SQLite 实时指标胶囊 & 冷热分层 Token 统计 (`node:sqlite`) |
| :--- | :---: | :---: | :---: |
| **Node.js `>= 22.13.0`**（推荐） | ✅ 启用 | ✅ 启用 | ✅ 自动启用 |
| **Node.js `22.0.0 ~ 22.12.x`** | ✅ 启用 | ✅ 启用 | ⚠️ 自动降级关闭 |
| **Node.js `< 22.0.0`** | ❌ `install.mjs` 拦截提示 | — | — |

---

## 三、目录结构：`core/` 只读核心 + `user/` 改装层

安装后部署于 macOS 路径 `~/.gemini/antigravity/theme-patch/`（与上游共享目录以防双守护冲突，不可同时安装）：

```text
antigravity-parchment-theme/
├── install.mjs                 # macOS 生命周期 CLI（install / install-fonts / doctor / verify / rollback / uninstall / build-manifest / pack）
├── SKILL.md                    # 面向 AI Agent 的部署与二次改装规范（本文件）
├── README.md                   # 项目介绍、差异对比与快速上手
├── FORK.md                     # 与上游的逐版差异、视觉规范与验证记录
├── CHANGELOG.md                # 变更日志（含上游历史记录）
├── LICENSE                     # MIT License（保留原作者与本分支版权声明）
├── core/                       # 【只读核心】随版本升级整体替换，Agent 不得直接修改
│   ├── manifest.json           # 版本号（6.0.6-eric.1）、仓库元信息与 core/* SHA-256 清单
│   ├── daemon.mjs              # Node CDP 守护进程（Browser 级 CDP 事件发现、原生右键菜单 IPC 钩子、macOS 外部 IDE 白名单桥接、只读增量 SQLite 指标与 Token 统计、Swarm 裁剪注入、2.5s 热重载）
│   ├── runtime.js              # 浏览器注入引擎（三段式样式隔离、modules.theme 开关、昼夜与幕布同步、外观 [EN | 中文] 切换、2,258 条词典 + DICT_CI、仿 Claude 右键浮窗、底部圆环胶囊、React Fiber 配额显示、双语 Token 统计、中文输入法缩放兜底）
│   ├── theme.css               # 类 Anthropic 暖纸/暖墨无投影扁平样式表（零 #FFFFFF、零 box-shadow、零 :has()，含 2.36.0 浮动输入框适配与控件宿主变量继承）
│   └── i18n.json               # 2,258 条零大小写/弯直引号冲突基准词典（Object.create(null)）
└── user/                       # 【用户改装层】升级时原样保留不覆盖，守护进程每 2.5s 热重载
    ├── config.json             # 开关配置（enabled / channel / preset / metricsMode / contextLimit / contextLimitOverride / modules / themeVars）
    ├── custom.css              # 自定义追加 CSS（独立挂载于 #antigravity-user-custom-style）
    ├── i18n.override.json      # 自定义词条覆盖或新增（扁平键值对或 "exact": { ... }）
    └── custom.js               # 前端自定义 JS 钩子（支持 ctx.onCleanup(fn)）
```

---

## 四、AI Agent 标准部署流程

当用户要求安装或更新本补丁时，按顺序执行以下 3 步：

### Step 1：环境、字体与源码同步检查
```bash
node install.mjs doctor
```
- 检查 `node.tier`、`fonts.anthropicInstalled`、`antigravity.cdpStatus` 与 `coreIntegrity.sourceSync`。
- 若缺少字体，提示用户自行安装至 `~/Library/Fonts/` 或运行 `node install.mjs install-fonts --from <目录>`。

### Step 2：取得本次安装权限确认后执行安装
```bash
# 默认安装（channel="auto"，单守护进程同时监听 Stable 与 Insiders）
node install.mjs install

# 仅监听单一通道
node install.mjs install --channel stable
```
`install.mjs install` 会依次完成：
1. 校验 `core/manifest.json` 的 4 个核心文件 SHA-256 完整性；
2. 当 `core/` 有变化时，先校验旧快照（兼容 `antigravity-parchment-theme` 与旧 `chuanban-antigravity-theme-patch` 备份）再更新 `core.prev/`；
3. 更新 `core/`，**原样保留既有 `user/` 文件字节**（保留自定义 `selectors` 与 `allowedOrigins`）；
4. 探测 `DevToolsActivePort` 本地端点；未连通时只输出显式启动建议，绝不自动关闭或重启客户端；
5. 生成 `~/.gemini/antigravity/scripts/antigravity-font-daemon.mjs` 兼容包装脚本，解析稳定的 Homebrew/fnm Node 软链，注册 macOS `LaunchAgent`（`com.antigravity.theme`）。

### Step 3：CDP 实机注入验收
```bash
node install.mjs verify
```
确认输出 `"ok": true`、`"version": "20261128-v6.0.6-eric.1-..."`、`"bodyReady": true`、`"hasStyle": true`、`"uiLang"` 与 `"pillMounted": true`。仍需人工或实机抽查明暗切换、字体命中、底部配额、右键浮窗与设置弹窗 Token 统计，不可仅凭标志位宣称全部体验无误。

---

## 五、隔离与安全边界

- 本分支不支持 `--sync-user`，不以覆盖方式改写已有 `user/` 文件。
- 显式 `--target-dir` 为隔离演练模式：不修改宿主 `argv`、包装脚本或系统服务，且禁止搭配 `--register-service`。
- 已移除历史上游 `coldBootHealer` 与 `Page.reload(ignoreCache)` 路径，绝不未经确认自动刷新窗口。
- **底部模型配额模块（`modules.quota`）**：默认启用（Swarm 子帧强制关闭），通过只读遍历前端 React Fiber 调用宿主已有 `retrieveUserQuotaSummary()`，不接触凭据、不拦截网络请求；采用事件驱动 + `20s` 全局节流 + `120s` 兜底轮询 + `document.hidden` 休眠。若需完全关闭，仅需在 `user/config.json` 设置 `"modules": { "quota": false }`。

---

## 六、个性化改装与排障

**修改原则**：所有个性化配置仅在 `~/.gemini/antigravity/theme-patch/user/` 下修改，保存后约 2.5 秒热生效，**无需重启守护进程或 Antigravity**。

### 1. 修改配色预设、指标样式、字号变量或模块开关（`user/config.json`）

上下文水位优先级为正数 `contextLimitOverride` > 当前会话元数据窗口 > `contextLimit`（默认 `256000`）。

```json
{
  "enabled": true,
  "channel": "auto",
  "preset": "high-contrast",
  "metricsMode": "compact",
  "contextLimit": 256000,
  "modules": {
    "theme": true,
    "i18n": true,
    "metrics": true,
    "quota": true,
    "tokenAnalytics": true,
    "contextMenu": true,
    "composerWaxSeal": true,
    "deadlockHealer": true,
    "zoomShortcuts": true,
    "cdpEventDiscovery": true,
    "customCss": true,
    "customJs": true
  },
  "themeVars": {
    "--ag-chat-font-size": "16px"
  }
}
```
- **独立主题开关（`modules.theme`）**：默认 `true`（启用 Anthropic 暖羊皮纸浅色 / Slate Dark 暖墨黑与三族字体）；设为 `false` 时完整剥离视觉/字体覆盖并还原原生幕布底色，可配合官方 Everforest / Nord / 默认主题同时保留全部汉化、配额、指标、Token 统计与右键浮窗功能。
- **`metricsMode`**：`"compact"`（默认 SVG 圆环 + 4 行条形详情卡）或 `"full"`（完整内联速度文字）。
- **`modules`**：支持单独关闭任意子模块（如 `"theme": false` 保留官方主题、`"quota": false` 关闭底部配额、`"i18n": false` 退回英文）；顶层 `"enabled": false` 将在 2.5 秒内完整撤除注入样式并还原英文界面。
- **`themeVars`**：注入至 `#ag-user-theme-vars`（`--ag-dark-*` 作用于黑夜模式，`--ag-*` 作用于 `:root, body`，普通色彩变量仅作用于白天模式）。

### 2. 追加 CSS / 覆盖汉化 / 编写自定义 JS
- **`user/custom.css`**：标准 CSS，挂载于 `#antigravity-user-custom-style`；针对单模式请加 `body:not(.dark)` 或 `body.dark` 前缀。
- **`user/i18n.override.json`**：扁平键值对 `"英文原词": "自定义中文"`（或 `"exact": { ... }`），实时生效且可热还原。
- **`user/custom.js`**：在 `try/catch` 中执行（仅隔离异常，非安全沙箱），接收 `ctx`（`version` / `preset` / `config` / `modules` / `themeVars` / `dict` / `metrics` / `syncPreset()` / `ensureMetricsPill(true)` / `onCleanup(fn)`）。

### 3. 排障、回滚与卸载
```bash
# 安全模式：绕过 user/ 层，仅注入 core/ 定位配置冲突
node install.mjs verify --safe-mode

# 完整性、源码同步、字体与 CDP 状态诊断
node install.mjs doctor

# 回滚到上一次有效 core 备份并重新注入
node install.mjs rollback

# 彻底卸载（停止 LaunchAgent 并还原当前窗口样式与英文界面，保留 user/）
node install.mjs uninstall
```
