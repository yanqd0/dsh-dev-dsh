# 模块：core（主干服务）

> 本文是 `references/dsh/modules/index.md` 的子页；索引与页契约见该页。
>
> **范围**：`packages/core` 这一组对外给什么——主干服务、事件与可替换点。用户可见行为（提示词、工具、轮次时序）不在这里，
> 只在"上游权威"处路由。
> **事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`。清单类内容以生成目录为准，本页只写契约与坑。
> 上游权威：`packages/core/README.zh.md`（组内一行职责）、`docs/subsystems/core.zh.md`（Agent 约定与轮次）、
> `docs/subsystems/tools.zh.md`（工具注册与执行流水线）、`docs/subsystems/system-prompt.zh.md`（提示词组装）、
> `docs/subsystems/scope.zh.md`（scope 词汇）、`docs/subsystems/session.zh.md`（会话日志）、
> `docs/user/develop/basic/tool.zh.md`（最小工具）、`docs/cookbook/adding-a-tool.zh.md`（完整工具流程）。

## 1. 包 / 对外提供

| 包                             | 对外提供                                         | 形态     | Config | 说明                                                         |
| ------------------------------ | ------------------------------------------------ | -------- | ------ | ------------------------------------------------------------ |
| `core/agent`                   | `ctx.agents`（`AgentRegistry`，含 `setFactory`） | 插件     | 无     | agent 注册表 + `agent/*` 事件词汇；驱动器可替换              |
| `core/agent-loop`              | `ctx.agentLoop`                                  | 插件     | 有     | **唯一内置 `AgentFactory`**：默认驱动器                      |
| `core/agent-default-model`     | `ctx.agentDefaultModel`                          | 插件     | 有     | 未显式指定模型时给 agent 的默认值                            |
| `core/agent-tool-presentation` | 无 `ctx` 键（调 `ctx.tools.presentAs`）          | 插件     | 有     | 每个 agent 的工具展现（`native` / `ptc` / `both`），按行挂载 |
| `core/session`                 | `ctx.sessions`                                   | 插件     | 无     | 仅追加 `SessionEvent` 日志与派生历史（见会话页）             |
| `core/tools`                   | `ctx.tools`                                      | 插件     | 有     | 工具注册表 + 受守卫的执行流水线 + PTC 展现                   |
| `core/system-prompt`           | `ctx.systemPrompt`                               | 插件     | 有     | 提示词分节、上下文、变量与工具 schema 组装                   |
| `core/scope`                   | 无（纯库）                                       | **纯库** | —      | `createScope` / `scopeOf` / `Scoped<T>` 等作用域原语         |

`packages/bundle/base/cordis.patch.yml` 挂载了 `session`、`session-log-deepseek`、`agent`、`agent-default-model`、
`session-checkpoint-policy`、`tools`、`system-prompt`、`agent-loop`；`agent-tool-presentation` 只在 preset 行里出现（如 web-app 的 `ptc.patch.yml`）。
**替换驱动器只需换掉 `agent-loop` 这一行**：扩展插件依赖 `ctx.agents` 的 `Agent` 约定，而不是它的实现。

## 2. seam 与独占位

| `ctx` 键                | Service Definition         | 随产品交付的 provider     | 关键消费者                                                     |
| ----------------------- | -------------------------- | ------------------------- | -------------------------------------------------------------- |
| `ctx.agents`            | `core/agent`               | `core/agent-loop`（工厂） | `agent-loop`、`acp`、`subagent` 的进程内驱动器                 |
| `ctx.sessions`          | `core/session`             | 同包（定义即提供）        | `agent-loop`、`session-persistence`、`session-query`、其它读方 |
| `ctx.tools`             | `core/tools`               | 同包                      | `agent-loop` 与全部 `tool-*` 包                                |
| `ctx.systemPrompt`      | `core/system-prompt`       | 同包                      | `agent-loop`、`tools`、若干 `tool-*`                           |
| `ctx.agentDefaultModel` | `core/agent-default-model` | 同包                      | `api/session-controller`、`bundle/headless`、`webhook`         |

另有**启动器预置键**（由 bin 在 Loader 行之前 `provide`，不是插件注册的）：`ctx.cmdlineArgs`、`ctx.profileContext`、
`ctx.pluginPackages`、`ctx.configuredAgentIdentities`。插件可以消费，不要自行 provide。

## 3. 能替换 / 不能碰

- **能替换**：`ctx.agents` 的驱动器（换成自己的 `AgentFactory`）；`ctx.sessionPersistence` 的后端（另一个包）；
  `ctx.tools` 上的工具；`ctx.systemPrompt` 的分节与上下文贡献者；`ctx.llm` 的模型适配器（见模型页）。
- **不能碰（改行为请挂扩展点）**：`agent-loop` 的轮次状态机、`core/session` 的日志与 surface 规则、
  `core/tools` 的守卫流水线顺序。要改这些等于改核心；先看 `references/dsh/extension-points.md` §4 的归属表。
- **不要把 `scope` 当服务**：它没有 `ctx` 键，是给别的注册表用的原语。

## 4. 易错点

- **`ctx.tools` 工具名按 scope 唯一**：一个 scope 内重名直接抛 `tool "…" is already registered in this scope`；
  给单个 agent 的变体要注册到该 agent 的 `agent.ctx`，不是全局。
- **`ctx.tools.presentAs()` 每个 scope 只能声明一种展现**：第二次声明抛「conflicts with … already declared for this scope」。
- **`ctx.sessions.flush(session)` 是唯一被认可的 flush 入口**：store 持有 scoped `session/flush` 载体；
  自己 `ctx.parallel('session/flush', …)` 会破坏一个所有者的不变式。不挂 persistence 后端时它返回"无参与者"。
- **`session/created` 监听器可以同步抛错来否决发布**（会回滚并成对 dispose）；`session/event` 监听器抛错只被记录，不影响 append。
- **持久化是插件关注点**：`core/session` 不落盘；订阅 `session/event`、在 `session/flush` 排水的是后端插件。
- **`ctx.sessions` 的同步读取方法（`eventAt` / `snapshotEvents` / `ownEvents`）已 deprecated**：新代码不要用，改走事件订阅或句柄读取。
- **`ctx.systemPrompt` 与 `ctx.tools` 的贡献都是 effect**：注册返回 disposer，卸载后必须消失（见设计原理页 §2）。
- 轮次 / 步骤的时序、事件域归属：`references/dsh/architecture.md` §6 与 `references/dsh/extension-points.md` §1。

## 5. 源码最后手段

- 只看一条事实：`git -C 3rdp/deepseek-harness show deepseek-harness@dsh-v0.2.0-rc.2:<path>`（只读，不切换工作树）。
- 本页引用的每条上游路径都在 `src/facts.test.ts` 有台账条目；失效时测试按条目报出来。
