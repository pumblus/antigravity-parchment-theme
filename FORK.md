# 融合分支说明

## 来源与版本

- 版本：`5.1.5-eric.1`。
- 基线：Anarcadia 上游 `v5.1.5`，提交 `b348d3b790fa65bb4f9e86b1ae02a5c894c62109`。
- 选择性移植：Eric 的 PR #2，提交 `3de258fd58ccb048f9fc804ee17dce5db1348d0a`。
- 发布目标分支仍为 `feat/integrated-v5.1.4`；分支名保留不变，内容已更新为 5.1.5。远端发布与 GitHub Actions 等待确认，未改动原 `main`、PR 分支或其他远端分支。

## 融合内容

1. 保留上游 2.31.1 的新增行为：大小写兜底词典查找（精确匹配优先、避免误译小写标识符）、对话轮次跳转/历史加载动态标签、侧栏 `data-active=""` 状态、Node 22 SQLite 实验性警告处理。
2. 保留上游昼夜主题、输入框/指标胶囊布局、SQLite 增量指标、翻译隔离与热重载清理机制。
3. 在上游 Windows/macOS Web 字体别名之后补入 Text/Display 本地字体别名。Display 只用于明确的首页欢迎语；思考/工具标题只匹配明确的 header 类名和 test ID，不全局覆盖 `.font-mono`、`h1` 或 `h2`。代码、路径、终端、编辑器、数学公式和 Markdown 保持原字体策略。
4. 保留上游全部 1094 个词条，词典扩至 1123 条（忽略大小写也无重复）。选择性合入 PR 的自然文案与常用操作，保留 `Thinking → 正在思考`、更自然的反馈按钮以及新版本“取消生成”标签。`Turbo` / `Turbo mode` 统一为“完全模式 (Turbo)”，避免被理解为单纯加速；工作区外访问警告明确保留凭证、密钥与提示注入风险。
5. 不移植 `--sync-user`。保留已有 `user/` 文件；没有显式配置变更且默认字段齐全时，`config.json` 的内容与格式均不重写。不再因默认 `inputBoxId` 而删除整组自定义 selectors；上游运行时兼容处理仍在内存中进行。

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

## 本次开发验证记录

- 通过：10 组非浏览器回归、三项 JavaScript 语法检查、4 个核心文件的 SHA-256/字节数校验、zip 打包后逐文件校验；确认没有删除上游词典键，`user/` 模板未改动。
- 2.31.1 新增回归覆盖大小写兜底、精确覆盖优先、小写标识符豁免、轮次跳转、历史加载及“没有更早消息”的无障碍标签。
- 浏览器夹具未完成：环境禁止 Chromium 创建进程单例 Unix socket。4 个浏览器顶层测试在启动阶段失败，其中明/暗排版包含的 12 个计算样式子测试未执行。此限制不代表 UI 断言通过。
- 真实 Antigravity、字体与活动 CDP 端口在本环境中均不存在。未执行真实安装、注册自启、修改调试端口或运行外部脚本。
- Node 22/24 GitHub Actions 工作流已随源码准备，但远端发布与 Actions 运行仍待确认。
