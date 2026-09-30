# 模块：llm（模型调用与适配器）

> 本文是 `references/dsh/modules/index.md` 的子页；索引与页契约见该页。
>
> **范围**：`packages/llm` 这一组对外给什么——调用服务、适配器约定、提供方无关的消息与流式词汇、重试与计量。
> 单个提供方的配置细节在其包 README；请求信封与会话日志的关系见 `references/dsh/session-log.md`。
> **事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`。适配器字段清单以包 README 与生成目录为准。
> 上游权威：`packages/llm/README.zh.md`（组内一行职责）、`docs/subsystems/llm-streaming.zh.md`（消息 / 内容块 / 分片 / 失败词汇）、
> `docs/user/develop/practice/llm-adapter.zh.md`（写一个适配器的官方实操）、`docs/subsystems/core.zh.md`（轮次如何调用）。

## 1. 包 / 对外提供

| 包                                      | 对外提供                       | 形态 | Config | 说明                                                         |
| --------------------------------------- | ------------------------------ | ---- | ------ | ------------------------------------------------------------ |
| `llm/llm`                               | `ctx.llm`                      | 插件 | 有     | 提供方无关的调用服务 + 全 harness 共用的消息 / 块 / 分片词汇 |
| `llm/llm-deepseek`                      | 无 `ctx` 键                    | 纯库 | —      | DeepSeek Messages 协议、请求配置与模型能力                   |
| `llm/llm-deepseek-api-key`              | 注册到 `ctx.llm`               | 插件 | 有     | API key 鉴权 + official 模型发现                             |
| `llm/llm-deepseek-account`              | 注册到 `ctx.llm`               | 插件 | 有     | 账号 token 鉴权、失效处理与模型发现                          |
| `llm/llm-pi-ai`                         | 注册到 `ctx.llm`               | 插件 | 有     | 通过 pi-ai 目录服务的提供方路由（含手工声明的网关）          |
| `llm/deepseek-llm-api-extensions`       | `ctx.deepseekLlmApiExtensions` | 插件 | 有     | 在官方 DeepSeek 请求上注册**有生命周期归属**的顶层字段       |
| `llm/plugin-package-inventory-deepseek` | 贡献 `dsh_plugin_packages`     | 插件 | 有     | 把当前启用的 Loader 包清单塞进官方请求                       |
| `llm/llm-retry`                         | 监听 `agent/request-error`     | 插件 | 有     | 在**持久化的步骤边界**上按提供方策略重试失败请求             |
| `llm/token-meter`                       | `ctx.tokenMeter`               | 插件 | 有     | 用固定启发式从持久日志测量请求与上下文压力                   |

## 2. seam 与独占位

- **`ctx.llm` 是适配器注册表，不是单一 provider**：一个部署可以同时挂 DeepSeek 与 pi-ai 路由；
  适配器按 `provider` id 唯一，重复注册抛 `LlmError(..., 'DUPLICATE_ADAPTER')`（`packages/llm/llm/src/index.ts`）。
- **模型发现（discovery）也按 settings 命名空间独占**：重复注册抛 `DUPLICATE_DISCOVERY`；
  同一个 `settingsNs` 只能有一个发现实现。
- **路由元数据单独记录**：某次请求解析到的 provider / model / 上下文窗口 / 提示词更新模式写入会话的 `request/context` 事件
  （不是请求信封的一部分），见 `references/dsh/session-log.md` §2。
- **请求信封**：调用配置 + 适配器默认值 + 组装好的工具 schema 写入 `request/header` 事件；
  它就是"每个请求都是日志的纯函数"的落地方式。

## 3. 能替换 / 不能碰

- **能替换**：新增提供方（在自己的包里注册适配器与可选发现）；替换重试策略（`llm-retry` 是插件行）；
  替换 token 计量（`ctx.tokenMeter`）。
- **不能碰**：`llm/llm` 的消息 / 内容块 / 分片词汇——**它是全 harness 与全部会话事件共用的类型**，
  改它就是磁盘格式变更（见 `references/dsh/persistence-and-format.md` §5）。
- **官方 DeepSeek 专属字段**走 `ctx.deepseekLlmApiExtensions`，不要往通用适配器里塞提供方私有字段。

## 4. 易错点

- **适配器 id 冲突是加载期错误**：两个包声明同一个 `provider` 会让后一个注册抛错，整个插件激活失败。
- **发现与调用是两回事**：有适配器不等于模型列表可见；模型列表来自 discovery 或静态声明。
- **`llm-retry` 重试发生在持久化步骤边界**：它不是在 HTTP 层盲目重试，重试的证据会留在日志里。
- **`token-meter` 读日志、不看进程内计数**：它测量的是持久历史，因此回放与压缩后的数值与实时观感可能不同。
- **流式分片是瞬态**：`agent/assistant-stream` 之类实时帧不持久；持久的是 `assistant/message` / `assistant/attempt`
  携带的紧凑 stream 记录（见 `references/dsh/session-log.md` §2）。
- 模型适配器的官方实操与字段约定：`docs/user/develop/practice/llm-adapter.zh.md`；分片与失败词汇：
  `docs/subsystems/llm-streaming.zh.md`。

## 5. 源码最后手段

- 只看一条事实：`git -C 3rdp/deepseek-harness show deepseek-harness@dsh-v0.2.0-rc.2:<path>`（只读，不切换工作树）。
- 本页引用的每条上游路径都在 `src/facts.test.ts` 有台账条目；失效时测试按条目报出来。
