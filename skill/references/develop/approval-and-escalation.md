# 审批与提权：给危险操作加一道人门

本文是 `references/develop/index.md` 的子页，回答「哪些操作要问人、`ctx.approval` 的契约是什么、三种介入方式怎么选」。
**事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`。上游权威：`packages/interaction/user-approval/src/index.ts`、
`packages/shell/tool-bash/README.md`。

信任模型（为什么插件自己的子进程需要这道门）见 `references/develop/subprocess-and-trust.md`；
工具注册与模型可见面见 `references/develop/tool-plugins.md`；工具流水线顺序见 `docs/tool-execution-pipeline.zh.md`。

## 1. 判据：什么该问

**要问**：不可撤销的动作（向包索引上传制品、删除远端资源）；写会话工作区之外的路径（全局缓存、解释器、全局 bin、
HOME 下的配置）；读写凭据存储；清空或裁剪共享资源；一旦执行就无法回退的迁移。

**不要问**：工作区内的写、可回滚的操作、纯读、幂等且便宜的命令。逐条问会训练用户无脑点「允许」，
把门变成噪声——判据要窄、要能解释清楚。

**门不是沙箱**：`ctx.approval` 只回答「允不允许」，它**不施加任何限制**。要限制得用 `ctx.sandbox`
（见 `references/develop/subprocess-and-trust.md`）。把 approval 当沙箱用是最常见的误用。

## 2. `ctx.approval.request` 契约

入参（`packages/interaction/user-approval/src/types.ts:63`）：`agent`（必填）、`toolName`（必填）、
`callId?`、`reason?`、`displayReason?`（`{ en, [locale] }`，只给 UI、**不落盘**）、`signal?`。

出参四值，**只有一个是授权**（`packages/interaction/user-approval/src/index.ts:67`）：

| 值             | 含义                              | 处理                             |
| -------------- | --------------------------------- | -------------------------------- |
| `allowed-once` | 本次授权                          | 执行；若要跨调用记忆，此时才记账 |
| `rejected`     | 用户拒绝 / `never` 策略下自动拒绝 | 不执行，回一条可读的「未执行」   |
| `cancelled`    | `signal` abort 或请求被取消       | 不执行                           |
| `unavailable`  | 没有可用 answerer（fail-closed）  | 不执行，并给出替代路径           |

三条硬规则：

1. **必须处于 open turn**。`turn/start` 与 `turn/end` 之间才有 open turn；在 turn 外调用 `request()` 直接抛：

   ```
   approval.request() outside an open turn: the approval/asked + approval/decided audit pair must be
   turn-enclosed (a bare event between turns is crash-tail garbage on reload). Ask from inside the turn
   that needs the decision.
   ```

   （`packages/interaction/user-approval/src/index.ts:217`）原因就是文案里说的：审计对要能被 turn 包住，
   否则 reload 时被当 crash tail 丢掉。异步门要在发起调用的那一轮里问，不要等到 turn 结束。

2. **审计对自动落盘**：`approval/asked { id, toolName, callId?, reason? }` 与
   `approval/decided { id, outcome }`（`packages/interaction/user-approval/src/index.ts:225`，log-only、不进模型上下文）。
   所以「问过没有、结果如何」是会话日志里可查的证据，别自己另造一套记录。
3. **策略是会话级的**：`ask` / `never`；`approval/policy` 是 log-only 的会话覆盖、**最后一个生效**。
   `never` 下服务在派发前就返回 `rejected`——所以别在 `never` 下还去请求提权。两条模型可见文案由服务自己注入
   （`packages/interaction/user-approval/src/index.ts:73`）：`ask` 那条写明「没有 answerer 时 fail closed」，
   `never` 那条写明「不要请求提权、不要设 `sandbox_permissions`」。

## 3. 三种介入方式与选择判据

| 方式                                            | 拦谁                                            | 粒度                  | 成本                                   |
| ----------------------------------------------- | ----------------------------------------------- | --------------------- | -------------------------------------- |
| `PreToolDecision: ask`                          | 任意工具的调用（`tools/pre-execute` waterfall） | 每次调用              | core 自动映射四值，无需自己写文案      |
| `ctx.on('approval/request', …, {prepend:true})` | **别人**发出的审批询问                          | 由你的匹配条件决定    | 要关联调用上下文、自己做记忆、自己兜底 |
| 零授权专用工具                                  | 你自己的工具（from scratch）                    | 每次调用 + 自己的类表 | 工具本身成为新的信任面                 |

### 3.1 `PreToolDecision: ask`：问一次是一次

`tools/pre-execute` 是 waterfall，返回 `PreToolDecision`，其中 `{ kind: 'ask', reason?, displayReason? }`
由 core 走 approval seam 询问，并且**把四种结果映射成固定文案**：没有 approval 服务时 `ask` 直接变拒绝
（不是静默允许），没有 agent 时也拒绝（`packages/core/tools/src/index.ts:607`、`:1734`）。
适合「拦别人的工具、且每次调用都该单独决定」的场景。注意 `ctx.tools.guard` 不是审批机制：它是单调守卫、
在 approval 之后运行，只能拒绝不能放行（`packages/core/tools/src/index.ts:1136`）。

### 3.2 包裹式审批门：`approval/request` 前置监听器

当你**不能改**上游工具、又想给既有的提权询问加「同一会话授权一次就放行」时，用前置监听器包裹：
`ctx.on('approval/request', handler, { prepend: true })` 会在既有监听器之前插入
（`vendor/cordis/src/events.ts:112`）。该事件是 waterfall：handler 返回一个 outcome 就算认领，调 `next()` 才委派。

可复制的配方（B-v2 范式）：

1. 在 `tools/pre-execute` 里把 `callId → 关键参数`（例如 bash 的 `command`）记进有上限的 Map，
   **永远 `return next()`**，整段包 try/catch；
2. 在 `tools/post-execute` 里按 `callId` 清理，避免长会话泄漏；
3. 注册 `{ prepend: true }` 的 `approval/request` 监听器；
4. **只认目标询问**：`toolName` 命中且 `reason` 形如目标（有 `callId` 关联时以关联到的原始参数为权威，别只靠正则）；
5. 记忆键用 `sessionId`，**不要用 Agent 对象**——同一会话的不同派发可能给到不同对象；
6. 未识别、异常、缺字段一律 `return next()`（fail-open 给原链），只有真的拿到 `allowed-once` 才记授权。

因为最终仍走服务自身的 waterfall，`approval/asked` + `approval/decided` 对照常落盘。

### 3.3 零授权专用工具：把提权整个消掉

如果某类命令**整体**可以安全地绕开文件沙箱（例如包管理器写全局缓存），那就把它做成一个专用工具：
tool-first 指引把命令从 bash 引导过来，逐次提权自然消失（指引写法见 `references/develop/tool-plugins.md`）。
代价要认：**工具本身成为新的信任面**——默认关闭、由 profile 显式开启、风险分类表是常量 + 单测固定，
危险类仍走 §3.2/§2 的门。完整样例见 `src/uv/`（本手册所在包的仓库）与 `notes/uv.md`。

**选择判据**：先问三件事——要拦的是谁的工具（自己的 → 在 `execute` 里直接问，或 §3.3；别人的 → §3.1）；
需要跨调用记忆吗（要 → §3.2 或 §3.3 自建记忆）；能不能干脆消除这次提权（能且危害面可接受 → §3.3）。

## 4. 体验与文案设计

- `reason` 写三段：**会做什么 / 为什么危险 / 拒绝后的替代路径**。第三段最常被漏，也最影响用户是否敢拒。
- 跨调用记忆按 **`sessionId + class`**（不是「全局一次授权」），并且**必须有容量上限**（插入序淘汰；
  误淘汰只多问一次，比内存泄漏便宜）。
- fail-closed 的两种情况要各给一条兜底文案：**无审批通道**（组合里没有 approval 服务）与
  **无 agent**（不在可询问的用户会话上下文里，例如嵌套派发）。两条都要明确写出替代路径。
- approval 是**可选**服务：按可选服务的读法取（`ctx.get('approval')`，见
  `references/develop/host-entry-and-di.md` §3），缺席就 fail closed。把它声明成必需 `inject`
  会让整个插件在有 / 无审批的两种组合里出现完全不同的加载行为——这正是你想避免的。
- 任何「信任开关」（例如配置里的 `autoApprove`）都必须在结果里留痕——静默放行等于审计断层。

## 5. bash 提权流：另一种既有的门

bash 工具走的是「先拒绝、再提权」：命令被沙箱拒绝时结果里带
`[sandbox: file access denied under <mode> mode]`，模型可以**在同一轮次里对同一条命令重试一次**，
带最窄的更大 mode 与一句话 `justification`；批准才执行，被拒对该命令是终局
（`packages/shell/tool-bash/README.md:68`）。

- `sandbox_permissions` / `justification` 只在挂载了会沙箱的执行器时出现；
- 重复当前 mode 可免审批；请求不同 mode 时必须给非空理由；更窄的目标直接失败；
- 文案拼写（denial 标记、escalation 提示）锚在 `packages/sandbox/sandbox/src/escalation.ts:71`。

这套流程属于 bash 工具；你自己注册的工具**不会**自动获得它——要么复用 `ctx.approval`，要么就让用户走 bash。

## 6. 反模式

- **全局永久放行**：记忆键没有 `sessionId`，或没有上限。
- **问不出结论就静默继续**：`unavailable` / `rejected` / `cancelled` 都必须变成可读的「未执行」，
  绝不能 fallback 去执行。
- **自己弹 UI**：需要用户的结构化回答时走 `ctx.userQuestions` 或 approval seam，让 Host 推给 composer
  （`packages/interaction/user-questions/README.md:12`）；插件里自造对话框会绕过会话日志。
- **把 approval 当沙箱**、**在 turn 外请求**（会抛）、**把三种非授权结果当同一种失败**（用户看不出差别）。

## 7. 为什么不走「LLM 逐次复核」

实验性的 Auto review 路线让模型逐次判断每次调用：它每次多一次**不进缓存**的模型请求，自述「可能放行危险操作、
也可能否掉有用的工作」，并且没有确定性豁免、持久授权、可配置策略或重试层，同时不提供文件沙箱
（`packages/experimental/auto-review/README.md:12`）。要的是确定性与可审计，就用 approval seam。

## 8. 验收

- 不带上游源码，只读本页能否写出「按 `sessionId + class` 记忆 + 四种 outcome 映射 + fail-closed」——
  反查样例是 `src/uv/approval.ts` 与 `src/uv/tool.ts`。
- 会话日志里能看到 `approval/asked` / `approval/decided` 对；零授权路线下危险命令计数应为 0。

## 9. 源码最后手段

`deepseek-harness@dsh-v0.2.0-rc.2`：`packages/interaction/user-approval/src/index.ts`（请求路径与审计）、
`packages/core/tools/src/index.ts`（`ask` 的四值映射）、`packages/shell/tool-bash/README.md`（提权流程）。
查未文档化的边界时用，默认不读。
