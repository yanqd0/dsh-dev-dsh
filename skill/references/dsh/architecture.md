# dsh 架构主干

> 本文是 `references/dsh/index.md` 的子页。
>
> **范围**：dsh（含 Cordis）的层、职责与主干流转——开发插件前必须先装进脑子的那一层。
> 模块清单、内部设计、服务与事件签名进 `references/dsh/modules/`；版本差异进 `references/dsh/versions/`。
> **事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.1`。本页结构跨版本稳定：清单类内容不要往这里堆。
> 上游权威叙述：`docs/architecture.zh.md`；子系统逐页参考 `docs/subsystems`。

## 1. 心智模型：一切皆插件

dsh 是**全插件**的 Cordis agent harness，**不存在需要打补丁的特权内核**：模型适配器、工具注册表、
会话日志、agent loop 本身都是插件，都能从配置替换（`docs/architecture.zh.md`；Cordis 入门见
`docs/cordis-primer.zh.md`）。

- 插件向共享上下文 `ctx` 贡献**服务**、**类型化事件**与**可逆副作用**；注册是 effect，随插件卸载撤销。
- 扩展 dsh 的方式是把自己的插件挂到别的插件旁边，而不是改核心。

**对仓外作者的含义**：你的插件与官方包同权。接入点是 `ctx`（服务与事件）与 `package.json`（组装声明），
不是内部 import。

## 2. 分层

| 层         | 位置                                                                                                                                                 | 职责                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 框架       | `vendor/cordis`、`vendor/loader`、`vendor/include`                                                                                                   | 插件 / 服务 / 事件模型、加载器、patch（include）语义                     |
| 核心       | `packages/core/agent`、`packages/core/agent-loop`、`packages/core/tools`、`packages/core/session`、`packages/core/system-prompt`、`packages/llm/llm` | Agent 接口与默认驱动器、工具注册与执行、会话日志、提示词组装、模型词汇表 |
| 启动与组装 | `packages/boot/app-boot`、`packages/boot/plugin-manager`、`packages/bundle/base`、`apps/cli`                                                         | profile 与组合包叠加、插件安装与 reconcile、launcher                     |
| 客户端     | `packages/client`（含 `packages/client/web`）                                                                                                        | 浏览器应用、ui-\* 插件、客户端插件 bundle                                |
| 门类包     | `packages/preset/agent-preset`、`packages/skill`、`packages/mcp`、`packages/hooks`、`packages/jobs`、`packages/extensions/cordis-host-runner` 等     | 组合预设、skill、MCP、桥接、后台任务、运行时自扩展                       |

完整包名单与一行职责在上游仓库根 `AGENTS.md` 的 Repository layout 一节（本页不复制，避免腐烂）。

## 3. 启动与组合：一次运行就是一棵插件树

- **profile**：Harness home 里的具名组装，列出自己叠加的组合包、存放树外插件、保存自己的 patch。
- **组合包（bundle）**：Cordis 配置项与其挂载代码的分发格式；它插入的内容可被其上各层 patch。
- 两者都在自己的 `package.json` 里用 `dsh` 字段声明：`dsh.profile` 列出 bundle，`dsh.bundle` 指向 patch 文件。
- **层序**：先按 profile 顺序叠加各 bundle，然后是 profile 自己的 patch、home 级 patch，最后是 `--patch` overlay；
  一条 patch 按 id 定位某条目并替换其整个 config，或插入新条目。
- **共享第一层**：`packages/bundle/base` 提供模型适配器、工具、持久化、沙箱与审批策略、设置、凭据、遥测；
  `packages/boot/plugin-manager` 也由它提供。

仓外插件的挂载细节（`files`、patch 语义、失败串）见 `references/develop/mounting-and-manifest.md`；
入口与 Config 见 `references/develop/host-entry-and-di.md`。

## 4. 核心包与 `ctx` 键

| 包                            | 职责                                            | `ctx` 键           |
| ----------------------------- | ----------------------------------------------- | ------------------ |
| `packages/core/session`       | 仅追加的 `SessionEvent` 日志与内存存储          | `ctx.sessions`     |
| `packages/core/system-prompt` | 提示词片段与工具 schema 的组装                  | `ctx.systemPrompt` |
| `packages/core/tools`         | 作用域化工具注册表与带把关的执行流水线          | `ctx.tools`        |
| `packages/core/agent`         | `Agent` 接口、活跃 agent 注册表、`agent/*` 事件 | `ctx.agents`       |
| `packages/core/agent-loop`    | 实现该接口的默认驱动器                          | `ctx.agentLoop`    |
| `packages/llm/llm`            | 消息与流式词汇表、适配器 seam                   | `ctx.llm`          |

## 5. 事件：先选对域，再写代码

- **会话事件**：追加进日志并经 `session/event` 广播的持久事实。事实要跨重载存在时用它。
- **Agent 事件**（`agent/*`）：携带活跃 `Agent`（inbox、步骤、状态、请求、验证、续跑）。要观察或拦截
  进行中的工作，用它。
- **能力事件**：向某个 seam（如 `fs/*`、`tools/*`、`telemetry/*`）追加策略与适配器，不引入 import 环。

事件的生产方 / 消费方清单见 `docs/event-producer-consumer.zh.md`。

## 6. 轮次主干：一次输入怎么走到工具与渲染

一个**步骤**（step）= 一次模型请求加上它调用的工具；一个**轮次**（turn）含 0..n 个步骤，
从领取首条输入开始，到不再欠任何工作时关闭。

```text
turn/start
  claim 首条输入 + 一条排队消息
  组装提示词片段与工具 schema
  -> agent/pre-step            waterfall：改写或拒绝领取；拒绝或首次为空 ⇒ 关闭无步骤轮次
     step/start
     agent/request             waterfall：解决路由与能力
     提交 system/message 与 user/message（异步阶段取消则两者都不提交）
     从日志派生并冻结模型历史
     llm/stream                waterfall：流式请求
       agent/assistant-stream  start / chunk* / end（进程本地实时事件）
     tool/call* -> tools/pre-execute -> tools/execute -> tools/post-execute -> tool/result*
       三个 tools/* 均为 waterfall
     step/end
     还有欠账或新输入 ⇒ 下一步骤
  -> agent/turn-stopping       serial：没有 next()
turn/end
```

- `turn/*`、`step/*`、`system/message`、`user/message`、`assistant/message`、`assistant/attempt`、`tool/*`
  是**持久会话事件**；`agent/*`、`llm/*`、`agent/assistant-stream` 是**实时扩展点**。
- waterfall 监听器**必须调用 `next()`** 才会委托下去；serial 事件没有 `next()`。
- **会话日志是模型所见上下文的唯一来源**：`deriveMessages()` 从日志投影模型历史；
  「模型可见即已记录」是运行时不变式——想给模型新的可见输入，就得新增会话事件。
- 时序图与工具流水线细节：`docs/agent-lifecycle.zh.md`、`docs/tool-execution-pipeline.zh.md`。

## 7. 新行为该放哪

先决定**事件域**（会话 / Agent / 能力），再决定**归属的插件**：行为放进拥有它的插件或服务，
不要靠 façade、包装或监听顺序去「强制」；注册类贡献必须证明可回收（卸载后副作用消失）。

## 8. 源码最后手段

本页与 `references/dsh/modules/` 覆盖不到的细节，才去读源码：

- 只看一条事实：`git -C 3rdp/deepseek-harness show deepseek-harness@<tag>:<path>`（只读，不切换工作树）。
- 本页引用的每条上游路径都在 `src/facts.test.ts` 有台账条目；失效时测试按条目报出来。
