# 写一个委派后端：subagent provider 与委派工具

> 本文是 `references/develop/index.md` 的子页；分类轴与通用工程面见该页。
>
> **范围**：仓外插件怎么写一个 subagent provider（`ctx.subagents.registerProvider`）并挂一个委派工具，
> 以及两侧的所有权、能力旗标与失败面。运行机制（通道清单、并行层次、fork 语义、等待与收尾）不在本页，
> 见 `references/dsh/delegation-and-parallelism.md`。
> **事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`。字段清单以生成目录为准，本页只写契约与坑。
> 上游权威：`docs/subsystems/subagent.zh.md`（seam、provider 约定、可继续子级）、
> `packages/subagent/README.zh.md`（组内一张表）、`packages/subagent/subagent/README.zh.md`（服务侧全文）、
> `packages/subagent/tool-subagent/README.zh.md`（工具侧字段与两套结算）。

## 1. 它是什么：一个注册表，不是单执行器 seam

`ctx.subagents` 是**按名字注册的 provider 注册表**（`SubagentRuntime`，同一上下文可并存多个后端）；
每次 `start(name, request)` 按名字路由到其中一个。这与只有一个执行器的 `ctx.shell` 不同，与
`ctx.llm` 的适配器注册表同族。
`references/dsh/modules/subagent.md` 给各包的对外契约；`references/dsh/delegation-and-parallelism.md` §2
给随产品装配的通道清单。

## 2. 注册：effect、重名、disposer 的边界

- **注册是 effect**：`ctx.subagents.registerProvider(provider)` 返回 cordis 的 effect disposer，
  插件卸载或 HMR 时自动回收。
- **重名 fail-loud**：同名 provider 已存在时抛 `DUPLICATE_PROVIDER`（`a subagent provider named "…" is already registered`）；
  注册成功同步 emit `subagent/provider-added`，**监听器抛错会回滚这次注册**。
- **disposer 只阻断新 start**：卸载 provider 只从注册表移除它并 emit `subagent/provider-removed`——
  **已经返回给持有者的运行不被撤销**，它们照常结算。反过来，已接受的 run 也不依赖注册还在。
- `start()` 找不到名字时抛 `NO_PROVIDER`（`no subagent provider registered for "…"`）——不是静默回退到别的后端。

## 3. provider 契约：五要素

| 要素                    | 类型 / 形态                                     | 契约                                                                                              |
| ----------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `name`                  | `string`                                        | 注册表键，也是 `start(name, …)` 的路由键；同一上下文内唯一                                        |
| `capabilities`          | `SubagentCapabilities`                          | 五个布尔旗标，逐项对应 `SubagentStartRequest` 的一个可选字段（见 §4）                             |
| `inheritsParentContext` | `boolean`                                       | **仅用于措辞**：`tool-subagent` 据此在工具描述里选「看不到本对话」/「看不到进行中的回合」两种说法 |
| `agentRouteDefaults?`   | `Readonly<{ provider: string; model: string }>` | 可选的静态初始路由；要求 `agentOptions` 能力，消费方在预检前被工具配置与模型字段覆盖              |
| `start(request)`        | `Promise<SubagentRun>`                          | 建立一次性子级；**兑现即所有权转移**                                                              |
| `prepareContinuable?`   | `Promise<ContinuableCreateSpec>`                | 可选；**方法存在即能力**，只贡献「要不要用父级历史做种子」（见 §6）                               |

`inheritsParentContext` 是 `fork` / `spawn` 的区分依据（`references/dsh/delegation-and-parallelism.md` §6），
但它**不是服务校验的能力**，也说明不了工具注册、注入服务或授权的继承。

## 4. 能力旗标：逐项对应 start 请求字段

`capabilities` 的五个旗标与 `SubagentStartRequest` 的可选字段一一对应（`depthLimit` 对应 `maxDepth`，其余同名）：

| 旗标           | start 请求字段 | 缺了它时                     |
| -------------- | -------------- | ---------------------------- |
| `agentOptions` | `agentOptions` | 请求带 `agentOptions` 即被拒 |
| `outputSchema` | `outputSchema` | 请求带 schema 即被拒         |
| `depthLimit`   | `maxDepth`     | 请求带数值深度上限即被拒     |
| `toolFilter`   | `toolFilter`   | 请求带工具限制即被拒         |
| `persona`      | `persona`      | 请求带 persona 即被拒        |

服务在委派之前逐项检查，**只报第一个缺的**：`subagent provider "…" does not support the "…" capability`，
错误码 `UNSUPPORTED_CAPABILITY`。这是「fail loud，不静默降级」——不会「接受了再忽略」。
所以后端要么老老实实把旗帜标对，要么让它在第一次委派时炸；**标 `false` 比标了不实现安全**。

## 5. `start()` 的所有权转移与 `SubagentRun`

- 服务在调用 `start()` **之前**已完成：能力校验、`request.descriptor` 解析（落进 `ResolvedSubagentStartRequest`）。
  session-backed 的实现要把这个 descriptor 追加进子级的初始回合。
- **兑现即边界**：`start()` 兑现之前 provider 拥有全部 setup，reject 前必须清掉未发布的半成品资源
  （reject 的调用方**没有 run 可 dispose**，也不会有 run 生命周期事件）。
  兑现之后**调用方拥有该 run**。
- `SubagentRun`：`id`（本地 run 必须等于子会话 id；远端 provider 在父命名空间里自己 mint）、
  `localAgent`（进程内子级，远端为 `undefined`）、`result`（**不因子级失败而 reject**；
  `stopReason` 非 `completed` 就是那次失败）、`dispose()`（取消剩余工作、等到不活动并释放资源，**幂等**）。
- 消费方**每条路径都要 `dispose()`**。`tool-subagent` 的前台路径就是「等 `result`、渲染、再等 `dispose()`」。
- **并发**：服务可能对同一个 provider 并发调用 `start()`，不同 run 之间必须互相独立；
  共享容量控制器可以延迟一个操作，但**不能把它的结算或清理耦合到兄弟操作上**。

## 6. `prepareContinuable`：方法存在即能力

- provider 没实现该方法时，continuable start 抛 `UNSUPPORTED_CAPABILITY`
  （`subagent provider "…" does not support continuable children (no prepareContinuable capability)`）；
  实现了它，同一 provider 仍可正常服务一次性委派。
- 它返回的 `ContinuableCreateSpec` 是**数据，不是能力**：只有可选的 `seed`，
  即「父级日志中自 seq 0 起连续、止于最后一个 `turn/end`、配平且无损 JSON 的**已完成轮次前缀**」；
  不要父级历史就返回 `{}`（`subagent-spawn-in-process` 就是这么做的，`subagent-fork-in-process` 则算种子）。
- 这是 provider 在 continuable 子级上的**唯一参与**：身份预留、子级组装、Agent 创建、投递、冷恢复、
  所有权与销毁全归 `ctx.subagents` 内部的 continuation manager——**provider 永远见不到那个子级的 Agent、
  handle、轮次与拆除**。所以「provider 卸载了，已建的可继续子级怎么办」不是 provider 要回答的问题。
- fork 种子的机制细节（含「看不见当前进行中的回合」与「一次性快照」）只在
  `references/dsh/delegation-and-parallelism.md` §6，本页不重写。

## 7. 工具侧：一个 provider 一个工具实例

挂 `tool-subagent` 并指到 provider；**每个委派目标一个实例，`toolName` 必须不同**（重名会撞 `ctx.tools` 的同 scope 唯一性）。

| 字段                     | 作用与前提                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `provider`（必填）       | `ctx.subagents` 上的 provider 名                                                                                                                             |
| `toolName`               | 模型看到的工具名（默认 `subagent`）；每个实例不同                                                                                                            |
| `backgroundMode`         | `one-shot`（默认，前台等待）或 `continuable`（默认后台；**要求 provider 有 `prepareContinuable`**）                                                          |
| `enableRunInBackground`  | 是否公开 `run_in_background`（默认 `true`）；后台默认值取 `run_in_background ?? continuable`                                                                 |
| `maxDepth`               | 数值深度上限（`0` 禁止委派；要求 `depthLimit`）或 `'provider-managed'`；省略时读 Host 设置的当前值（`1`）                                                    |
| `persona` / `toolFilter` | 每个子级独立的 persona / 全局工具限制；分别要求 `persona` / `toolFilter` 能力                                                                                |
| `modelSelectionSettings` | 为每个顶层 Session 读宿主 `subagent-model-selection` 偏好，多出 `provider` / `model` / `reasoning_effort` 参数与 `list_subagent_models`；要求 `agentOptions` |

- **工具与 provider 同生共死**：工具随具名 provider 出现而注册、随其离开而释放，
  所以同级加载顺序与 HMR 替换都不会留下悬空工具。
- **能力对不上在挂载时就失败**：工具配了数值型 `maxDepth`、`agentOptions` 或 `modelSelectionSettings`，
  或 `backgroundMode: continuable` 而目标 provider 不具备对应能力 / 方法，注册即抛错，不会拖到首次委派。
  反过来，**provider 尚未注册不算失败**：工具先不挂，等 `subagent/provider-added` 到了再挂上——
  所以名字拼错的表现是「工具一直不存在」，只有一行 info 日志。
- 系统提示词节（`Start independent <工具名> delegations together …`）由 `tool-subagent` 注入；
  这是随产品 preset 观察到的行为，本文不保证仓外配置下的细节——机制见
  `references/dsh/delegation-and-parallelism.md` §4。

## 8. 易错点

- **把 `capabilities` 当摆设**：声明 `true` 却在自己的 `start()` 里忽略对应请求字段＝静默降级，正是 seam 要禁的。
- **`inheritsParentContext` 被当成能力或授权**：它只改工具措辞，不控制任何校验；子级能力继承另说。
- **fork 措辞不等于 fork 行为**：措辞来自该旗标；种子来自 `prepareContinuable` 的 `seed`，两处口径要一致。
- **忘了 dispose**：`result` 到了不等于资源释放完；`dispose()` 幂等，重复调用安全。
- **`start()` reject 前没回滚**：半成品子级会变成孤儿，且调用方没有 dispose 的入口。
- **在 `prepareContinuable` 里越权**：它只能回数据；想拿子级 handle、投递提示词或恢复会话都会越界。
- **`toolName` 撞车**：同一 scope 内 `ctx.tools` 名字唯一，两个实例同名直接抛。
- 想改的是**机制**而不是后端：等待与收尾（禁 `sleep`）、并行层次、plan mode 下的委派边界都在
  `references/dsh/delegation-and-parallelism.md` 与 `references/dsh/delegation-and-user-decisions.md`。

## 9. 源码最后手段（默认不读）

- `deepseek-harness@dsh-v0.2.0-rc.2:packages/subagent/subagent/src/types.ts`（`SubagentProvider` 逐字段
  与各字段的 JSDoc，契约的原始出处）。
- `packages/subagent/subagent/src/index.ts`（`registerProvider` 的 effect 体、`assertCapabilities`
  与 `prepareContinuable` 的门禁）。
- `packages/subagent/subagent-spawn-in-process/src/index.ts`（最小的 provider：五旗标全 `true`、
  `inheritsParentContext = false`、空种子）。
- `packages/subagent/tool-subagent/src/index.ts`（工具注册、生命周期镜像、后台策略取值）。
