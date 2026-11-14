# 融合分支说明

## 来源与版本

- 版本：`5.2.0-eric.1`。
- 基线：Anarcadia 上游 `v5.2.0`，提交 `9e549965df1868b573a5552818d0d8f2f0ea761f`。
- 选择性移植：Eric 的 PR #2，提交 `3de258fd58ccb048f9fc804ee17dce5db1348d0a`。
- 本次源码更新位于本机 `main`；未推送、未触发远端 CI、未更改已安装皮肤。保留 d0d7d87 及之前的全部用户设计提交。

## 融合内容

1. 保留上游 2.31.1 的新增行为：大小写兜底词典查找（精确匹配优先、避免误译小写标识符）、对话轮次跳转/历史加载动态标签、侧栏 `data-active=""` 状态、Node 22 SQLite 实验性警告处理。
2. 保留上游昼夜主题、输入框/指标胶囊布局、SQLite 增量指标、翻译隔离与热重载清理机制。
3. 严格对齐 Anthropic 设计规范重构字体体系与 UI 视觉规范：
   - **字体体系**：补齐 `Anthropic Serif` / `Anthropic Serif Display` / `Anthropic Sans` / `Anthropic Sans Display` / `Anthropic Mono` 的 `300/400/500/600/700` 静态字重与真斜体（`italic`）映射（保留上游可变 Web 字体优先）；西文与数字严格遵循 Anthropic 三族及纯西文回退，中文统一优先回退 `PingFang SC`；打字输入框（Lexical / `textarea` / `input` / 占位符）、快捷键 `<kbd>`、实时指标胶囊与悬浮面板统一回归 `Anthropic Sans`（指标配 `tabular-nums` 等宽数字），首页欢迎语采用 `Anthropic Serif Display`（`400`），代码、路径、Monaco 编辑器与终端严格保留 `Anthropic Mono`，清理非标 `450`/`520` 字重与人工 `text-shadow`。
   - **UI 色彩、表面层级与扁平同心几何**：白天模式全面对齐官方暖羊皮纸色阶（`#F0EEE6` Ivory Medium 侧栏与托盘、`#FAF9F5` Ivory Light 主阅读区与卡片、`#E3DACC` Oat Warm 选中态、`#141413` Slate Dark 主文字、`1px solid #CCCBC8` Stone 细线分割，严守零 `#FFFFFF` 纯冷白）；移除输入框 `1.5px` 暗红蜡封外框与全部悬浮 `box-shadow` 投影，改用扁平纸张层叠与 `1px` 石色/暖墨细边三态过渡；收敛 `#D97757`（悬停 `#C6613F`）陶土色仅作用于发送主按钮，移除工具栏悬停与搜索框聚焦的陶土色装饰；Markdown 正文链接补齐常驻 `1px` 细下划线；圆角体系对齐 macOS HIG 同心梯度与超椭圆连续曲率（`corner-shape: superellipse(1.5)`：主画布/弹窗 `12px`、输入框外框 `12px` → 内卡片 `11px`、气泡/代码块/菜单外框 `10px` → 菜单高亮项 `6px`、侧栏行与搜索框 `6px`、行内代码 `4px`，同时保留底栏 `rounded-full` 胶囊与圆形主按钮纯正弧度）；黑夜模式由冷调碳黑+谷歌蓝重构为 Anthropic/Claude 暖墨黑反色体系（`#141413` Slate Dark 背景、`#191917` 侧栏、`#1F1E1C` 卡片、`1px solid #3D3D3A` 暖墨细边、`#FAF9F5` 暖象牙文字与 `#D97757` 陶土主按钮）。
4. 保留上游全部 1630 个词条，词典扩至 1646 条（忽略大小写及弯直单引号也无重复）。选择性合入 PR 的自然文案与常用操作，保留 `Thinking → 正在思考`、更自然的反馈按钮以及新版本“取消生成”标签。`Turbo` / `Turbo mode` 统一为“完全模式 (Turbo)”，避免被理解为单纯加速；工作区外访问警告明确保留凭证、密钥与提示注入风险。 `New` 使用上游新增的上下文规则：操作按钮为“新建”，模型徽标为“新”；不再用静态词条抢先覆盖。
5. 不移植 `--sync-user`。保留已有 `user/` 文件；没有显式配置变更且默认字段齐全时，`config.json` 的内容与格式均不重写。不再因默认 `inputBoxId` 而删除整组自定义 selectors；上游运行时兼容处理仍在内存中进行。

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

`user/custom.js` 仍是用户主动维护的扩展点，具有页面 JavaScript 权限。try/catch 只隔离异常，并非安全沙箱。只使用信任的代码；`verify --safe-mode` 可跳过用户扩展层。安装仍会配置 CDP 调试端口和系统自启，本次开发没有执行真实安装或修改客户端。

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

## 本次 5.2.0 开发验证记录（2026-11-14 UTC）

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
