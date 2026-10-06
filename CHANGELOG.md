# Change Log

## 0.1.0

### Features

- 插件包形态与挂载：宿主入口自带 bundle 挂载声明，`cordis.patch.yml` 随包发布；补齐 `exports`、`locale` 展示元数据与发布元数据。
- skill 随包安装：`skill/` 经构建进入 `dist/skill` 随包发布，postinstall 与插件 `apply()` 两条触发路径任一生效；同步按整树逐文件比较，`--link` 接管本地目录、`--verify` 自检安装面。
- 手册 · 插件开发分册：分类流程（tool / 外围扩展 / 核心替换 / skill 型 / preset / MCP / hooks / web UI）、挂载与清单、客户端 / UI 面、子进程与信任模型、审批与提权、委派与并行。
- 手册 · dsh 本体分册：分层架构、插件模型、扩展点与概念模型、组装与启动、会话与持久化、内置模块索引与分册页。
- 手册 · dogfood 与排障分册：本地环境搭建、运行时取证、运行时定位法、客户端 Console 只读探针。
- 事实台账与结构门禁：`src/facts.test.ts` 校验上游 pin、L0 版本无关、索引可达、术语与占位契约；`3rdp/` 缺失时静默短路，不阻塞构建与测试。
- 试验性子模块 #1（宿主 `uv` 工具）：风险分类表 + 同会话授权门，默认关闭。
- 试验性子模块 #2（提示卡 Enter/↑↓ 客户端半边）：产物 `dist/client.js`，开关由浏览器半边判定，默认关闭。
- 发布链路：tag 驱动 CI，gate 校验 tag 与 `package.json` 版本一致；npmjs OIDC 可信发布 + GitHub Packages 双发都成功才建 GitHub Release，预发布只跑 gate 与测试。

### Others

- 构建与测试链：tsup + vitest + 覆盖率门禁（lines/functions/statements 80、branches 70），出包带客户端半边 `dist/client.js`。
- CI：新增 `format:check` 门禁；发布前先探目标版本是否已存在，避免半失败后重跑卡在「版本已存在」。
- 文档：README 英中双语对与同步校验、CONTRIBUTING 开发流程、AGENTS.md 项目导航，以及 `notes/` 里的设计与决策记录。
