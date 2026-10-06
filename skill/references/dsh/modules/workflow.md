# 模块：workflow（编排脚本 seam 与它的引擎 / 工具）

> 本文是 `references/dsh/modules/index.md` 的子页；索引与页契约见该页。
>
> **范围**：`packages/workflow` 这一组对外给什么——引擎服务、它的执行引擎、两个面向模型的工具包。
> 脚本语义与失败纪律的正文见 `references/dsh/delegation-and-parallelism.md` §3.2 与上游
> `docs/subsystems/workflow.zh.md`；委派本身的机制见 `references/dsh/delegation-and-parallelism.md`。
> **事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`。Config 字段全集以生成目录为准，本页只写契约与坑。
> 上游权威：`docs/subsystems/workflow.zh.md`（类型词汇、启动请求与 `workflow/*` 事件）、
> `packages/workflow/README.zh.md`（组内一张表）、`packages/workflow/workflow/README.zh.md`（服务契约与失败纪律）、
> `packages/workflow/workflow-ptc/README.zh.md`（当前引擎与隔离边界）、`packages/workflow/tool-workflow/README.zh.md`、
> `packages/workflow/tool-ralph/README.zh.md`。

## 1. 包 / 对外提供

| 包                       | 对外提供                    | 形态                        | Config | 说明                                                                         |
| ------------------------ | --------------------------- | --------------------------- | ------ | ---------------------------------------------------------------------------- |
| `workflow/workflow`      | `ctx.workflowEngine`        | **抽象 Service Definition** | 无     | 类型词汇、`workflow/*` 事件、`WorkflowError`；**本身不单独挂载**             |
| `workflow/workflow-ptc`  | 注册到 `ctx.workflowEngine` | 插件                        | 有     | 当前执行引擎：共享的沙箱化 PTC Node 进程运行时                               |
| `workflow/tool-workflow` | 注册到 `ctx.tools`          | 插件                        | 有     | 把 `workflow` 工具给模型；拥有调用 schema 与结果包络                         |
| `workflow/tool-ralph`    | 注册到 `ctx.tools`          | 插件                        | 有     | `ralph` 工具：固定前台的全新 agent 序列；随产品的 preset 行 `disabled: true` |

`ctx.workflowEngine` 落在一个 `Service` 定义上：引擎插件就是那个 provider 行。**一个上下文同时只有一个引擎**——
加载第二个引擎会明确报错，因此换引擎＝换组合里那个引擎插件，不是并行挂两个。

## 2. seam 与独占位

- **`ctx.workflowEngine.start({ script, meta, args?, parent, signal? })` 是消费者入口**：
  在读脚本与 meta 之后才发布 run；格式错误的请求立即以违规清单失败，不产生 run。
- **run 由持有者负责**：返回的句柄给 `id` / `meta` / `result` / `cancel(reason?)` / `dispose()`；
  `result` **永不 reject**——脚本失败以 `stopReason: 'error'`、取消以 `'cancelled'` 兑现。
  引擎卸载阻止新启动，但**不撤销已接受的 run**，每个调用方都得 dispose 自己启的那个。
- **`workflow/*` 事件只供观察**：payload 是身份快照，绝不带活动 run，所以监听器拿不到取消或 dispose 权限；
  `workflow/start`↔`workflow/end`、`workflow/agent-start`↔`workflow/agent-end` 按 `seq` 配对。
  事件语义与逐事件 payload 见 `references/dsh/session-log.md` 与 `docs/subsystems/workflow.zh.md`。
- **引擎绑定 `ctx.subagents`**：脚本里的 `agent()` 用引擎配置的 subagent provider（默认 `spawn`），
  每个子级归属于调用它的 agent；子级的生命周期仍归各 provider 的约定（见
  `references/dsh/modules/subagent.md`）。

## 3. 能替换 / 不能碰

- **能替换**：`ctx.workflowEngine` 的实现（引擎插件行）——只要满足服务定义，脚本、run、结果与事件词汇都不变；
  面向模型的 `toolName` 与 `maxResultChars` 是工具包的 Config。
- **不能碰**：服务的类型词汇与事件配对（`workflow/*` 是观察面，不是控制面）、`result` 永不 reject 的承诺、
  「run 归持有者」的所有权模型；要改这些等于改 seam。
- **`tool-ralph` 不是通用委派**：它跑固定的全新 agent 序列（每个 Round 只拿一份有界报告，工作区是跨 Round 记忆），
  仅当直接用户明确要求 Ralph 式迭代时用；普通长期工作用 goal，有界委派用 subagent 或 `workflow`。

## 4. 易错点

- **把 Definition 当可挂载行**：`workflow/workflow` 只声明服务；组合里必须有 `workflow-ptc`（或别的引擎）才能跑。
- **忘了 `dispose()`**：`start()` 返回活动 run，`result` 结算不等于清理完成；
  抛错的监听器只被记录、不会饿死同级，所以别指望它们替你收尾。
- **钩子误用是 fatal 不是 `null`**：错参数、未知选项、不支持的 schema、超出上限都会直接终止脚本；
  只有「子运行失败」与阶段内普通脚本错误才映射成逐项 `null`。机制见
  `references/dsh/delegation-and-parallelism.md` §3.2。
- **`workflow` 调用是独占屏障**：`tool-workflow` 未声明 `isConcurrencySafe`，一次只跑一个 workflow；
  脚本里 `for (…) await agent(…)` 也是串行的，要并行必须显式用 `parallel` / `pipeline`。
- **Python PTC 组合要显式禁掉本组**：`workflow-ptc` 在加载时拒绝非 TypeScript 的 PTC provider；
  这类组合必须禁用 `workflow-ptc`、`tool-workflow` 以及任何已启用的 `tool-ralph`。
- **`ralph` 的报告会被校验**：无效或过大的报告使运行失败，不会被截断、也不会被当成预算耗尽。

## 5. 源码最后手段

- 只看一条事实：`git -C 3rdp/deepseek-harness show deepseek-harness@dsh-v0.2.0-rc.2:<path>`（只读，不切换工作树）。
- 本页引用的每条上游路径都在 `src/facts.test.ts` 有台账条目；失效时测试按条目报出来。
