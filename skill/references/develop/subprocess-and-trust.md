# 子进程执行与信任模型：在插件进程里跑外部 CLI

本文是 `references/develop/index.md` 的子页，回答「工具插件要跑外部命令时走哪个 seam、边界在哪、谁施加沙箱」。
**事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`。上游权威：`packages/subprocess/subprocess/README.md`（seam 契约）、
`packages/shell/bash-sandbox/README.md`（confinement 由谁施加）。

工具注册与模型可见面见 `references/develop/tool-plugins.md`；不接受本文的信任模型、要自己造一道人门的，见
`references/develop/approval-and-escalation.md`；后台任务面见 `references/develop/peripheral-extensions.md`。

## 1. 判据：什么时候是这一类

- 插件要做的事是**跑一条外部命令**（uv / pnpm / cargo / git…）——用 `ctx.subprocess`，这是进程 seam。
- **不要**自己 `node:child_process.spawn`：绕开 seam 就拿不到统一的 executable 解析、凭据 scrub、
  managed-range 终止与有界输出 spill。
- `ctx.shell` 是 **bash 工具的执行器** seam（`dsh-bash-sandbox` 注册为 `ctx.shell`），不是给插件跑命令的入口。
- 需要 shell 语义（管道 / 重定向 / heredoc）时先落脚本文件再执行，或退回既有 bash 工具并接受它的沙箱与提权流程。

## 2. 信任模型（先读这一节）

**confinement 是 consumer 的责任，不是 seam 的。** `dsh-bash-sandbox` 对每条命令的精确
`['bash', '-c', command]` argv 调 `ctx.sandbox.confine()`，再 spawn 返回的 argv——沙箱是它在施加
（`packages/shell/bash-sandbox/README.md:78`）。而 `ctx.subprocess` 的 `spawn(spec)` 只有进程坐标，
`SubprocessSpawnSpec` 里**没有** mode / policy 字段（`packages/subprocess/subprocess/src/types.ts:77`），
它自身不施加任何限制。

由此得到两条开发含义：

1. **插件自己的子进程不受会话文件沙箱约束**，无论会话当前是 `read-only` 还是 `workspace-write`。
   `references/dsh/plugin-management.md` 里「已安装的 Host 代码在宿主进程内运行，不受工作区沙箱限制」
   说的就是这件事，只是那句长在安装管理语境里——这里才是它的开发含义。
2. `workspace-write` 的可写根只有 workspace root、`/tmp` 与 `os.tmpdir()`，
   **没有「额外可写根」这种配置**（`packages/sandbox/sandbox/src/roots.ts:52`）。想让常规工具链（比如
   包管理器写 `~/.cache`）在受限模式下工作，靠加白名单是没有出口的。

于是只有两条出路：

- **接受这把信任**：把「每次调用都要一次提权审批」换成「一次配置信任」。前提是该命令的危害面可接受，
  且开启与否由 profile 显式决定（不要默认替所有安装方改安全姿态）。
- **自己造一道门**：工具内按风险分类，命中时经 approval seam 询问。契约与配方见
  `references/develop/approval-and-escalation.md`。

`permission-presets` 把这件事收成组合：每个 preset 名 = 一个 sandbox mode + 一个 approval policy
（`packages/interaction/permission-presets/README.md:32`），所以插件的信任姿态最终由 profile 的 preset 决定。

如果你要**自己**施加 confine（而不是用 bash 执行器），seam 侧契约是
`confine(argv, policy, signal?) → ConfinedArgv`：调用方 spawn 返回的 argv 以替代自己的
（`packages/sandbox/sandbox/src/index.ts:177`）。它是 fail-closed 的：confined mode 下没有可用 runner 时
拒绝执行（`SANDBOX_UNAVAILABLE`），**绝不降级成不沙箱地跑**。

## 3. `ctx.subprocess` 契约

| 面           | 形态                                                                                            | 权威路径                                            |
| ------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 解析可执行   | `resolveExecutable(command, env?, signal?): Promise<string>`（canonical 路径）                  | `packages/subprocess/subprocess/src/index.ts:133`   |
| 启动         | `spawn(spec: SubprocessSpawnSpec): SubprocessHandle`                                            | `packages/subprocess/subprocess/src/types.ts:77`    |
| 有界收集     | `SubprocessCollect = { maxBytes, spill?: { maxBytes } }`；`maxBytes` 溢出保留**尾部**           | `packages/subprocess/subprocess/src/types.ts:44`    |
| 终局         | `SubprocessOutcome = { exitCode: number \| null, signal: NodeJS.Signals \| null }`              | `packages/subprocess/subprocess/src/types.ts:116`   |
| 增量读       | `readFrom(fromByte) → { text, nextOffset, lossy, spillPath? }`                                  | `packages/subprocess/subprocess/src/types.ts:124`   |
| 句柄         | `collected` / `done` / `terminate()`（幂等）/ `waitForExit(signal?)`                            | `packages/subprocess/subprocess/src/types.ts:169`   |
| stdio 三形态 | 每流独立：`'pipe'` 原始流；`'inherit'` 父进程自己的流；collect 对象 = 有界内存尾部 + 可选 spill | `packages/subprocess/subprocess/README.md:57`       |
| 终止范围     | provider 按 spawn 选原生进程 owner（systemd scope / Windows Job / POSIX PGID）                  | `packages/subprocess/subprocess-local/README.md:86` |

`resolveExecutable` 的语义（`packages/subprocess/subprocess/src/index.ts:133`）：绝对路径做校验；裸名字用
provider 的 scrub 后 `PATH` 加显式 `env` 覆盖来查；含分隔符的相对路径直接失败（解析基座未定义，宁可报错）；
返回 canonical 路径。查不到就抛，**不要**把 `argv[0]` 交给 shell 去猜。

`SubprocessSpawnSpec` 的逐字段要点（`packages/subprocess/subprocess/src/types.ts:77`）：
`argv`（**不经 shell 解释**）、`cwd`（无默认值）、`stdio`、`graceMs`（正有限毫秒，供 provider 的终止流程
**以及**进程退出后排空未关闭的 collected 管道）、`signal`（只负责**触发**终止升级，deadline 与原因由 caller 拥有）、
`env`（见 §4）。**这个 seam 不施加任何默认值**：它只拥有进程坐标与生命周期，`packages/subprocess/subprocess/README.md:12`。

`signal` 的语义值得单独说：把 `spec.signal` 设成你自己的 `AbortSignal`，abort 触发的是与 `terminate()`
**同一套** managed-range 终止流程（SIGTERM → `graceMs` → SIGKILL，覆盖整棵进程树）。seam 不替你判超时，
也不会在结果上打「超时」标记——`[timed out after Nms]` 是 consumer 自己记的。

所以「谁负责什么」是：

| 事项                                                  | 归属                                          |
| ----------------------------------------------------- | --------------------------------------------- |
| 进程坐标与生命周期（spawn / terminate / waitForExit） | seam                                          |
| shell 语义（管道、重定向、引号）                      | consumer（seam 不做 shell 解释）              |
| deadline 与超时判定                                   | consumer（spec 没有 deadline）                |
| timeout / cancel 的分类                               | consumer（`done` 只给 `exitCode` / `signal`） |
| 输出渲染、截断提示、退出码标记                        | consumer                                      |
| ambient env 的凭据 scrub                              | seam                                          |
| env 的追加与逃生口                                    | consumer（`spec.env`）                        |

## 4. 环境：scrub 与逃生口

- `SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i`；匹配到的名字与**所有** `DSH_*` 从 ambient 环境移除；
  `PATH` / `HOME` / locale / proxy 这类保留（`packages/subprocess/subprocess/src/index.ts:47`）。
- 合并顺序是 **scrub 后的 ambient 基座 → 显式 `env`**（后写胜出）。显式给字符串是「刻意放行」（能存活过 scrub），
  显式给 `undefined` 是 tombstone，用来删掉一个普通 ambient 项（`packages/subprocess/subprocess/src/types.ts:99-106`）。
  注意方向：**不是**先合并再 scrub。
- 分层范本见 bash 执行器：`{ ...ENV_OVERRIDES, ...spec.env, ...spec.dshEnv }`（`packages/shell/bash-local/src/index.ts:151`）。

## 5. 输出与结果渲染惯例

模型看到的文本按既有惯例拼（`packages/shell/tool-bash/src/render.ts:44`）：

1. body：stdout；stderr 非空时，补一个换行后接 `[stderr]` 段；
2. 两者都空 → `(no output)`；
3. markers 依次：sandbox denial → escalation hint → `[timed out after <ms>ms]` → `[stopped: <reason>]` →
   **`[killed by signal: <signal>]` 或 `[exit code: N]`**。

**退出标记必须放在末尾**：`parseExitStatus` 的锚点是 end-anchored 且要求前置 `\n`
（`packages/shell/shell/src/render.ts:37`），放错位置会让后续读者把标记当成正文。截断提示同样来自该文件：
`[output truncated; full output: <path-or-(unavailable)>]`。

两条语义纪律：**非零退出是「报告」不是 `isError`**——命令失败要让模型自己判断；只有基础设施失败
（spawn 错误、abort）才收敛成 `isError`。仓内正例：`src/uv/run.ts`、`src/uv/tool.ts`。

## 6. 后台作业（长任务再考虑）

长任务要 detach / handoff 时，`ctx.jobs` 的输出源是 **pull 形状**：每个 channel 一个
`{ channel, read(fromByte) }`（`packages/jobs/jobs/src/types.ts:55`）。把 collected reader 接上去的范本是
`packages/shell/tool-bash/src/background.ts:67`（`processSources()` / `processOutcome()`）。注册面见
`references/develop/peripheral-extensions.md`。

不该做的场合：命令本来就是秒级、或你需要「这一轮的结果」的同步语义——先把它做成前台调用，
等真的出现超时才接后台作业。

## 7. 失败面

| 现象                                | 成因                                        | 处理                                        |
| ----------------------------------- | ------------------------------------------- | ------------------------------------------- |
| `SubprocessExecutableNotFoundError` | `resolveExecutable` 查不到                  | 报错并让用户确认命令；不要回退到 shell 去猜 |
| `done` reject                       | spawn / provider 失败（**不是**命令失败）   | 与「命令非零退出」分开处理                  |
| `waitForExit()` throw               | provider 已无法证明进程组为空               | 视为基础设施失败                            |
| `readFrom` 返回 `lossy: true`       | 游标滑出内存尾部窗口                        | 用返回的 `spillPath` 取全量流               |
| `SANDBOX_UNAVAILABLE`               | 自己 confine 时 confined mode 无可用 runner | fail-closed 的结果，不要 catch 后不沙箱重跑 |

## 8. 验收

- 不带上游源码，只读本页能否写出「spawn + collect/spill + 超时/取消 + 渲染」四件事——反查样例是
  `src/uv/run.ts` 与 `src/uv/tool.ts`；组合级验收口径见 `notes/uv.md` §7。
- 真跑一轮：会话日志里的 `tool/call` / `tool/result` 是持久证据；危险类的 `approval/asked` 计数应为 0
  （零授权路线）或 1（首次询问路线）。

## 9. 源码最后手段

`deepseek-harness@dsh-v0.2.0-rc.2`：`packages/subprocess/subprocess/src/types.ts`（字段级契约）、
`src/index.ts`（scrub 与 executable 解析）、`packages/shell/tool-bash/src/background.ts`（后台作业适配）。
查未文档化的边界时用，默认不读。
