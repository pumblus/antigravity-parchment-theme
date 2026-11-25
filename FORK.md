# 融合分支说明

## 来源与版本

- 版本：`6.0.3-eric.1`（macOS 专用）。
- 集成基线：Anarcadia 上游 `v5.3.0`，提交 `6a263b50cb575b22059f4429a9ba9625c0c540df`；本轮选择性精简移植至 `v6.0.3` / `c345f54`，不是完整合并。
- 选择性移植：Eric 的 PR #2，提交 `3de258fd58ccb048f9fc804ee17dce5db1348d0a`。
- 保留 `d0d7d87` 及之前的全部用户设计提交；未推送、未触发远端 CI。

## 融合内容

1. 保留上游 2.31.1 的新增行为：大小写兜底词典查找（精确匹配优先、避免误译小写标识符）、对话轮次跳转/历史加载动态标签、侧栏 `data-active=""` 状态、Node 22 SQLite 实验性警告处理。
2. 保留上游昼夜主题、输入框/指标胶囊布局、SQLite 增量指标、翻译隔离与热重载清理机制。
3. 严格对齐 Anthropic 设计规范重构字体体系与 UI 视觉规范：
   - **字体体系**：补齐 `Anthropic Serif` / `Anthropic Serif Display` / `Anthropic Sans` / `Anthropic Sans Display` / `Anthropic Mono` 的 `300/400/500/600/700` 静态字重与真斜体（`italic`）映射（保留上游可变 Web 字体优先）；西文与数字严格遵循 Anthropic 三族及纯西文回退，中文统一优先回退 `PingFang SC`；打字输入框（Lexical / `textarea` / `input` / 占位符）、快捷键 `<kbd>`、实时指标胶囊与悬浮面板统一回归 `Anthropic Sans`（指标配 `tabular-nums` 等宽数字），首页欢迎语采用 `Anthropic Serif Display`（`400`），代码、路径、Monaco 编辑器与终端严格保留 `Anthropic Mono`，清理非标 `450`/`520` 字重与人工 `text-shadow`。
   - **UI 色彩、表面层级与扁平同心几何**：白天模式全面对齐官方暖羊皮纸色阶（`#F0EEE6` Ivory Medium 侧栏与托盘、`#FAF9F5` Ivory Light 主阅读区与卡片、`#E3DACC` Oat Warm 选中态、`#141413` Slate Dark 主文字、`1px solid #CCCBC8` Stone 细线分割，严守零 `#FFFFFF` 纯冷白）；移除输入框 `1.5px` 暗红蜡封外框与全部悬浮 `box-shadow` 投影，改用扁平纸张层叠与 `1px` 石色/暖墨细边三态过渡；收敛 `#D97757`（悬停 `#C6613F`）陶土色仅作用于发送主按钮，移除工具栏悬停与搜索框聚焦的陶土色装饰；Markdown 正文链接补齐常驻 `1px` 细下划线；圆角体系对齐 macOS HIG 同心梯度与超椭圆连续曲率（`corner-shape: superellipse(1.5)`：主画布/弹窗 `12px`、输入框外框 `12px` → 内卡片 `11px`、气泡/代码块/菜单外框 `10px` → 菜单高亮项 `6px`、侧栏行与搜索框 `6px`、行内代码 `4px`，同时保留底栏 `rounded-full` 胶囊与圆形主按钮纯正弧度）；黑夜模式由冷调碳黑+谷歌蓝重构为 Anthropic/Claude 暖墨黑反色体系（`#141413` Slate Dark 背景、`#191917` 侧栏、`#1F1E1C` 卡片、`1px solid #3D3D3A` 暖墨细边、`#FAF9F5` 暖象牙文字与 `#D97757` 陶土主按钮）。
4. 保留上游全部 1740 个词条，词典扩至 1756 条（忽略大小写及弯直单引号也无重复）。选择性合入 PR 的自然文案与常用操作，保留 `Thinking → 正在思考`、更自然的反馈按钮以及新版本“取消生成”标签。`Turbo` / `Turbo mode` 统一为“完全模式（Turbo）”，避免被理解为单纯加速；工作区外访问警告明确保留凭证、密钥与提示注入风险。 `New` 使用上游新增的上下文规则：操作按钮为“新建”，模型徽标为“新”；不再用静态词条抢先覆盖。
5. 不移植 `--sync-user`。保留已有 `user/` 文件；没有显式配置变更时，`config.json` 的内容与格式均不重写。不再因默认 `inputBoxId` 而删除整组自定义 selectors；上游运行时兼容处理仍在内存中进行。

## 6.0.3-eric.1 源码选择性融合（2026-11-25）

- 保留本分支 Anthropic 暖羊皮纸（`#FAF9F5` / `#F0EEE6` / `#E3DACC`）与 Slate Dark 暖墨黑（`#141413` / `#191917` / `#1F1E1C`）视觉体系、`Anthropic Sans/Serif/Mono` + `PingFang SC` 字体栈、零 `#FFFFFF`、零 `box-shadow` 与 macOS 同心超椭圆几何；选择性移植上游 `v6.0.0..v6.0.3` 中适用于 macOS 专版的交互、性能与 Antigravity `2.35.1` 适配：
  1. **三段式样式隔离、单层输入框与零 `:has()` 性能清理（`core/theme.css` / `core/runtime.js`）**：
     - 拆分 `#ag-font-faces`（常驻 `@font-face` 注册表，永不移动）、`#ag-custom-fonts`（主题规则）与 `#ag-ui-widgets`（语言切换、指标胶囊、Token 统计）三段 `<style>`；
     - 输入框外框去内边距、内卡去独立描边，收敛为单层 `1px` 扁平细边并保持 `12px/11px` 同心圆角与顶栏托盘分隔；
     - 移除 `core/theme.css` 与 `core/runtime.js` 中全部 `:has()` 反向选择器；补充侧栏不透明 `--sidebar` 覆盖、工具栏按钮柔和焦点态及暖羊皮纸/Slate Dark 低饱和 `--syntax-*` / `--color-diffEditor-*` 变量。
  2. **设置 → 外观免刷新 `[EN | 中文]` 语言切换与 `2.35.1` 汉化（`core/i18n.json` / `core/runtime.js` / `core/daemon.mjs`）**：
     - 仅在 `.agy-card` 末尾挂载独立 `[EN | 中文]` 切换行，不改动原生 3 枚主题按钮；切换时免重新注入实时翻译/还原全部页面与 Swarm 子帧，并经 `__agSetUiLang` 原子写回 `user/config.json` 的 `modules.i18n`（保留其余字段）；
     - 词典扩至 `2,226` 条（零重复、零大小写与弯直引号碰撞，统一双引号与“任务组”/“浏览器 Agent”术语），完成 `2.35.1` 35 处 Title Case → Sentence case 迁移，补齐子 Agent、步骤计划、面包屑实体防误译、蜂巢图谱动态规则及 Swarm 1.5s 轮询实例级 DOM 防闪烁护盾。
  3. **底部圆环指标胶囊与 Token 统计升级（`core/daemon.mjs` / `core/runtime.js` / `core/theme.css`）**：
     - 默认切换为 `metricsMode: 'compact'`（SVG 圆环进度 + 4 行条形悬浮详情卡，仍支持 `metricsMode: 'full'`），补齐 Claude 合并思考展示、子 Agent/Swarm `step_type = 101` `[Message]` 唤醒轮次口径、`dbFound` 远程 SSH 采样门禁、260ms 悬停意图防误触、自愈订阅重试、DOM 局部观察器与 2-hop 队列合批；
     - Token 统计升级至 `TA_CACHE_SCHEMA_REV = 5`（55 项模型标签映射、合并配额池名为 `Claude`、跳过全零行、Swarm `worker` 归入实际成员名），前端升级为容器查询 `4:3` 布局、CSS `subgrid` 列对齐、定高日期舞台、常驻筛选条与 `ResizeObserver` 溢出渐隐遮罩。
  4. **诊断增强（`install.mjs`）**：`inspectLiveWindow` 增加 `uiLang` 字段；`doctor` 新增 `coreIntegrity.sourceSync` 比对源码仓库与已安装目录的 SHA-256 同步状态。
  5. **底部指标胶囊与悬浮卡模型配额显示（融合版独占，2026-11-25）**：
     - 通过只读遍历页面 React Fiber 发现宿主已有 `retrieveUserQuotaSummary()` 服务（不依赖混淆名、不接触凭据或网络拦截、Swarm 子帧禁用，支持 `modules.quota: false` 关闭），解决客户端运行期间锁死模型选择器导致无法查看用量的问题；
     - 底部指标胶囊右侧以 `1px × 10px` 细竖线衔接极简斜杠格式，常驻显示 Gemini 剩余额度（中文 `5h X% / 周 Y%`、英文 `5h X% / 7d Y%`，空会话可独立挂载；`≤25%` 琥珀预警、`≤10%` 砖红告警）；悬停详情卡底部追加「模型用量 / Model Quota」双列同心卡，并列展示 Gemini 与 Claude & GPT 各自 5h/周余量、4px 进度条及重置倒计时（不侵入设置弹窗 Token 统计）；
     - 采用事件驱动 + 节流刷新（初始化含 `0.8s/2.5s/6s` 重试、新步骤 `3.5s` 防抖、悬停超 `45s` 后台补刷、借既有 3s 巡检满 `120s` 或重置归零补刷，全局 `20s` 最小间隔、单飞去重且 `document.hidden` 静默），并补齐 `tests/quota-pill.test.mjs` 3 项单元与无头 Chrome 回归测试。
- 未带入上游莫兰迪色与 5 槽主题切换器、外观「跟随系统」开关、Google Sans Flex / macOS 润墨、`claude-warm` 预设、Windows/WSL/Linux 代码及 `v6.0.2` Google Drive 字体自动下载器。

## 5.5.5-eric.1 源码同步与实机热更新（2026-11-23 UTC）

- 选择性合入上游 `v5.5.5`（`7cfffb8`）中适用于 macOS 专用融合版的变更：
  1. **`2.34.0` 编排器两处汉化补齐（`core/i18n.json`）**：补齐系统设置「编排器设置」说明文案与聊天模型选择器编排器行悬停提示两处词条，基准词典由 `1,956` 条增至 `1,958` 条（零重复、零大小写与弯直引号碰撞）。
  2. **MIT 开源协议声明（`LICENSE` / `install.mjs`）**：在仓库根目录补充上游 MIT `LICENSE`（保留原版权声明），并将其纳入 `install.mjs` `buildDistZip()` 打包清单。
  3. **版本号同步（`core/daemon.mjs` / `core/runtime.js` / `install.mjs` / `core/manifest.json`）**：升级至 `5.5.5-eric.1` / `20261123-v5.5.5-eric.1`。
- 未带入上游 Windows 与非 LaunchAgent 专属变更：Windows 计划任务 `TimeTrigger` 5 分钟保活与 `doctor`/`install` XML 触发器自检（融合版使用 macOS `LaunchAgent` 原生 `KeepAlive`）、`--keep-alive` 跳过 `rebuildBundleIfNeeded()`（无该轮询路径）、`install.mjs` `detached: true` 后台 `spawn` 固定 `cwd`（无 `detached spawn` / `relaunch` 路径），以及直接写入 `/tmp/ag-theme-daemon.log` 的 `uncaughtExceptionMonitor`/启动日志（延续不直接追加共享 `/tmp` 文件的安全边界，且 `LaunchAgent` 已将 `stdout`/`stderr` 重定向至 `/tmp/antigravity-font-daemon.{log,err}`）。
- 验证与部署结果：三项语法检查、`142` 项单测与 `195` 项全量回归（含新增 `tests/v555.test.mjs` 2 项）全部通过（0 失败 / 0 跳过）；`node install.mjs pack` 生成 `dist/chuanban-antigravity-theme-patch-v5.5.5-eric.1.zip` 并校验 4 个核心文件 SHA-256 及 `LICENSE` 入包。随后执行 `node install.mjs install` 热更新至 `~/.gemini/antigravity/theme-patch`（保留 `user/`、不重启客户端），`verify` 与 `doctor` 实测确认当前运行中 Antigravity 主窗口及 3 个 Swarm 子帧已注入 `20261123-v5.5.5-eric.1-stable-f51d0cce`，`dictCount: 1958`、`hasStyle: true`、`coreIntegrity.clean: true`、`LaunchAgent` 正常运行。未提交、未推送远端。

## 5.5.4-eric.1 源码同步与实机热更新（2026-11-22 UTC）

- 选择性移植上游 `v5.5.4`（`c1e72d3` / PR #28 `83f5451`）中适用于 macOS 专版的 Token 统计全链路加速、归因校准、前端交互与 CSS 层叠优化：
  1. **Token 统计 SQLite 增量引擎与磁盘持久化（`core/daemon.mjs` / `install.mjs` / `.gitignore`）**：
     - 合并重复的 Protobuf 解码器为 `parseProtoAll(buf, tolerant)` 并统一复用于指标与统计；`taResolveStepLookup` 改为二分查找；
     - `steps` 查询通过 SQL `CASE` 跳过 `step_type = 132` 冗余 `step_payload` 溢出页（保留完整 `metadata` 与 `step_type = 14/101` 所需内容），0 调用空库直接短路；近 24h 活跃库保留 `_inc` 状态，按 `WHERE idx >= ?` 配合冻结行 `len` 与前 24 字节 `hex` 锚点增量重读尾部（Undo 改写历史行时自动回退全量重算，并清理上游冗余的 `aRow.headHex === undefined` 校验）；
     - 新增带 `TA_CACHE_SALT` 算法指纹的 `.cache/token-analytics-index.json` 单飞异步原子磁盘缓存（损坏或盐值不匹配自愈、`--safe-mode` 豁免、`force === 'hard'` 全量重算、2 秒防抖落盘；10 分钟空闲 GC 同步重置磁盘加载标记与 IPC JSON 缓存）；`install.mjs uninstall`（含 `--target-dir` 沙箱）自动清理 `.cache/`，`.gitignore` 忽略 `.cache/`；
     - 将 `memory` 归因收窄为工具名 `memory_*` 或工具 JSON 入参路径（`Path`/`TargetFile`/`File`/`path`/`file_path`/`uri`）匹配 `MEMORY.md`/`knowledge`/`memories`，消除正文误判；合入 `2.34.0` Orchestrator 规划时间线归因（`step_type = 14/101` + `exit_plan_mode` + `Orchestrator (...)` 标签格式化）；修正 `taClassifyModelPool` 中 `usedClaude` 优先度并补齐 6 条新模型映射；IPC 回包升级为缓存化 `JSON.parse("<escaped>")`，为 `runTokenAnalyticsQuery` 的 `.finally()` 补 `.catch(() => {})`。
  2. **前端视图模型缓存、防粘滞浮层与表格防溢出（`core/runtime.js` / `core/theme.css`）**：
     - 时间窗新增「今日」（`data-range="1"`）并在切换范围时自动清理越界 `selectedDate`；支持 `Shift+点击刷新` 触发 `'hard'` 重算，已有数据刷新时仅置灰按钮不闪清面板；缓存 TTL 调至 60s 并结合 `__ag_last_metrics.sig` 变化及弹窗关闭 >3s 重开自动刷新；
     - 引入 `taCalcDateRangeBounds`（含跨午夜时钟校正）、`cachedBaseVm` + 预置 `_searchHay` 的 `baseSessions` 与 `80ms` 搜索防抖；热力图浮层改为按需挂载/卸载 6 个全局监听器（未悬停时为 0）并按格子坐标居中定位，滚动/滚轮/缩放/失焦/`Escape`/移出即关；`modalObs` 消除数组展开并将重扫条件收窄为 `tabActive && !panel.isConnected`；沿用本分支单事件委托与 `ag-ta-num-font`；
     - `core/theme.css` 将输入框三态改为「具体会话基础层 + 首页高特异度覆盖」，消除 3 条 `:not(:has(...))` 反向子树匹配（完整保留 1px Stone/Cloud Dark/Slate 扁平细边与零阴影）；补齐会话表列宽省略、悬停横向滚动条与 `#ag-ta-tooltip` 隐藏去延迟，保持暖纸/暖墨与零纯白规范。
- 未带入上游约 450 行 Windows WSL2 异步探测（`wsl.exe` / `reg query Lxss` / `inspectWin32WslProbeDemand`）、UNC 退避回填、WSL P9 SQLite 基库复用缓存、`EPERM/EBUSY` 重试循环及暗红蜡封样式；`core/i18n.json` 本版无改动。
- 验证与部署结果：三项语法检查、`140` 项单测与 `193` 项完整回归（含 `tests/v554.test.mjs` 3 项，覆盖真实 `node:sqlite` 与本机 Chrome 无头合成 DOM）全部通过（0 失败 / 0 跳过）；`node install.mjs pack` 打包并校验 4 个核心文件 SHA-256。随后按用户要求执行 `node install.mjs install` 热更新至 `~/.gemini/antigravity/theme-patch`（保留 `user/`、不重启客户端），`verify` 与 `doctor` 实测确认当前运行中 Antigravity 主窗口及 3 个 Swarm 子帧已注入 `20261122-v5.5.4-eric.1-stable-6219e2de`，`hasStyle: true`、`coreIntegrity.clean: true`、`LaunchAgent` 正常运行。未推送远端。

## 5.5.3-eric.1 源码同步与精简边界（2026-11-21 UTC）

- 先将此前本机工作区 `5.5.2-eric.1` 提交为独立基线（`52993c9`），再选择性精简融合上游 `v5.5.3`（`0aec663`）：
  1. **`2.34.0` 界面漂移修复与性能清理**：`core/theme.css` 补齐三层浏览器打孔 `:not([data-has-three-layer-browser-hole="true"])`、内嵌面板改为自身属性 `:not([data-has-browser-hole="true"])`、行内文件胶囊（`[data-uri^="file:"]` / `[data-uri^="vscode-"]` 等）恢复 `Anthropic Mono` 与 i18n 不可变排除，非文件 `.inline-pill` 恢复 `Anthropic Sans`（不引入 Google Sans Flex 可变轴）；清理多处末尾 `*` 通配符并收窄输入框底栏选择器。
  2. **词典扩充与动态翻译增强**：`core/i18n.json` 新增 80 条至 1,956 条（零重复、零大小写与弯直引号碰撞，统一「任务组」「转为独立对话」及模型分流描述）；`core/runtime.js` 新增 `…` ↔ `...` 双向兜底、无括号模型努力度后缀（限定控件上下文）、`Quote`/`Comment` 交互控件上下文门禁、`SWARM_FRAME_ONLY_DICT` 增量状态短词，以及 i18n 观察器自写入短路、祖先去重后再判阈值（`1500` / `120`）、指标胶囊 RAF 布局合批、`scheduleRouteCheck` 防抖与 `darkColorSchemeMql` 缓存；Swarm 子帧跳过设置守卫、`resize` 与指标逻辑。
  3. **守护进程空闲轮询优化**：`core/daemon.mjs` 在 `BrowserWatcher` 在线时的非心跳拍（5/6 拍）跳过 `/json/list` HTTP 轮询，按 `fullScannedChannels` 精确清理失效缓存，仅对 `page` 绑定/同步指标；`noMetaPending` 为超过 5 分钟仍无元数据的空库增加自动退出机制。
  4. **精简版设置弹窗「Token 统计」Tab（PR #25）**：
     - 后端复用既有 `getDbStatByPath()` / `textDecoder` 并剔除全部 Windows/WSL UNC 代码（仅保留 macOS 临时目录与大小写合并），保留只读 SQLite 异步分片扫描（每 8 库/16ms 让出事件循环）、10 分钟空闲缓存回收及 Swarm/禁用态载荷裁剪；
     - 前端采用事件委托与数据驱动切换器替代循环逐项绑定，剔除未用死代码，保留零噪声设置弹窗定向观察器与 `cleanupTokenAnalyticsDom()` 无损清理；
     - 样式按融合版 Anthropic 规范重写（浅色 `#FAF9F5`/`#F0EEE6`、深色暖墨黑 `#141413`/`#1F1E1C`、`1px` 细边、零 `#FFFFFF` 与零 `box-shadow` 投影、同心圆角与 `Anthropic Sans` 等宽数字），篇幅较上游缩减逾半；不自动改写 `user/config.json`。
- 未带入上游 Windows 保活（`PT5M` / `--keep-alive` / `lockfile`）与 `.lnk` 自愈、M2 冷启动自动重启相关预筛/死端口穿透、中文标题外挂 `stale_inode` PID 门控、Google Sans Flex 外链去重与 macOS 润墨规则。
- 验证结果：三项语法检查、`138` 项单测与 `190` 项完整回归（含 `tests/v553.test.mjs` 5 项，使用本机 Chrome 无头合成 DOM 与真实 `node:sqlite` 临时库）全部通过（0 失败 / 0 跳过）；`node install.mjs pack` 打包并校验 4 个核心文件 SHA-256。本轮仅更新源码与隔离测试，未修改本机已安装目录、未重启守护进程、未推送远端。

## 5.5.2-eric.1 源码同步与 macOS 专版收敛边界（2026-11-20 UTC）

- 选择性移植上游 `v5.5.2`（`aadfc54ac4e0bf54ff24ffe3f251fae33cc7fee1`）的四项 macOS 可用改动，不是全量合并：
  1. **macOS 稳定 Node 软链解析（#20）**：`install.mjs` 新增 `resolveStableNodeExecPath()`，对 Homebrew `Cellar` / keg-only `node@22`/`node@24` 及 `fnm` 默认别名经 `fs.realpathSync` 核验同一实体后写入 `LaunchAgent` plist，并在 `doctor` 输出 `node.serviceExecPath`。
  2. **Browser 级 CDP 事件驱动目标发现（#21）**：`core/daemon.mjs` 优先读取 `DevToolsActivePort` 第 2 行 `browserWsPath`（兜底 `/json/version` 且校验回环地址与端口），订阅 `Target.setDiscoverTargets` 监听 `Target.targetCreated` / `targetInfoChanged` / `targetDestroyed`；支持 0 窗口菜单栏驻留保活、`attachingTargetIds` / `destroyedWhileAttaching` 并发清理、`syncStartMs` + `attachedAt` 防竞态误杀、`fallbackPort` 外部 Chrome/Edge/Brave 过滤、`PENDING_RETRY_DELAYS_MS = [30, 50, 100, 200]`、`modules.cdpEventDiscovery: false` 开关及 `config.json` `port` 别名。**不带入上游 M2 冷启动自动重启**。
  3. **冷启动过渡文档防误判 `non_host`（#22）**：`HOST_PROBE_EXPRESSION` 将 `about:`、`chrome-error:`、`data:` 判为 `'pending'`；`isSkippedNonHost()` 结合本地全 URL 变更失效、标题含 `Antigravity` 后 150ms 快速解封与有上限退避复检。
  4. **`syncChuanbanPreset()` 表面同步签名短路**：`core/runtime.js` 引入 `window.__ag_style_rev` 与 `window.__ag_last_surface_sync_key`，避免弹窗滚动锁修改 `body` 属性时重复调用 `syncCurtainSurfaceColor()` 触发 `getComputedStyle`。
- **彻底去除 Windows / WSL / Linux 客户端与服务支持**：
  - `core/daemon.mjs` 移除全部 WSL2 UNC 发现与退避逻辑、Windows `tasklist`/PowerShell WMI PID 校验、`node:child_process` 导入及非 macOS 路径/词典分支；
  - `install.mjs` 移除 Windows `.NET ZipFile` 打包、CRLF 自愈、VBS/`schtasks`/`HKCU\Run`/注册表字体/`WM_FONTCHANGE`、`spawn` 导入及 Linux `systemd`/`fc-cache`；对全局 `install`/`rollback`/`uninstall` 与 `install-fonts` 强制校验 `process.platform === 'darwin'`，同时保留 `--target-dir` 沙箱、`doctor --target-dir`、`pack`、`build-manifest` 与测试在 Linux CI 运行；
  - `core/runtime.js` 移除 `syncWinTitleBarOverlay()` 及非 macOS 缩放快捷键分支；`core/theme.css` 移除全部 `html[data-ag-os="win32"]` DirectWrite 规则与纯 Windows 系统回退字体名（`Segoe UI`、`Microsoft YaHei*`、`Consolas`）；
  - `core/i18n.json` 保留全部 1,876 条静态词条（含 ~10 条 WSL/Windows 界面词条），以便与上游词典对齐。
- **中文文案复核与代码清理**：
  - 按 `humanizer-zh` 原则逐项核对 `core/i18n.json` 与 `core/runtime.js` 动态文案，修正 64 条静态译文及 4 处动态模板（修正 URL 读取误译为“文件读取”、移除未在原文出现的“匿名/与提示音/插入/实时/旗舰/内置/编排模型”等增译、修正“以出于法律原因”“法律援助”“无法正常运作”“提升为主对话”“对其产生影响”“方可”等翻译腔，统一“账号”“套餐”“MCP 服务器”“Google Drive”“多方案择优（Best of N）”“暂无受阻项/暂无阻塞项”与双引号样式），保留全部 1,876 键与 `translation-review.json` 已审条目不变；同步精简 `README.md` 与 `SKILL.md` 中的宣传性用语。
  - 代码优化：`install.mjs` 移除死代码 `ALLOWED_ORIGINS`、`inspectJsoncRootObject()`、`ensureArgvRemoteDebugging()`，提取共享 `httpGetLocalJson()`；`core/daemon.mjs` 移除死函数 `getDbSignature()`，复用 `setBoundedMap()`、`readPortInfo()` 与 `httpGetLocalJson()`；`core/runtime.js` 移除死函数 `extractCascadeId()`，预计算输入框选择器、消除 `ensureMetricsPill()` 重复 `resolveBoxCascadeId()`、`isExcludedElement()` 合并非排除节点的两次 `closest()` 遍历为一次、属性 `MutationObserver` 仅更新变更属性并跳过缺失属性；`core/theme.css` 去除重复 `local('Anthropic Serif Web Text Light')`、16 处未引用阴影/边框变量并合并重复菜单项排版规则。
- 未带入上游 Windows SuperTTC 卡顿修复/退订、Google Sans Flex 外链清理与暖夜按钮观察器（本分支不存在对应代码）；v5.5.1 TDZ 修复本分支已于 `5.3.0-eric.1` 完成。
- 验证结果：三项语法检查、`134` 项单测与 `185` 项完整回归（含 `tests/v552.test.mjs` 8 项）全部通过（0 失败 / 0 跳过），`node install.mjs pack` 生成并校验 4 个核心文件 SHA-256。随后按用户明确指令对本机 `~/.gemini/antigravity/theme-patch` 执行了热安装与 `LaunchAgent` 更新。

## 5.5.0-eric.1 源码同步边界（2026-11-19 UTC）

- 选择性适配上游 `b3bc3b05afbef244c8cadae08ed04a7bbdb71b1c` 的 Antigravity 2.33.0 变更，不是全量合并。新增无 `data-newux-theme` 的几何、输入框与侧栏选中态选择器；现有宿主识别已支持裸 `data-agy-theme`，无需放宽来源门禁。
- 保留全部 Anthropic/PingFang 字体、离散字重、无文字阴影、暖纸/暖墨色值与圆角声明。不采用上游 Google Sans Flex 外链/字体注入、AgSarasaUI 映射、macOS 润墨或新配色。
- 新增 70 条汉化至 1876 条，既有 1806 条逐字保留；不可撤销浏览数据清除、麦克风异常、支线插入及设置流程时态保持原义。
- 2.33.0 不再默认开放本地 CDP。改进诊断，区分端点可达、陈旧端口文件、未运行、运行未带标志、标志存在但端点不可达、无法枚举进程。端点可达不等于认证宿主；注入/宿主检查另行验证。端口值严格限定 1–65535，拒绝非数组或非 200 的目标列表。
- **不移植 M1/M2 或 relaunch**：无自动退出/杀进程/重启、无 `--force` 重启、无快捷方式改写、无历史启动器删除、无默认 `cdpAutoRelaunch`。不再在安装时默改旧 `argv.json` 以假定开启端口。仅报告显式启动建议；实际开启本地调试、启动客户端和部署仍须另行授权。暂不扩张 Windows/Linux 的进程诊断，无法可靠识别时报告 unknown 而非假绿。
- 用户称已退出客户端仅用于明确此次源码工作不需中断会话；本轮没有启动客户端，没有执行真实安装、服务变更、注入、远程发布或改写配置。既有多分屏代次/回执、软预算、冷启动默认关闭和外部标题脚本隔离保持不变。
- 最终三项语法检查、129 项单测和 178 项完整回归全部通过（0 失败/0 跳过）。新增 9 项安装器/诊断、6 项汉化与 3 项选择器/安全测试；浏览器使用临时无头 Chrome 合成页面，没有打开真实客户端。13 个仓库用户/已安装核心及用户文件哈希不变；安装版仍为 5.3.0-eric.2。端点检查属于启发式本机诊断，实际客户端启动/注入体验及 Windows/Linux 实机尚未验收。

## 5.4.3-eric.1 源码同步边界（2026-11-18 UTC）

- 选择性移植上游主线 `0af9c2e95fb2d50f311eadad67a6604e95b1b201`（manifest/changelog 为 5.4.3，提交标题含 rc3），包含已合并的 PR #17。此前主线 `6b3783d` 已评估；不是全量合并。
- 支持多分屏、`/btw` 支线提问与子 Agent 侧栏各自绑定指标；空草稿不继承主会话数据，悬浮内容与观察器按面板隔离，窄栏按实际指标宽度折行。保留旧主胶囊 ID 供诊断/用户扩展使用，诊断增加 `pillCount`。单窗口最多订阅 12 个会话。
- 融合版额外加固异步订阅/导航/版本代次检查和逐会话渲染回执，旧 DOM 读取或旧推送不能覆盖新订阅，无渲染器不能当作推送成功。单目标串行合并同步，每批共享 45 次 DB 打开/60ms 软预算、目录索引快照和轮转顺序；预算耗尽延后，不清空已有指标。预算不跨窗口共享，不能中断单次阻塞文件/SQLite 调用，目录枚举也不是硬时限。
- 新增 50 条静态汉化至 1806 条，旧 1756 条逐字保留；补齐模型思考档位、退出码等动态文案与历史对话标题隔离。冷启动初始脚本大小快照避免 HEAD 探测污染，但实验性自动重载仍默认关闭，保留草稿/焦点/交互及令牌复检。
- 暖纸/暖墨、Anthropic/PingFang 字体、圆角与自定义配置均保留；不带入上游新深色预设切换/写回、标题外挂执行和复制修复命令，也暂不带入后台日志截断（需另行文件所有权/符号链接安全验证）。先前未验证的 Windows/WSL 大改仍不带入。
- 仅本机源码与隔离测试；不安装、不重启后台、不注入或刷新真实客户端，不推送。真实 Antigravity 2.32.2、多窗口与 Windows/WSL 实机不在本轮验收范围。
- 最终三项语法检查、113 项单测及 160 项完整回归全部通过，0 失败/0 跳过。新增 29 项：13 项 daemon（含临时只读 SQLite）、7 项安装器/词典、8 项真实 Chrome 合成 DOM 浏览器测试及 1 项冷启动资源判定单测；修订旧测试适配新多面板语义。没有安装依赖；浏览器使用临时无头资料，没有连接真实客户端。13 个仓库用户/已安装核心及用户文件哈希保持不变，安装版仍为 5.3.0-eric.2。

## 5.4.2-eric.1 源码同步边界（2026-11-17 UTC）

- 选择性移植上游宿主指纹门禁与 Swarm 宿主明暗同步，避免把普通本地网页预览当作 Antigravity 界面。宿主指纹是减少误注入的识别启发式，不是对恶意网页的安全认证。
- 保留 Eric 的暖纸/暖墨、字体、圆角、全部 1756 个词条及此前逐项择优的动态文案。Swarm 使用当前融合版配色，而非上游的新暖夜预设。若 CDP 未提供父窗口标识且存在多个同通道窗口，安全退回原生/系统状态，不猜测父窗口；真实多窗口同步仍待实际使用验证。
- 不引入新的外观按钮和配置写回，不覆盖 `user/`；没有配置写入竞态可由本轮新功能触发。BOM 与对象校验只用于配置读取。未引入大规模 Windows PID/权限与 WSL2 双轨读取更改，留待对应平台验证。
- 安装器诊断逐个识别真正宿主，避免首个预览页被误作工作区；不可读页面不当作已验证宿主，`verify` 无目标或未注入不再返回成功。诊断来源匹配拒绝 `localhost.evil` 等前缀冒充。
- 仅修改本机源码与隔离测试，不安装、不重启后台、不注入或刷新当前 Antigravity，不改远端。已安装皮肤仍为 5.3.0-eric.2。实机行为与 Windows/WSL 不在本轮验收范围内。
- 最终三项语法检查、93 项单测和 131 项完整隔离回归均通过（0 失败、0 跳过）。新增 28 项检查覆盖非宿主预览、加载/导航竞态、重注入与停用、父窗映射、缺失回调重试、系统跟随、明暗双向切换、配置 BOM/异常对象与宿主诊断。使用现有 Node/Playwright 与已安装 Chrome 的临时无头资料，没有安装依赖；默认 Playwright 浏览器缺失，显式 `CHROMIUM_PATH` 后完整通过。

## 5.3.0-eric.2 汉化择优复审（2026-11-15 UTC）

- 重新对照上游与 eric.1 的 **32 个同键分歧和 16 个补充词条**，不再以旧译优先。逐项保留/采用/改写结果记录在源码仓库 `translation-review.json`；另修复双方共有的 13 处说明，最终 43 条静态译文改变，仍为 1756 键，无缺失和大小写/弯引号冲突。
- 统一 Agent、对话、Artifact、审阅/批准/确认的含义。Turbo 保留“完全模式（Turbo）”而非速度宣传；四个静态权限选择标签与动态无障碍标签一致。文件夹权限不偷换为工作区，文档审阅不增译成“生成工件时”。完整保留查看/编辑、凭证/密钥、提示注入与其他漏洞利用风险；严格模式详情链接不再丢失。
- 遥测提示保留将来时，AI 点数 overages 译为“超额使用”而非容易误解的“抵扣”，不添加免费或具体计费承诺。默认设置文案、配套网站与应用昵称不擅增设备或本地范围。
- Thinking/Running 持续态与 Thought/Worked 完成态分开，中文时长保留“不到 1 秒/分钟”；入队立即发生、本轮结束后发送。Swarm 的 Threads 译为任务组，未完成不等于进行中；受阻、已终止及等待响应方数量按实际语义处理，专属短词仍限定 Swarm 帧。
- 指标标签明确主会话与子 Agent 分列，显示模型上下文容量，不再将其说成已验证的压缩触发阈值。macOS 用废纸篓，Windows/Linux 用回收站，平台默认先合并，个人词典覆盖始终最后生效。
- 保留全部视觉和安全边界，未修改 `user/`。三项语法检查、73 项单测、103 项完整隔离回归全部通过；新检查覆盖全部审计条目、权限标签一致、动态时态/队列、Swarm 帧隔离、平台词典覆盖和指标术语。本次源码复审不等于已执行热更新；真实部署另行取得确认。

## 历史 5.3.0-eric.1 同步边界（2026-11-15）

- 新增 110 条 2.32.1 静态词条，总计 1756 条，保留全部 1740 条上游键和原有有意选择的译文。保留 Turbo“完全模式”与凭证/密钥/提示注入警告；不修改 `user/` 模板或已安装用户文件。
- 合入动态上下文窗口与显式 `contextLimitOverride`、缓冲输出 `Hold` 指标、子 Agent 血缘统计和渐进汇总、WSL 慢路径退避；指标来自本地只读 SQLite，不发送到外部服务。同步中显示并非最终总量，实际 Windows/WSL 仍未实测；同步文件系统调用的耗时预算不是硬中断。
- 保留字体/真斜体、PingFang、暖纸暖墨、同心圆角及 Clay 仅主按钮的设计。新增 PDF SDK 变量仅在已启用皮肤的 body 范围生效，子 Agent 徽标采用中性暖灰而非上游蓝色或陶土装饰。
- 未合入中文标题外挂的 inode / lsof / ps 健康探测，也不显示依赖外挂的警告。上游新增探测并不等于移除了旧的自动执行：其启动/周期流程仍可能调用 Python `patch --auto`；本版整个外部脚本调用链均不带回。
- 实验性 `coldBootHealer` 仍默认关闭，保留上一版严格门禁；`--sync-user`、强制扩张来源白名单均未恢复。回滚仍完整校验 manifest、哈希、大小与路径，隔离目标不会操作真实自启/客户端。
- 修复上游自定义上下文上限首次启动的缓存 TDZ、显式/数组 UNC 路径退避遗漏、迟写及修正子会话血缘、临时 stat 失败误删关系。Markdown 控件属性例外区分默认规则与用户显式排除，并保留原始载荷来源；关闭皮肤时取消旧 metrics RAF，防止指标胶囊被重建。
- 主胶囊的上下文/速率仍表示主会话最新调用，子 Agent 输入与次数单列；累计输出才显示主+子合计。指标窗口是元数据报告值，不是保证实际压缩触发点。每拍 45 次 DB / 60ms 为各阶段软预算，不保证端到端 60ms，也不能中断一次阻塞的文件系统/SQLite 调用。
- 本轮仅同步源码和隔离测试，不安装、不重启守护服务、不注入或刷新真实客户端。此前 5.2.0-eric.1 已在另行取得确认后热更新，此处历史开发记录中的“未安装”仅描述当次源码阶段。

## 5.2.0 同步边界

- 合入上游 5.1.7 至 5.2.0 的 130 条新增词条及合适的译文修订、2.32.0 MCP/本地克隆动态模板、弯引号查找、Win32 缩放与原生标题栏、WSL 懒探测、PowerShell 数组修正和回滚/隔离目标改进。保留当前融合版相对于 5.1.6 上游有意选择的 54 条译文，包括 Turbo“完全模式”和凭证/密钥/提示注入警告；没有采用把权限模式叫作“极速”的译法。
- 完整保留 Eric 的字体/真斜体/字重、PingFang 顺序、暖调配色与同心圆角；仅补 Windows 可变字体别名及限定在 Windows 的轴值兼容，并重置代码/路径/编辑器/公式的轴值。
- 不带回 `--sync-user`，仓库 `user/` 模板不变。回滚只作用于 core，要求完整 manifest、SHA-256、字节数及安全文件路径，先验证 staging 再替换。任何实际替换的旧 core 都先原样快照并核对前后指纹；损坏/手改 core 的隔离快照不进入自动回滚，也不覆盖最后有效 core.prev。显式 `--target-dir` 不修改宿主调试端口、wrapper 或服务，不用 `--register-service` 绕过隔离。
- 上游冷启动自动强刷默认开启且异步回退保护不足。本版实验性 `coldBootHealer` **默认关闭**，只有显式布尔 `true` 才启动。加强上下文验证、请求 token、首页/前台/草稿/编辑焦点/IME/交互/弹窗/运行态与重注入失效检查；去除 daemon `Page.reload` 与不安全延迟回退，由请求页面最后同步复查再普通 `location.reload()`。这不保证强制绕过缓存，也不代表真实客户端草稿或跨窗状态已完全验证。
- 本轮只更新本地源码并进行隔离测试，不安装、不刷新实际客户端、不修改已安装皮肤，不发布或触发远端 CI。

## 5.1.6 同步边界

- 合入 2.31.2 的 Swarm 协作子帧、编排模型/超高思考档位动态汉化、原生缩放去重、抽屉浏览器透明保护与 LaunchAgent 启停竞态修复。
- 保留全部本地 Anthropic 字体、PingFang 中文优先回退、暖纸/暖墨色阶、扁平表面与 macOS 同心连续圆角；没有恢复上游的冷白/碳黑配色和 Slab 输入框字体。
- 显式 `user/config.json.allowedOrigins` 仍是完整覆盖（包括 `[]`）；只在未配置时使用含 Swarm 的默认来源，不把默认来源强行加回用户白名单。
- 原生幕布颜色桥接调用客户端 `setThemeColor`，会持久化应用主题色（`app_storage.json`），并非只改内存。禁用时尝试还原原生颜色；不写应用包或运行外部标题脚本。
- 此次仅同步和测试仓库源码，不安装、重启或操作正在使用的 Antigravity；实机体验按用户要求留待使用中发现问题再处理。

## 外部脚本边界

上游守护进程在 macOS 会检查 `~/.gemini/antigravity/scripts/antigravity-zh-title-patch.py` 是否存在，并定期以 `patch --auto` 执行。该脚本不在仓库中，不受 `core/manifest.json` 校验，且守护逻辑以应用内 `language_server` 二进制文件的变化作为再次执行依据。

本分支移除这条自动执行路径，也不查找或运行该外部脚本。脚本内容未被审阅，不能断言它恶意或确认其具体修改；这里只避免主题守护进程自动执行仓库外代码。若另行需要中文标题二进制补丁，应作为独立功能审阅、备份并取得授权。

`user/custom.js` 仍是用户主动维护的扩展点，具有页面 JavaScript 权限。try/catch 只隔离异常，并非安全沙箱。只使用信任的代码；`verify --safe-mode` 可跳过用户扩展层。真实安装仍会配置主题系统自启，2.33.0 的 CDP 调试启动须另行授权，本次开发没有执行真实安装或修改客户端。

## 可复现检查

运行时仍为零 npm 依赖；开发测试需要 Playwright 和 Chromium：

```bash
npm ci
npx playwright install chromium
npm run check
npm run test:unit
npm test
node install.mjs doctor --target-dir .
node install.mjs pack
```

`tests/typography.test.mjs` 包含字体静态回归与明/暗模式计算样式夹具。`tests/integration.test.mjs` 包含词典/manifest、安全边界、实际翻译函数单元测试、浏览器翻译隔离/热重载，以及安装文件/配置/备份保留。安装器测试使用临时目录和 VM，将系统服务、CDP、子进程与应用探测替换为 stub，不进行真实安装。

浏览器夹具不能替代真实 Antigravity 的 DOM、已安装字体、系统服务与实时数据库验收。`doctor` 的 `coreIntegrity.clean` 只证明文件与 manifest 一致，不能据此宣称客户端注入成功。

## 历史 5.3.0-eric.1 开发验证记录（2026-11-15 UTC）

- `npm run check` 通过三项语法检查；`npm run test:unit` 66 项通过；完整 `npm test` 96 项通过，0 失败、0 跳过（完整数包含单测）。复用 Node 24.13.1、Playwright 1.62.1 和已有 Chromium，无依赖安装。
- 新增 13 项 daemon VM/临时 SQLite 测试：真实顶层冷启动、配置变更与载荷来源、context/streamRatio、尾行替换和截断、子孙去重与缓存、仅子库更新、删除/重建、100 子库预算渐进汇总、超过 64 个占位关系、迟写/更正/暂时 stat 失败、UNC 显式及数组路径退避。文件读取限定临时目录，数据库连接断言只读，真实子进程/网络/服务替换为拒绝或 stub。
- 新增 9 项翻译/指标渲染测试：Swarm 专属文案、文本字面保留、默认 Markdown 控件属性、4 类用户显式排除、动态变更/词典覆盖与禁用清理。已有冷启动完整触发链和草稿/多窗口门禁继续通过，仍默认禁用，未做实机刷新。
- 新增 PDF 字体变量作用域、连字、插件标题、暖灰子 Agent 徽标夹具；明暗设计与保护代码/输入区的字体回归继续通过。17 项安装器临时测试包含本次真实 core 字节的安装→回滚，配置字节不变且无宿主副作用。
- 确认原 1646 条译文全部保留，完整覆盖上游 1740 键，总数 1756，原始/大小写/弯直引号均无碰撞；manifest 四文件 SHA-256 和字节数匹配。真实安装目录及 `user/` 在同步前后比对，未修改。
- 全部执行限于隔离夹具，未验证真实 Windows/WSL、字体命中、线上会话或客户端新指标。完整 Git bundle 和恢复验证结果保存在本次本机备份目录；未发布或改远端。

## 历史 5.2.0 开发验证记录（2026-11-14 UTC）

- 通过 `npm run check` 的 3 项语法检查、`npm run test:unit` 的 50 项隔离单测，以及 `npm test` 全部 72 项回归（包含明暗样式与 Windows 轴值的无头 Chromium 夹具），0 失败、0 跳过。复用本机已有 Node 24.13.1 / Playwright 1.62.1 / Chromium，没有安装依赖或操作真实客户端。
- 通过完整词典覆盖、54 条选定本地译文保留、1646 键原始/大小写/弯引号唯一与 4 个 core 文件的 manifest 哈希/字节校验。`user/` 模板和已安装 core/user 文件在更新前后按 SHA-256 比对。
- 安装器 16 项新增 VM + 临时目录测试覆盖普通安装→重装→回滚→卸载全生命周期、缺省字段/CRLF 配置字节保留、selectors、默认全局流程的 stub 行为、自定义目标/符号链接隔离、拒绝绕过隔离、坏 manifest/缺文件/坏哈希/用户备份/链接、复制与 rename 故障、最后有效备份保留、手改/损坏旧 core 原样隔离备份与卸载异常配置恢复。并非运行真实安装器。
- 冷启动 11 项新增 VM/mock WebSocket/fake timer 测试包含 attach→addBinding→HEAD 漂移→binding→指定 execution context→最后同步门禁→reload 完整链，多窗口隔离及草稿/附件/IME/弹窗/运行态/导航/焦点/前后台/热重注入/禁用/存储失败/伪造请求。默认关闭；DOM 无法证明不可见后台任务安全，普通 reload 不保证绕缓存。
- Windows PowerShell 5.1 修复仅静态检查；Windows 原生字体、IPC、任务计划与 WSL 未实测。WSL 同步 UNC 探测的 400ms 预算在调用返回后才计算，不是硬超时。
- 原 main 更新前已生成并验证完整 Git bundle。最终本地提交、恢复校验及日志位于本轮备份目录。未推送远端、触发 CI、安装新皮肤、重启服务或执行真实 Antigravity 验收。

## 历史 5.1.6 开发验证记录（2026-11-13 UTC）

- `npm run check`：三项 JavaScript 语法检查通过。
- `npm run test:unit`：22 项通过；完整 `npm test`：43 项通过、0 失败、0 跳过（包含明暗两套计算样式子测试）。使用本机已有 Node 24.13.1、Playwright 1.62.1 与 Chromium headless shell，仅打开临时夹具页面，不连接真实 Antigravity。
- 通过 manifest 的 4 个核心文件 SHA-256/字节数校验、全部 1500 个上游词条保留及 1524 键大小写唯一检查。保留原融合版 56 条有意选择的翻译；唯一不再保留的静态 `New` 由已测试的上下文动态规则替代。
- 新回归覆盖 2.31.2 编排器/超高档位/限额、New 操作与徽标区分、Lexical 和 Swarm 正文隔离、iframe 入口约束、显式来源白名单、缩放去重/重置/重注入取消、原生主题色失败重试/串行恢复，以及 LaunchAgent 已加载但无 PID 的状态判断。修复了这些边界上的上游逻辑问题；原生主题色调用若永久不完成，恢复队列仍会等待，实机 IPC 行为未在本轮验证。
- 原有 `user/` 模板不变，安装器临时目录测试确认已有配置、自定义 selectors 与备份无损。仓库更新前已保存并验证完整 Git bundle。
- 按用户要求不追加实机测试；没有重新安装皮肤、重启服务、触碰字体/应用包/个人数据，也没有推送或触发远端 CI。已安装版本的升级另行处理。

## 历史 5.1.5 开发验证记录（不代表本次结果）

- 通过：10 组非浏览器回归、三项 JavaScript 语法检查、4 个核心文件的 SHA-256/字节数校验、zip 打包后逐文件校验；确认没有删除上游词典键，`user/` 模板未改动。
- 2.31.1 新增回归覆盖大小写兜底、精确覆盖优先、小写标识符豁免、轮次跳转、历史加载及“没有更早消息”的无障碍标签。
- 浏览器夹具未完成：环境禁止 Chromium 创建进程单例 Unix socket。4 个浏览器顶层测试在启动阶段失败，其中明/暗排版包含的 12 个计算样式子测试未执行。此限制不代表 UI 断言通过。
- 真实 Antigravity、字体与活动 CDP 端口在本环境中均不存在。未执行真实安装、注册自启、修改调试端口或运行外部脚本。
- Node 22/24 GitHub Actions 工作流已随源码准备，但远端发布与 Actions 运行仍待确认。
