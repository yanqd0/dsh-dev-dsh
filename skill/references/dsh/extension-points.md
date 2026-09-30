# 扩展点：事件域、capability seam 与 scope

> 本文是 `references/dsh/index.md` 的子页。
>
> **范围**：能从哪里介入 dsh——事件分几个域、seam 由哪些角色组成、注册在哪个 scope 生效。
> 层与平面见 `references/dsh/architecture.md`，运行时机制见 `references/dsh/plugin-model.md`。
> **事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`。本页给判据，不堆签名。
> 上游权威：`docs/architecture.zh.md`（事件）、`docs/capability-seams.zh.md`（服务与 seam 全景）、
> `docs/event-producer-consumer.zh.md`（事件矩阵）、`docs/glossary.zh.md`（术语定义）。

## 1. 先选事件域

事件就是扩展点，**选对事件域是大多数改动的第一个决定**：

| 域             | 例子                                                        | 什么时候用                                                                 |
| -------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| 会话事件       | `turn/*`、`step/*`、`system/message`、`user/message`、`assistant/message`、`tool/*` | 事实必须跨重载存在时。它们追加进会话日志并经 `session/event` 广播           |
| Agent 事件     | `agent/pre-step`、`agent/request`、`agent/turn-stopping`、`agent/created` | 要观察或拦截**进行中**的工作时使用；带活跃 `Agent`，进程内实时              |
| 能力事件       | `fs/*`、`tools/*`、`llm/*`、`telemetry/*`                    | 给某个 seam 追加策略或适配器，又不想引入 import 环时使用                    |

- 持久 vs 实时：只有会话事件进日志；能不能跨 reload 存活，是第一个筛子。
- 分发模式（`waterfall` 必须调 `next()`、`serial` 没有 `next()`）见 `references/dsh/plugin-model.md` §2。
- 生产方 / 消费方清单：`docs/event-producer-consumer.zh.md`；轮次时序：`docs/agent-lifecycle.zh.md`。

## 2. capability seam：三个角色才算一个能力

**seam 是一项可替换能力**，包含三种角色：

- **Service Definition**：拥有自己的 `ctx.<key>` 与词汇类型的 Cordis `Service`。可以是抽象类
  （`ShellExecutor`），也可以是具体注册表（`WebRuntime`）——**绝不是 TypeScript `interface`**。
- **Service Provider**：实现它（`dsh-bash-local` / `dsh-bash-sandbox`）。
- **Consumer**：注入并使用它（通常是面向模型的工具，如 `dsh-tool-bash`）。

角色需要独立演进时通常位于不同包；同一关注点也可以由一个包兼任多个角色。**seam 指完整能力，不指其中
任一角色**，所以「加一个能力」等于把三者一并设计。

这也解释了为什么替换一个提供方就能改变整个产品：文件系统与进程提供方共享同一个执行世界，
把它们指向远端沙箱，Bash、PTY、LSP 就一起被搬了过去，不需要任何提供方专用 fork。

服务全景（核心主干服务 / 可替换 seam / 组合点 / 独立服务）见 `docs/capability-seams.zh.md`。

## 3. scope：注册在谁身上生效

- **两种可见性**：注册要么是*全局的*（所有 agent 可见），要么是*带作用域的*（属于恰好一个 scope key）。
  只有两层，扁平结构；带作用域的注册不会继承给 subagent。
- **scope key**：不透明标识，按对象同一性比较。harness 约定：一个活跃的 agent 就是它自身 scope 的 key。
- **`agent.ctx`**：agent 的带作用域上下文。通过它注册，既获得 scope 可见性，生命周期也绑定该 scope，
  其监听器参与该 agent 的 scope 过滤分发。
- **scoped dispatch**：关于某个 agent 活动的事件以该 agent 的 carrier 分发；关于注册表本身的事件
  （「一个工具被添加了」）属于*注册表主体*事件，保持不过滤。
- **shadowing**：最具体者胜出——带作用域的工具 / 片段 / 变量只在该 scope 内替换同名的全局对应项。
  这是按 agent 定制 persona 与工具变体的机制。
- **restriction**：`tools.restrict` 为单个 scope 过滤全局工具集合（多个按交集组合），之后再合并 scope-local
  注册。被过滤掉的全局工具既不出现在提示词里，也拒绝执行——与不存在的工具不可区分。
- **setup window**：创建 agent 时的注册时隙（scope 与 agent 已存在，但尚未发布、`agent/created` 未触发、
  首次提示词未组装）。**setup 只做注册，从不驱动 agent**。
- **lineage**：`parentSession`、持久的 `delegationDepth`、运行时的 `subagentDepth`——以数据表达父子关系，
  **从不影响可见性**。

定义出处：`docs/glossary.zh.md#agent-scope`；实现原语在 `packages/core/scope`。

## 4. 新行为该放哪

先决定事件域（§1），再决定归属的插件或服务，最后证明可回收。常用映射：

| 目标                                 | 机制                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------ |
| 添加模型提供方                       | 在 `ctx.llm` 上注册适配器                                                |
| 添加面向模型的能力                   | 在 `ctx.tools` 上注册；schema 进入提示词组装                             |
| 拦截请求、工具或轮次                 | 用相应的 `agent/*` 或 `tools/*` 事件；`agent/turn-stopping` 结束轮次      |
| 让某个会话拥有不同的能力集合         | 组装 agent preset；其中的服务行需要 `isolate` realm                      |
| 添加 shell / 终端 / 文件系统 / 沙箱后端 | 注册对应的 seam provider（`ctx.shell`、`ctx.terminals`、`ctx.fs`、`ctx.sandbox`） |
| 添加用户命令                         | 在 `ctx.commands` 上注册；无需模型轮次即可分派                           |
| 管理后台任务                         | 在 `ctx.jobs` 上注册；`job_*` 工具读取或停止                             |
| 从外部 webhook 启动会话              | 在 `ctx.webhookRuntime` 上注册可信规则，并挂载提供方适配器                |
| 添加模型可见上下文                   | 调用 `agent.inject()`；它落到下一次获准的请求                             |
| 添加 UI 或编辑器集成                 | 驱动 `ctx.agents`，并从 `session/event` 渲染                              |
| 添加持久会话状态                     | 扩展 `SessionEventMap`；从日志渲染和回放                                  |
| 生成会话标题 / 管理同会话目标        | 注册唯一的 `ctx.sessionTitle` 提供方 / 使用 `ctx.goals`                    |
| 在新后端存储会话                     | 基于共享的句柄脚手架实现 `SessionPersistence`                             |
| 把注册限定到单个 agent               | 使用该 agent 的 `agent.ctx`                                               |

（上游同一张表的完整版本：`docs/architecture.zh.md` 末尾「新行为的归属位置」。）

## 5. 纪律

- 新行为挂在**已文档化**的扩展点上；不改核心、不靠 façade 或监听顺序硬凑（见
  `references/dsh/design-principles.md`）。
- 每个注册都要有 disposer；卸载后副作用必须消失。
- 需要跨 reload 存在的事实，一律走会话事件，而不是内存注册。

## 6. 源码最后手段

本页覆盖不到的签名单读上游子系统页，仍不够才读源码：

- `git -C 3rdp/deepseek-harness show deepseek-harness@dsh-v0.2.0-rc.2:<path>`（只读，不切换工作树）。
- 本页引用的每条上游路径都在 `src/facts.test.ts` 有台账条目。
