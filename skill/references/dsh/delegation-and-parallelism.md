# 委派与并行：subagent、workflow 与 loop 调度

> 本文是 `references/dsh/index.md` 的子页。
>
> **范围**：一个 agent 把工作分给别的 agent 时有哪些通道、并行究竟在哪一层发生、子级拿到什么上下文、
> 哪些行为是自动的哪些要主动要。工具 schema、Config 字段全集与「怎么写一个 provider」只在上游权威处路由。
> **事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`。本页给机制与判据，不抄签名。
> 上游权威：`docs/subsystems/subagent.zh.md`（seam、Activation、可继续子级全文）、
> `docs/subsystems/workflow.zh.md`（脚本语义与失败纪律）、`packages/subagent/tool-subagent/README.zh.md`
> （工具面、后台策略、模型体验）、`packages/subagent/tool-subagent-control/README.zh.md`（三个控制工具）。

## 1. 结论速览

- **宿主不会自己起 subagent**：并行的意图来自模型——在**一条 assistant message 里批量发出多个委派调用**，
  这一批就是并行组；宿主侧没有「自动开子 agent」的策略。
- 真正自动的只有四件事：系统提示词引导、continuable 默认后台、子级结算通知、Activation 的寿命管理。
- **context 语义按入口分**：`subagent`（`spawn` provider）从空会话开始；`subagent_fork`（`fork` provider）
  以父级**已完成的轮次前缀**作为会话种子。
- **等它们时不要 `sleep`**：默认继续做独立步骤等完成通知，真被阻塞才用 `job_output(wait: true)`（见 §5）。
- **子级不能替你问用户、也不能替你交计划**：三步走（子级提问 → 父级问用户 → 父级回投）、plan mode 边界
  与「省不省 token」的判据见 `references/dsh/delegation-and-user-decisions.md`。

## 2. 通道清单与默认装配

| 面向模型的工具                                     | provider / 机制                                | 子级 context       | 调用默认形态                             | 结果怎么回来                             |
| -------------------------------------------------- | ---------------------------------------------- | ------------------ | ---------------------------------------- | ---------------------------------------- |
| `subagent`                                         | `spawn`（进程内）                              | 空会话             | 后台（随产品的 preset 配 `continuable`） | 结算通知自动投给父级；工具本身不返回结果 |
| `subagent_fork`                                    | `fork`（进程内）                               | 父级已完成轮次前缀 | 后台（同上）                             | 同上                                     |
| `workflow`                                         | 脚本里的 `agent()`；引擎 provider 默认 `spawn` | 每个子级空会话     | 前台阻塞                                 | 脚本返回值（纯 JSON）                    |
| `send_message` / `list_agents` / `interrupt_agent` | `tool-subagent-control`                        | —                  | 同步返回                                 | 控制通道，不新建子级                     |

- 委派工具的**名称与后台策略都是加载时配置**：`provider`、`toolName`、`backgroundMode`（`one-shot` | `continuable`）、
  `enableRunInBackground`。包 README 的最小配置默认 `one-shot`（前台等待），随产品的 web preset 给 `subagent` 与
  `subagent_fork` 都配了 `continuable`——**读 README 得到的默认与产品 preset 不同，判断实际行为要看 preset 行**。
- 开了 `modelSelectionSettings` 的实例会多出 `provider` / `model` / `reasoning_effort` 三个参数与配套的
  `list_subagent_models` 发现工具；它要求 provider 支持 `agentOptions`。
- `ctx.subagents` 是**按名字注册的 provider 注册表**（同一上下文可并存多个），这一点与只有一个执行器的 bash seam 不同。
- 进程外后端 `subagent_codex` / `subagent_claude_code` 随产品发布但在 preset 里 `disabled`，要显式开启才可用。
- 一个 provider 一个工具实例，工具与 provider 同生共死（provider 消失则该工具消失，不会留下悬空工具）；
  `maxDepth: 'provider-managed'` 把深度预算整个交给进程外后端。

## 3. 并行发生在两层，别混

### 3.1 loop 层：同一条消息里的兄弟调用

- 一个 step 的每个 tool call 先分类：只有 `ToolDefinition.isConcurrencySafe(args)` **恰好返回 `true`** 才是
  `parallel`，未声明、未知、隐藏或抛错一律 fail-closed 成 `exclusive`。`exclusive` 调用是屏障。
- `subagent` / `subagent_fork` 的**所有调用形态**都声明了并发安全，所以同一条消息里的多个委派会真正重叠；
  `workflow` 没有声明该分类器，因此**一次只跑一个 workflow**。
- 并行调用进一个滚动池，上限是 loop 配置 `maxParallelToolCalls`（默认 10）；**提交仍按模型顺序**，
  所以先跑完的快速子级会被前面的慢兄弟挡住（GUI 上各子级的进度仍独立可见）。
- 协调共享工作区与外部资源是**模型的责任**；并发子级也会争抢同一份 LLM 配额。
  这条取舍的来由见 §9 的归档记录。

### 3.2 workflow 层：脚本内部的组合器

- `agent(prompt, opts?)` 起一个子级；可用选项只有 `label`、`phase`、`schema`、`provider`、`model`
  （`effort` / `isolation` / `agentType` 是显式拒绝的 deferred 选项，写错即 fatal）。
- `parallel(thunks)`：全部并发并**等齐**（屏障）；`pipeline(items, ...stages)`：逐项跑完整条阶段链，
  **阶段之间没有屏障**（多阶段工作优先用它）。
- 子级非 `completed` → 该项得 `null`（可用 `.filter(Boolean)` 过滤）；钩子误用、选项拼错、触顶等 fatal
  错误直接抛出并终止脚本，绝不消融成「某个子级失败」。
- 引擎侧三道闸：`maxConcurrentAgents`（配置 0 时取 `min(16, 可用并行度 - 2)`）、`maxTotalAgents`（默认 1000，
  失控循环的兜底）、`maxItemsPerCall`（默认 4096）。

## 4. 什么是自动的，什么要主动

**自动**（无需任何人下指令）：

1. **提示词引导**：`enableRunInBackground` 与 `backgroundMode: continuable` 同时成立时，注入一节
   `tool:<工具名>` 系统提示词，文本为 `Start independent <工具名> delegations together in one assistant message and continue useful work while they run.`
   （`<工具名>` 由 `toolName` 插值）；工具不在作用域时，schema 与这段引导一起消失。
2. **默认后台**：取值规则是 `run_in_background ?? continuable`，所以 continuable 实例省略参数即后台启动，
   立刻返回 `started subagent <childId>`，父级继续干活。
3. **结算通知**：continuable 子级的 Activation 结算时，运行时**无条件**向它的持久化直接父级投递一条结算通知
   （携带子级最后的非空文本；没有则 `It left no closing message.`）。它的来源 kind 是 `subagent-settled`，
   与子级自己写的消息刻意区分，transcript 不会把运行时记账算成子级的话。
4. **Activation 寿命管理**：准入、直接父级鉴权、冷恢复、child-first 释放、容量拒绝都在服务里完成。
   中断走持久地址（子级 id + 直接父级地址）鉴权，**父级 Agent 离线也照样生效**；唤醒与追投则要有一条
   确切的在线路径——模型侧用 `send_message`（要求确切的在线 sender），人类侧经在线直接父级投递。

**主动**：

- 模型侧：同一条消息里批量委派；`run_in_background: true`（`one-shot` 下变成父级所有的后台 Task，
  用 `job_output` / `job_kill` 收尾）；`workflow` 脚本；`send_message` 追投新工作、`interrupt_agent` 停当前轮。
- 人类侧：客户端（浏览器）可以打开子会话看 transcript、对在线的 continuable 子级投递 Queue / Steer 消息、
  中断它。**不能从 GUI 强制新建委派**——那始终是模型的决定。

## 5. 等待与收尾：不要 `sleep` 轮询

**结论：等后台工作或子级时不要在 bash 里 `sleep`。** 上游把这条写进了 `job_*` 工具的系统提示词：
`do not busy-poll or sleep on one; keep working on independent steps`。代价不只是浪费墙钟——完成通知要等
当前 step 结束后的**下一个 step** 才会被模型看到，而 `sleep` 正好把这一步占满，等于自己把通知**推迟**；
时间又猜不准（快任务白等、慢任务还得再来一轮），于是「等」就退化成了轮询。

| 情况                 | 该做什么                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 默认姿势             | **不等**：继续做相互独立的步骤，完成通知会自动到达                                                                                       |
| 确实被结果阻塞       | `job_output(<id>, wait: true)`：默认等 30 s，`timeout_ms` 可加长但向 600 s 收敛；超时返回 `[status: running]` 且任务仍存活，可以再等一次 |
| 一两步就结束的短工作 | 前台跑：bash 不加 `run_in_background`；`subagent` 用 `run_in_background: false`（`one-shot` 策略本来就在前台等待）                       |
| 不再需要的任务       | `job_kill`（id 用 `job_list` 找）；最终答复前用 `job_output` 收齐仍相关的任务                                                            |

- 完成通知的形态：`background job <id> (<kind>: <label>) finished [status: ...]. Read its output with job_output.`
  繁忙的 agent 在下一步拿到它，空闲的 agent 被一个 follow-up 轮次唤醒（`completionDelivery: quiet` 时改为待领注入）。
  后台 bash、PTY 发送与一次性后台 `subagent` 共用这一套，所以收尾方式是同一套。
- **`wait` 与通知是两条路，选一条**：运行时把已经用存活 `wait` 收走的结算记为 `awaited`，不再补发通知；
  靠通知回来的结果也不必再 `wait`。
- continuable 子级不走这套 job：结算通知由委派 seam 自己投递（见 §4），追投用 `send_message`——
  所以也别拿 `list_agents` 轮询「做完没有」。

## 6. context：从零还是分叉

|              | `spawn`（`subagent`）                                                                                | `fork`（`subagent_fork`）                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 会话初始内容 | 空                                                                                                   | 父级日志中**已配平的已完成轮次前缀**：自 seq 0 连续，止于最后一个 `turn/end` |
| 当前回合     | 无                                                                                                   | **不含**发起 fork 的那次工具调用所在的回合；第一个已完成轮次之前，等于空种子 |
| 之后同步     | —                                                                                                    | **一次性快照**：fork 之后父级写的内容永远不会到达子级                        |
| 继承         | workspace / cwd、lineage、provider / model / reasoningEffort / maxTokens（可被 `agentOptions` 覆盖） | 同左                                                                         |
| 不继承       | 父级的工具注册与服务（子级是**全新扁平 scope**）、父级的授权本身                                     | 同左                                                                         |
| 深度         | `SessionHeader.delegationDepth` = 父级 + 1（冷恢复只能抬高不能降低）                                 | 同左                                                                         |

**权限不是「把父级的活授权交给子级」**：它在子级创建前捕获父级当时的 permission preset，作为子级**自己**的初始裁定——
Auto / Full 会追加捕获的 `permission/preset` 身份，且每个子级调用都独立过一次 review；Read Only / Workspace Write
保留沙箱 override 加 `approval: never`。所以「父子共享一个授权通道」是错的模型。

## 7. 改行为从哪下手

| 想改什么                         | 位置                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| 换后端、加一个委派工具、改工具名 | preset 行的 `provider` / `toolName`                                                |
| 前台还是后台、默认值             | preset 行的 `backgroundMode` / `enableRunInBackground`                             |
| 子级 LLM 路由选择                | `modelSelectionSettings: true`，再配 `subagent-model-selection` 偏好               |
| 每个子级的 persona / 工具限制    | preset 行的 `persona` / `toolFilter`（要求 provider 有对应 flag）                  |
| 委派深度上限                     | 行内 `maxDepth`（数值）或宿主设置 `subagents.maxDepth`（默认 1；`0` 禁止委派）     |
| 在线 continuable 子级数          | `ctx.subagents` 的 `maxActiveSubagents`（默认 8）                                  |
| 一条消息里并发多少前台调用       | loop 的 `maxParallelToolCalls`（默认 10）                                          |
| workflow 的并发与总量            | `dsh-workflow-ptc` 的 `maxConcurrentAgents` / `maxTotalAgents` / `maxItemsPerCall` |

## 8. 易错点

- **fork 看不见进行中的回合**：不能假设子级知道你「刚说的那句话」；提示词仍要自足。
- 子级既看不到父级对话（`spawn`），也看不到父级的工具、服务与授权；「继承 workspace 与模型路由」不等于继承能力。
- **默认只有一层**：`maxDepth` 默认 1，子级再派会被拒绝；工具此时仍然可见，失败表现为出错的工具结果。
- **池位与在线数是两回事**：前台派生占用并行池位；后台 / continuable 调用在收到 id 时就释放池位，
  所以它们留下的子级不受 `maxParallelToolCalls` 约束——约束在线 continuable 子级的是 `maxActiveSubagents`。
- 在线容量满时，冷恢复一个新的 Activation 会以 `subagent/delivery-unavailable` 拒绝；那是容量信号，不是子级失败。
- **`workflow` 是独占屏障**，且脚本里 `for (…) await agent(…)` 是串行的；要并行必须显式用 `parallel` / `pipeline`。
- provider 不具备的能力（`outputSchema` / `persona` / `toolFilter` / 数值深度）在 start 之前就被拒绝
  （`UNSUPPORTED_CAPABILITY`），不会「接受了再忽略」。
- `list_agents` 的 `running` / `inactive` **不表示任务是否完成**；完成以结算通知（或 job 状态）为准。
- **不要 `sleep` 等**：那是 busy-poll，既把完成通知推迟到 `sleep` 结束之后，时间也猜不准；
  要等就用 `job_output(wait: true)`，否则继续干活等通知（见 §5）。
- 兄弟子级可能在工作区上互相踩，宿主不做串行化保护。
- 子级碰上「要用户拍板」的事：别让它调用 `ask_user_question`（必被拒），让它写进最终回复；
  三步咨询循环与 plan mode 边界见 `references/dsh/delegation-and-user-decisions.md`。

## 9. 源码最后手段（默认不读）

- `packages/subagent/tool-subagent/src/index.ts`：工具注册、后台策略取值、提示词节与并发安全声明。
- `packages/core/agent-loop/src/tool-calls.ts` 与 `packages/core/agent-loop/src/constants.ts`：滚动池调度与默认上限。
- `packages/subagent/subagent-fork-in-process/src/index.ts`：fork 种子前缀的计算。
- `packages/subagent/subagent/src/index.ts`：宿主 Config（容量 / 深度）与 Activation 管理的接线。
- `packages/workflow/workflow-ptc/src/index.ts`：引擎 Config 默认值与 `parallel` / `pipeline` 实现。
- `packages/bundle/web-app/presets/standard.patch.yml`：随产品装配的 delegation 组（含默认 disable 的行）。
- `.agents/notes/archived/feature/2026-08-09-parallel-subagent-delegations.md`：兄弟委派为何被声明为并发安全的归档记录，只作背景，不是契约当前状态。
