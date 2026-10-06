# AGENTS.md：dsh-dev-dsh 项目导航

> 本文档是编程 AI 的项目导航：定位、硬约束与权威信息来源。
> 面向**仓外**（out-of-tree）DSH 插件开发——本仓导出的是方法（skill）加一个把它装进 DSH 的宿主插件。

## 定位

单包，无 workspace。`0.1.0` 只覆盖**宿主面**；客户端 / UI 插件属 `0.2.0`（见 `notes/evaluation.md` §8.5）。核心交付物是 **skill 随插件安装**：`skill/SKILL.md` 经构建进入 `dist/skill`，随 npm 包发布，并在插件加载或 postinstall 时同步到 `~/.dsh/skills/dsh-dev-dsh`。

skill 的目标形态是**外置 dsh 开发手册**：L0 薄入口（版本无关）+ 多级 `references/`，按三大类（插件开发 / dsh 本体 / dogfood 与定位）组织，让 agent 不读 dsh 源码即可开发插件与定位问题；结构契约以 `notes/skill-design.md` 为权威。内容基准 = 运行环境实际携带的 dsh 版本；**具体基准只在 skill 的版本页声明**（`skill/references/dsh/versions/index.md`），本文件不写死版本号（理由见 `notes/evaluation.md` §8.6、§8.7）。

本仓除「skill + 宿主插件」之外，**长期承载试验性、不稳定的子模块**（小插件）：先在仓内 dogfood、边界清楚后再剥离为独立插件项目。第一个是 `src/uv/`（宿主 `uv` 工具，见 `notes/uv.md`），第二个是 `src/keyboard/`（提示卡 Enter/↑↓ 补位的客户端半边，见 `notes/keyboard.md`）。子模块一律**默认关闭**、由 profile 显式开启，且不得让本包既有能力（skill 同步）或 profile 启动失败。

## 硬约束

- **`skill/` 是 skill 的单一真源**：构建期由 `scripts/build-skill.mjs` 整目录拷入 `dist/skill`，`files` 只发布 `dist`、`cordis.patch.yml` 与 postinstall 脚本；缺 `skill/SKILL.md` 时构建**硬失败**（宁可不出包，也不出没有 skill 的包）。
- **skill 内容属于产品源码**：`skill/**` 的改动提交用 `feat(skill): ` 前缀，**不是** `docs:`——md 只是形态，产品是内容。
- **skill 结构契约**：`skill/**` 的层级、命名、索引与引用、版本与占位规则以 `notes/skill-design.md` 为准，`src/facts.test.ts` 是机器校验；`SKILL.md`（L0）不得含上游路径、semver 字面量与 `<repo>@<tag>`（保证它不随 dsh 版本变动），`references/**` 的**内容页**（非 `index.md`）必须声明事实 pin，占位行必须带 `plan #<id>`。（结构落地见 plan #5。）
- **术语与版本提及纪律**（plan #13 起，两条都由 `src/facts.test.ts` 校验）：领域概念术语以**英文**为准，中英对照只在 `references/dsh/concept-model.md` 给出，其它页只用英文术语；「当前基准」只在 `references/dsh/versions/index.md` 声明，其它内容页只保留一条 provenance pin，不写「当前 / 与本机一致」类叙述。
- **图表走 skill**：需要产出 mermaid 图（流程图、mindmap、时序图…）时，先调用 `my-mermaid` skill，读该图类型的 reference 后再生成，**不凭记忆手写**；换图类型必须重读对应 reference。图与所在页面同一次提交，格式交给 `pnpm format`。
- **`install-skill` 是 content-sync，不是无条件覆盖**（`src/install-skill.ts`）：目标与源的**整树**（`SKILL.md` + `references/` 逐文件字节）一致就不动（避免每次开会话都抖动）；目标本身是 symlink 则**不覆盖**（开发流可能用它接管该目录）；每个失败只记一行并返回 `{ ok: false }`，**绝不使插件加载或包安装失败**。
- **本地 dogfooding 走 `--link --source skill`，不是拷贝**：`pnpm run dogfood:skill` 把 `~/.dsh/skills/dsh-dev-dsh` 换成指向本仓 `skill/` 的 symlink——模型每次加载都重读盘，所以改完即生效、**不需要 build、不需要同步**；`--source` 缺省是 `dist/skill`（发布路径），`--copy` 恢复拷贝语义，`--verify` 用退出码报告安装面是否与给出的源一致。改 `src/**` 后仍要先 `pnpm build`：跑着的 dsh 进程持有它加载时的 `dist` 模块。
- **两个触发点**：`package.json` 的 postinstall（npm 总会跑；pnpm 10+ 默认拦截依赖构建脚本，需 allowlist）与宿主 `apply()` 内的同步（**保底路径**，postinstall 被拦也能生效）。
- **`cordis.patch.yml` 是插件的挂载声明**，三条契约（改动前先读文件头注释）：条目必须用 `insert:` 列表包裹（裸 `- id/name` 是覆盖语义）、`config` 必须显式给出（空对象即可）、与 profile 里手写的同 id 条目并存**不报错**——0.1.7-rc.2 是 last-wins 静默复用/替换（旧说法 `duplicate loader entry id` 在 0.1.7-rc.2 已无此抛错，见 issue #16）；该文件必须留在 `files` 随包发布。
- **`pnpm-workspace.yaml` 的 `allowBuilds: esbuild: true` 勿删**：删掉会让 pnpm 拒跑构建脚本，`install` / `build` 直接失败。
- **`engines.node >= 22.19`**（tsup `target: node20` 是产物目标，不是运行下限）；CI 统一 node 22。
- **`0.1.0` 不含客户端 bundle 构建能力**：不得在本仓文档或 skill 中承诺客户端插件的构建配方（属 `0.2.0`）；声明、挂载、取数与验证面照常写。**例外（有意留痕）**：`src/keyboard/` 是本包**自用**的客户端半边，产物 `dist/client.js` 由仓内 `scripts/build-client.mjs` 手搓 loader wrapper 生成——这条例外不构成「可复用构建配方」，`0.2.0` 的门类规划不变（见 `notes/keyboard.md`）。
- **客户端 seat 只索引、不抄契约**：官方功能区 seat 的索引表在 `skill/references/develop/web-ui-plugins.md` 一处，register 选项与 owner props 一律路由到运行时 Inspect（`cordis_inspect_query`），避免与 dsh 本体的生成契约抢权威。
- **`ctx.webServer` 路由：`prefix` 的 `path` 不带尾斜杠**：注册 `/my-plugin/` 会漏掉 `/my-plugin/x`，请求落 SPA fallback，表现为 200 返回 index.html 或 404 空 body（细节见那页 §7）。
- **试验性子模块 #1（`src/uv/`）的硬约束**：默认 `uv.enabled: false`，只有 profile 覆盖行显式开启才注册工具；uv 只经 `ctx.subprocess` 执行，**不自己 `spawn`**；风险分类表是 `src/uv/policy.ts` 的 pinned 常量，改动必须同步单测；注册重名/服务缺失只记一行日志并返回 `{ ok: false }`，**绝不使插件加载失败**；设计取舍与「为什么不重定向 uv 的 home 态目录」以 `notes/uv.md` 为准。
- **试验性子模块 #2（`src/keyboard/`）的硬约束**：默认 `keyboard.enabled: false`（且该开关由**浏览器半边**判定——浏览器读不到挂载行）；浏览器半边不 import 任何 `@deepseek-ai/*` 值、不请求 module-table 词；`observeFixedInput` 只补「无卡外焦点」的缺口，**不 `consume()`**、不改上游行为；服务缺失/重复 id 只记一行 warn，**绝不使整页启动失败**；产物 `dist/client.js` 由 `scripts/build-client.mjs` 生成并自检，产物契约与上游耦合面以 `notes/keyboard.md` 为准。
- **对外 README 是双语对**：`README.md`（英）与 `README.zh.md`（中）**必须在同一次改动里两侧同改**——同结构、同小节顺序、顶部各带语言切换相对链接、badge 块一致；`src/docs.test.ts` 是机器校验。`CONTRIBUTING.md` 只有英文一份，不建中文版。
- **提交风格**：每个逻辑变更独立 commit，Angular / Conventional 前缀 + 中文描述（`feat:` / `fix:` / `docs:` / `chore:` / `ci:`）。

## 写作约定（文档语言）

**语言分工**：对外文档里 `README.md`（英）与 `README.zh.md`（中）是**必须同步的双语对**（见上「硬约束」，`src/docs.test.ts` 校验），`CONTRIBUTING.md` 只有英文一份，`CHANGELOG.md` 只有中文一份（与 commit / tag message 同语）；对内文档 `AGENTS.md` / `notes/` / `skill/` **以中文为主导，只保留一份**，不写中英双份——正文用中文；代码标识符、API / 字段 / 文件名、命令、路径与原样错误串保留英文（中英混排）。官方上游内容只作参考，不整段照抄——能路由就路由。

**项目级文件纪律**：只写「模型看不见的仓内事实」，命令块固定为 `pnpm build|test|lint|check-types`；本仓只建 `AGENTS.md`（不建 `CLAUDE.md`，避免双份同步）；本文件只放导航与硬约束，工作流细节放 `CONTRIBUTING.md`、skill 正文归 `skill/`。

**术语**：dsh 的领域概念（bounded context、aggregate、capability seam、scope、projection…）一律用英文原词，不另造中文译名；中英对照关系只在 `skill/references/dsh/concept-model.md` 维护一处。**版本**：正文不写「当前是哪个版本」，基准只在 skill 的版本页声明（见上「硬约束」）。

## 常用命令

```bash
pnpm install            # 安装依赖（allowBuilds 已放行 esbuild）
pnpm build              # tsup → dist/；再 scripts/build-client.mjs 出 dist/client.js；最后拷 skill/ 为 dist/skill
pnpm test               # vitest（不跑 coverage，无阈值检查）
pnpm test:coverage      # vitest + coverage：lines/functions/statements 80、branches 70（真正的门禁）
pnpm check-types        # tsc --noEmit
pnpm lint               # eslint src
pnpm format             # prettier --write .
pnpm format:check       # prettier --check .（CI 门禁）
pnpm pack:check         # pnpm pack --dry-run，核对实际发布内容
```

## 目录与事实来源

- `src/`：插件源码与测试。`index.ts` = 宿主入口（`name` / `Config` / `apply`）；`install-skill.ts` = 同步核心；`install-skill-cli.ts` = postinstall 入口；同目录 `*.test.ts`。
- `src/uv/`：**试验性子模块 #1**（宿主 `uv` 工具）。`types.ts` = 宿主面的结构化类型切片；`config.ts` = 配置块；`entry.ts` = 可执行入口解析；`policy.ts` = 风险分类（ask 类表 + 越界判定）；`approval.ts` = 同会话授权门；`run.ts` = `ctx.subprocess` 执行与输出/失败面；`tool.ts` = 工具定义与渲染；`index.ts` = 作用域接线；同目录 `*.test.ts`。设计与取舍见 `notes/uv.md`。
- `src/keyboard/`：**试验性子模块 #2**（提示卡 Enter/↑↓ 补位的客户端半边）。`types.ts` = 结构类型切片（**不得** import `@deepseek-ai/*`）；`dom.ts` = 卡片判定（默认动作/选项/活动卡）；`client.ts` = 按键语义与首次出现移焦；`config.ts` / `host.ts` = 宿主侧开关；`test-support.ts` = jsdom 桥接（测试件）；`client-entry.ts` = 打包入口；同目录 `*.test.ts`。设计与取舍见 `notes/keyboard.md`。
- `dist/`：构建产物（gitignored），含 `index` / `install-skill` 两个 ESM 入口、**客户端半边 `client.js`** 与 `skill/` 副本。
- `cordis.patch.yml`：挂载声明（见上「硬约束」），必须随包发布。
- `scripts/`：`build-skill.mjs`（拷 skill）、`build-client.mjs`（esbuild 打包客户端半边 + 手写 `window.__ModuleLoader__.load` wrapper 并自检产物）、`install-skill-postinstall.mjs`（postinstall 守卫：`dist/install-skill.js` 不存在时静默跳过）。
- `skill/`：skill 单一真源。`SKILL.md` = **L0 薄入口**（使用协议、插件分类轴、三类路由、L1 索引表；不含上游路径 / 版本号 / pin）；`references/<大类>/index.md` = 大类入口（当前 `develop`、`dsh`、`dogfood`），再往下是页面与占位索引，层级与契约见 `notes/skill-design.md`。正文引用上游路径必须同步登记 fact；占位页转正式时必须删掉占位标记。
- `notes/evaluation.md`：方向评估与决策记录（含 §8 决策、§8.5 版本规划、§8.6 skill 定位修订），是「为什么这样定位」的权威来源；`notes/skill-design.md` 是 skill 结构契约的权威（层级 / 命名 / 索引与引用 / 版本维度 / 占位纪律 / 演进步骤）。
- `3rdp/`：**开发期本地参考**，gitignored。当前只有 dsh 代码库的只读快照（`deepseek-harness`），用于源码考古；**测试 / 生产（用户环境安装）下默认不存在，且不存在时构建、运行、`pnpm test` 全部正常**。未来可能增补其它参考（如 cordis，是否纳入待评估）；增补时须同步 `src/facts.test.ts` 的 fact 清单。
- `src/facts.test.ts`：`skill/**` 中 dsh 事实的**唯一可校验来源**。每条 fact 记 `source`（`<repo>@<tag>`）、`path`、可选 `line`、`note`；多个 tag 可并存（当前内容面 + 历史页）。元数据断言始终执行：上游路径必须都已登记、`skill/**` 的**结构契约**（L0 恰好索引全部入口页、目录索引覆盖本目录成员、全图从 `SKILL.md` 可达、无死链、每页有回链、命名 kebab-case）。校验层只在 `3rdp/<repo>/` 存在时才跑，且**按版本**复核：只查 pin 与 checkout 同版本的 fact，其它版本跳过、不失败。**无 `3rdp/` 时不报错、不告警**——那是测试/生产环境的常态。`skill/**` 每引用一条上游事实，必须同步加一条 fact，反之亦然。
- `README.md` + `README.zh.md`（英 / 中，对外双语对，只写安装与使用）/ `CONTRIBUTING.md`（英，开发流程）/ `CHANGELOG.md`（中，每个已发布版本一条）/ `AGENTS.md`（中，AI 导航与硬约束）；计划真源是 mint 里的 plan / issue，**不是**任何 md 文档。

## 文档导航

- `README.md` / `README.zh.md`：对外门面（英 / 中双语对，必须同步）——项目介绍、安装、使用、两个默认关闭的子模块怎么开。
- `CONTRIBUTING.md`：开发流程——命令、目录、dogfooding、`notes/` 与 `3rdp/`、发布流程。
- `CHANGELOG.md`：每个已发布版本一条摘要（中文，最新在上）；正文与 tag message 同源，正式版本发布前先落地条目。
- `AGENTS.md`（本文件）：项目导航与硬约束。
- `notes/evaluation.md`：方向评估、决策与版本规划。
- `notes/skill-design.md`：skill 结构契约与外置手册设计指南（层级 / 命名 / 索引与引用 / 版本维度 / 术语与语言纪律 / 保鲜纪律 / 占位纪律 / 演进步骤 / plan 边界）。
- `notes/runtime-triage.md`：DSH 运行时故障的低成本定位法（诊断流程 + 反模式清单）；已整理为 skill 分册 `skill/references/dogfood/runtime-triage.md`。
- `notes/client-console-diagnosis.md`：浏览器客户端层的取证法（Console 只读探针、React fiber 取活状态、判定矩阵、插桩纪律）；已整理为 skill 分册 `skill/references/dogfood/client-console-diagnosis.md`。
- `notes/resource-preview-protocol-bug.md`：文件/计划预览「不可用」的问题记录（现象 / 根因 / 解决方案；上游 issue 素材）。
- `notes/uv.md`：试验性子模块 #1（宿主 `uv` 工具）的设计与取舍——现象证据、为什么不用「重定向 uv 的 home 态目录」、工具与审批契约、信任边界、开启方式、已知限制与剥离路径。
- `notes/keyboard.md`：试验性子模块 #2（提示卡 Enter/↑↓ 补位客户端半边）的设计与取舍——三张卡的焦点缺口证据、为什么否决 patch/重写、声明与挂载、开关为何在浏览器侧、上游耦合面与重核清单、已知限制与剥离路径。
- mint plan / issue：计划与进度真源（流程见随包安装的 `mint` skill；具体 plan / milestone 号以 `mint` 为准，不在此处写死）。

## 不要做

- 不把 skill 正文写进 `AGENTS.md` / `README.md`：这里只放导航与硬约束；skill 内容归 `skill/`。
- 不在 `0.1.0` 的文档或 skill 中承诺客户端插件的构建配方。
- 不复制 `notes/evaluation.md` 的结论进 `AGENTS.md`：这里只放导航与硬约束，理由留在原文。
- 不引用本机专属内容（其它项目仓、绝对路径、本机符号链接）：本仓文档要对任何克隆都成立。
- 不让 `3rdp/` 的缺失成为任何测试、构建或安装的阻塞条件。
