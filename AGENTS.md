# AGENTS.md：dsh-dev-dsh 项目导航

> 本文档是编程 AI 的项目导航：定位、硬约束与权威信息来源。
> 面向**仓外**（out-of-tree）DSH 插件开发——本仓导出的是方法（skill）加一个把它装进 DSH 的宿主插件。

## 定位

单包，无 workspace。`0.1.0` 只覆盖**宿主面**；客户端 / UI 插件属 `0.2.0`（见 `notes/evaluation.md` §8.5）。核心交付物是 **skill 随插件安装**：`skill/SKILL.md` 经构建进入 `dist/skill`，随 npm 包发布，并在插件加载或 postinstall 时同步到 `~/.dsh/skills/dsh-dev-dsh`。

同类项目盘点（本仓项目级文件的写法依据）：

| 仓库          | 项目级文件                                | 形态                                                                                                      |
| ------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `dsh-mint`    | `AGENTS.md`                               | 中文「项目导航」：# 定位 / ## 硬约束 / ## issue 计划管理（mint）/ ## 架构事实 / ## 常用命令 / ## 文档导航 |
| `dsh-covtrim` | `CLAUDE.md`                               | 同结构，少「架构事实」节                                                                                  |
| `covtrim`     | `CLAUDE.md` + `CONTRIBUTING.md` + `docs/` | 旧形态（非 dsh 插件仓）                                                                                   |

共性：只写「模型看不见的仓内事实」，命令块固定为 `pnpm build|test|lint|check-types`。本仓随当前工具链取「只建 `AGENTS.md`」（不建 `CLAUDE.md`，避免双份同步）。

## 硬约束

- **`skill/` 是 skill 的单一真源**：构建期由 `scripts/build-skill.mjs` 整目录拷入 `dist/skill`，`files` 只发布 `dist`、`cordis.patch.yml` 与 postinstall 脚本；缺 `skill/SKILL.md` 时构建**硬失败**（宁可不出包，也不出没有 skill 的包）。
- **`install-skill` 是 content-sync，不是无条件覆盖**（`src/install-skill.ts`）：目标 `SKILL.md` 已一致就不动（避免每次开会话都抖动）；目标本身是 symlink 则**不覆盖**（开发流可能用它接管该目录）；每个失败只记一行并返回 `{ ok: false }`，**绝不使插件加载或包安装失败**。
- **两个触发点**：`package.json` 的 postinstall（npm 总会跑；pnpm 10+ 默认拦截依赖构建脚本，需 allowlist）与宿主 `apply()` 内的同步（**保底路径**，postinstall 被拦也能生效）。
- **`cordis.patch.yml` 是插件的挂载声明**，三条契约（改动前先读文件头注释）：条目必须用 `insert:` 列表包裹（裸 `- id/name` 是覆盖语义）、`config` 必须显式给出（空对象即可）、不可与 profile 里手写的同一 `insert` 段并存；该文件必须留在 `files` 随包发布。
- **`pnpm-workspace.yaml` 的 `allowBuilds: esbuild: true` 勿删**：删掉会让 pnpm 拒跑构建脚本，`install` / `build` 直接失败。
- **`engines.node >= 22.19`**（tsup `target: node20` 是产物目标，不是运行下限）；CI 统一 node 22。
- **`0.1.0` 不含客户端 / UI 能力**：不得在本仓文档或 skill 中承诺客户端插件构建（属 `0.2.0`）。
- **提交风格**：每个逻辑变更独立 commit，Angular / Conventional 前缀 + 中文描述（`feat:` / `fix:` / `docs:` / `chore:` / `ci:`）。

## issue / 计划管理（mint）

- issue / plan / milestone 由 mint 管理（每项目独立 db，按会话 cwd 定位）；流程见 mint skill。
- **在 DSH 会话里一律走宿主 `mint` 工具**（`mint({ args: [...] })`）：插件进程内执行，不经 bash、不进沙箱、零授权。**不要用 bash 跑 mint**——会触发沙箱拒绝与提权审批。
- **默认挂当前 running milestone**：新 plan / 独立 issue 默认挂它（同刻有且仅有一个）；无 running 时按 semver 推测候选并**询问用户**，勿自行置位。
- **改码前门禁**：改某个 issue 的代码前先 `issue state start <id>`；同 plan 统一测试后 `plan close <plan> --test-cmd "<命令>"`。
- **本项目的 issue 目前是 `task` 类**：task 状态机**跳过 dev**——`planned --start--> test`，`test --retest--> planned`，**没有 dev 态、不能 `state commit`**（报 `invalid transition: task kind does not use git commit`）。task 类因此没有 `last_commit_id`，改动与 issue 的对应关系靠 commit message 里的 issue 号 + close 时的成功 `--test-cmd` 留证。

## 常用命令

```bash
pnpm install            # 安装依赖（allowBuilds 已放行 esbuild）
pnpm build              # tsup → dist/，随后 scripts/build-skill.mjs 把 skill/ 拷为 dist/skill
pnpm test               # vitest（含 coverage 阈值：lines/functions/statements 80、branches 70）
pnpm test:coverage      # 同上，显式调 coverage
pnpm check-types        # tsc --noEmit
pnpm lint               # eslint src
pnpm format             # prettier --write .
pnpm pack:check         # pnpm pack --dry-run，核对实际发布内容
```

## 目录与事实来源

- `src/`：插件源码与测试。`index.ts` = 宿主入口（`name` / `Config` / `apply`）；`install-skill.ts` = 同步核心；`install-skill-cli.ts` = postinstall 入口；同目录 `*.test.ts`。
- `dist/`：构建产物（gitignored），只含 `index` / `install-skill` 两个 ESM 入口与 `skill/` 副本。
- `cordis.patch.yml`：挂载声明（见上「硬约束」），必须随包发布。
- `scripts/`：`build-skill.mjs`（拷 skill）、`install-skill-postinstall.mjs`（postinstall 守卫：`dist/install-skill.js` 不存在时静默跳过）。
- `skill/SKILL.md`：skill 单一真源。**本文件的正文与 references 仍是骨架**（含 `<!-- PLACEHOLDER -->`），补全属 mint plan #2（issue #3 / #10）。
- `notes/evaluation.md`：方向评估与决策记录（含 §8 决策、§8.5 版本规划），是「为什么这样定位」的权威来源；`notes/dsh-old/` 是指向 `../../my-agents/notes/dsh` 的**本机符号链接**，在别的机器上是 dangling，不作为项目内容。
- `3rdp/`：**开发期本地参考**，gitignored。当前只有 dsh 代码库的只读快照（`deepseek-harness`），用于源码考古；**测试 / 生产（用户环境安装）下默认不存在，且不存在时构建、运行、`pnpm test` 全部正常**。未来可能增补其它参考（如 cordis，是否纳入待评估）；增补时须同步 `src/facts.test.ts` 的 fact 清单。
- `src/facts.test.ts`：skill 中 dsh 事实的**唯一可校验来源**。每条 fact 记 `source`（`<repo>@<tag>`，如 `deepseek-harness@dsh-v0.1.7-rc.2`）、`path`、可选 `line`。元数据断言始终执行（含「skill 引用的上游路径必须都已登记」）；校验层只在 `3rdp/<repo>/` 存在时才跑：先比对 checkout 版本与 pin，再逐条查路径与行号，失效时一次性列出全部条目。**无 `3rdp/` 时不报错、不告警**——那是测试/生产环境的常态。skill 正文每引用一条上游事实，必须同步加一条 fact，反之亦然。
- `README.md`（英，对外）/ `AGENTS.md`（中，对内）；计划真源是 mint 里的 plan / issue，**不是**任何 md 文档。

## 文档导航

- `README.md`：项目介绍、Status、Layout、Development。
- `AGENTS.md`（本文件）：项目导航与硬约束。
- `notes/evaluation.md`：方向评估、决策与版本规划。
- mint plan / issue：计划与进度真源（本仓当前：milestone `0.1.0`，plan #8 = 本组项目级文件工作）。

## 不要做

- 不把 skill 正文写进 `AGENTS.md` / `README.md`：skill 内容属 plan #2（issue #3 / #10）。
- 不在 `0.1.0` 的文档或 skill 中承诺客户端构建能力。
- 不复制 `notes/evaluation.md` 的结论进 `AGENTS.md`：这里只放导航与硬约束，理由留在原文。
- 不把 `notes/dsh-old` 当项目内容（本机符号链接）。
- 不让 `3rdp/` 的缺失成为任何测试、构建或安装的阻塞条件。
