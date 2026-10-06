# 模块：subagent（委派 seam 与它的后端）

> 本文是 `references/dsh/modules/index.md` 的子页；索引与页契约见该页。
>
> **范围**：`packages/subagent` 这一组对外给什么——服务、六个 provider、两个面向模型的工具包，以及各自的能力与生命周期边界。
> 委派机制（通道清单、并行层次、fork 种子、等待与收尾）见 `references/dsh/delegation-and-parallelism.md`；
> 子级与用户决策的边界见 `references/dsh/delegation-and-user-decisions.md`；仓外怎么自己写一个后端见
> `references/develop/subagent-provider.md`。
> **事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`。字段清单与工具 schema 以生成目录为准，本页只写契约与坑。
> 上游权威：`docs/subsystems/subagent.zh.md`（seam、provider 约定、可继续子级全文）、
> `packages/subagent/README.zh.md`（组内一张表）、`packages/subagent/subagent/README.zh.md`（服务契约、容量、失败与恢复）、
> `packages/subagent/tool-subagent/README.zh.md`、`packages/subagent/tool-subagent-control/README.zh.md`。

## 1. 包 / 对外提供

| 包                                    | 对外提供               | 形态     | Config | 说明                                                        |
| ------------------------------------- | ---------------------- | -------- | ------ | ----------------------------------------------------------- |
| `subagent/subagent`                   | `ctx.subagents`        | 插件     | 有     | provider 注册表 + 可继续子级编排 + 目录发现                 |
| `subagent/subagent-in-process-driver` | 无（纯库）             | **纯库** | —      | 进程内后端共享的创建 / 驱动 / dispose 实现                  |
| `subagent/subagent-spawn-in-process`  | 注册到 `ctx.subagents` | 插件     | 有     | 全新子级，注册名默认 `spawn`；五旗标全支持                  |
| `subagent/subagent-fork-in-process`   | 注册到 `ctx.subagents` | 插件     | 有     | 以父级已完成轮次前缀播种的子级，注册名默认 `fork`           |
| `subagent/subagent-acp`               | 注册到 `ctx.subagents` | 插件     | 有     | 经 ACP 的进程外子级；一次性，`agentOptions` 被拒            |
| `subagent/subagent-codex`             | 注册到 `ctx.subagents` | 插件     | 有     | 经 app-server 协议的真实 Codex 子级                         |
| `subagent/subagent-claude-code`       | 注册到 `ctx.subagents` | 插件     | 有     | 经官方 Agent SDK 的真实 Claude Code 子级                    |
| `subagent/subagent-dsh-sdk`           | 注册到 `ctx.subagents` | 插件     | 有     | TypeScript SDK 起的进程外 Harness 子级；支持 `agentOptions` |
| `subagent/tool-subagent`              | 注册到 `ctx.tools`     | 插件     | 有     | 一个实例＝一个 provider + 一个 `toolName`                   |
| `subagent/tool-subagent-control`      | 注册到 `ctx.tools`     | 插件     | 有     | `send_message` / `interrupt_agent` / `list_agents`          |

## 2. seam 与独占位

- **`ctx.subagents` 是注册表服务，不是独占位**：provider 按名字并存，一次 `start(name, …)` 路由到一个。
  注册是 effect、重名抛 `DUPLICATE_PROVIDER`；卸载 provider 只阻断新启动，不撤销已交出的 run。
- **可继续子级只有一套编排**：continuation manager 归服务所有——它预留身份、组子级、投递、冷恢复、销毁；
  provider 只贡献一次性 `start()` 与可选的 `prepareContinuable()`（方法存在即能力）。
- **在线容量在服务上，不在 provider 上**：`maxActiveSubagents` 默认 8，限制经 continuable 父子边共享名额的驻留子级；
  一次性与进程外 run 不占该名额。深度由委派工具自己的策略决定，服务只提供 Host 默认值。
- **两个工具包的槽位**：`tool-subagent` 每个实例一个 `toolName`（同 scope 内唯一）；
  `list_subagent_models` 用全局名，所以一个工具 scope 内最多一个实例拥有模型选择。
- lifecycle 事件 `subagent/start` / `subagent/end`（按 run 配对）、`subagent/provider-added` / `provider-removed`、
  `subagent/descriptor`、`subagent/catalog` 都只供观察——事件语义不在这里重写。

## 3. 能替换 / 不能碰

- **能替换 / 能加**：自己写一个 provider 注册进 `ctx.subagents`（见 `references/develop/subagent-provider.md`）；
  另挂一个 `tool-subagent` 实例指向别的 provider 与工具名；关掉进程外后端或改其注册名。
- **不能碰**：`ctx.subagents` 的注册表与 continuation manager 语义（身份、准入、冷恢复、结算）；
  两个工具包的固定工具名与结果包络——要改行为请改配置或换自己的工具。
- **`tool-subagent` 与 provider 同生共死**：provider 消失，工具也消失，不会留下悬空工具；
  两个面向模型的工具包都只消费服务，不注册服务。

## 4. 易错点

- **把 provider 当单执行器**：同名注册直接抛 `DUPLICATE_PROVIDER`；想并存就换名字，别去改服务。
- **声明了不支持的能力**：请求带 `agentOptions` / `outputSchema` / `maxDepth` / `toolFilter` / `persona`
  而 provider 未声明对应旗标时，在 run 存在之前就抛 `UNSUPPORTED_CAPABILITY`（不静默忽略）。
- **continuable 需要 `prepareContinuable`**：没这个方法的 provider 跑 `backgroundMode: continuable`
  会被拒；改成 `one-shot`，或换一个支持可继续的后端。
- **容量与并发是两回事**：前台派生占 loop 并行池位；后台 / continuable 调用收到 id 就释放池位，
  约束它们的换成 `maxActiveSubagents`；满额时冷恢复以 `subagent/delivery-unavailable` 拒绝。
- **`list_agents` 的 `running` / `inactive` 不代表完成**：完成以结算通知（或 job 状态）为准。
- 等待、并行、fork 可见性与 plan mode 边界都不在本页：见 `references/dsh/delegation-and-parallelism.md` §5、§6、§8
  与 `references/dsh/delegation-and-user-decisions.md`。

## 5. 源码最后手段

- 只看一条事实：`git -C 3rdp/deepseek-harness show deepseek-harness@dsh-v0.2.0-rc.2:<path>`（只读，不切换工作树）。
- 本页引用的每条上游路径都在 `src/facts.test.ts` 有台账条目；失效时测试按条目报出来。
