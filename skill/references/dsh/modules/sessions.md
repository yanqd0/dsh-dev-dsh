# 模块：session（持久会话数据平面）

> 本文是 `references/dsh/modules/index.md` 的子页；索引与页契约见该页。
>
> **范围**：`packages/session` 这一组对外给什么——持久化、投影、标题、遥测四族的 `ctx` 键与独占位。
> 日志本身与持久化语义已分别有页：事件词汇 / surface / `deriveMessages()` 见 `references/dsh/session-log.md`；
> 句柄、flush 屏障、崩溃恢复、格式版本见 `references/dsh/persistence-and-format.md`。本页只写"组内有哪些包、谁占哪个键"。
> **事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`。逐字段契约以包 README 与子系统页为准。
> 上游权威：`packages/session/README.zh.md`（四族与 ctx 键表）、`docs/subsystems/persistence.zh.md`、
> `docs/subsystems/session-projection.zh.md`、`docs/subsystems/session-title.zh.md`、`docs/subsystems/session-telemetry.zh.md`、
> `docs/subsystems/session.zh.md`。

## 1. 包 / 对外提供

| 包                                       | 对外提供                        | 形态                | Config | 说明                                                             |
| ---------------------------------------- | ------------------------------- | ------------------- | ------ | ---------------------------------------------------------------- |
| `session/session-checkpoint-policy`      | 无 `ctx` 键（只注册监听）       | 插件                | 无     | 在模型请求 / 顶层工具体 / 下一步前插持久化屏障，失败 fail-closed |
| `session/session-persistence`            | `ctx.sessionPersistence`        | **抽象 Definition** | 无     | 句柄式仅追加存储的服务定义；**本身不单独挂载**                   |
| `session/session-persistence-jsonl`      | 注册到 `ctx.sessionPersistence` | 插件                | 有     | 随产品交付的后端（generation 文件、可选 zstd）                   |
| `session/session-projection`             | `ctx.sessionProjections`        | 插件                | 无     | 投影注册表 + 驱动；同包既是定义也是唯一 provider                 |
| `session/session-projection-cache`       | `ctx.sessionProjectionCache`    | 插件                | 有     | 投影检查点的持久缓存（`session_projcache` 域）                   |
| `session/session-stats`                  | 注册 `sessionStats` 单元        | 插件                | 无     | 整日志计数与墙钟时间；另有 type-only `./client`                  |
| `session/session-turn-outline`           | 注册 `turnOutline` 单元         | 插件                | 无     | 轮次大纲；另有 type-only `./client`                              |
| `session/session-title`                  | `ctx.sessionTitle`              | 插件                | 有     | 日志支撑的标题 + 确定性回退；**同时只允许一个提供方**            |
| `session/session-title-llm`              | 无（共享策略库）                | 纯库                | —      | 模型生成标题的策略与 `registerSessionTitleLlmProvider`           |
| `session/session-title-first-prompt-llm` | 注册到 `ctx.sessionTitle`       | 插件                | 有     | 用第一条合格人类消息起标题                                       |
| `session/session-title-all-prompts-llm`  | 注册到 `ctx.sessionTitle`       | 插件                | 有     | 用全部合格人类消息起标题                                         |
| `session/session-telemetry`              | `ctx.sessionTelemetry`          | **抽象 Definition** | 无     | 采集 / 脱敏 / 交接的抽象契约；**本身不单独挂载**                 |
| `session/session-telemetry-otel`         | 注册到 `ctx.sessionTelemetry`   | 插件                | 有     | OTel 交付（`FEEDBACK_ONLY` / `DISABLED`），需要 `ctx.otel`       |
| `session/session-format*`（6 个包）      | 无（构建期库）                  | **纯库**            | —      | 编解码器、相邻迁移边与生成目录；由持久化读取方导入               |
| `session/session-log-deepseek`           | 无 `ctx` 键（贡献请求元数据）   | 插件                | 有     | 把增量规范日志作为官方 DeepSeek 请求元数据上送                   |

## 2. seam 与独占位

| `ctx` 键                     | 定义包                     | provider                                          | 说明                                                            |
| ---------------------------- | -------------------------- | ------------------------------------------------- | --------------------------------------------------------------- |
| `ctx.sessionPersistence`     | `session-persistence`      | `session-persistence-jsonl`（**唯一随产品交付**） | 换后端＝换 provider；抽象面只有 `create/open/flush/stat/list`   |
| `ctx.sessionProjections`     | `session-projection`       | 同包（注册表即提供方）                            | 域插件注册**单元**（如 `sessionStats`、`turnOutline`、`title`） |
| `ctx.sessionProjectionCache` | `session-projection-cache` | 同包                                              | 消费方用 `ctx.get('sessionProjectionCache')` **可选**读取       |
| `ctx.sessionTitle`           | `session-title`            | 两个 `*-llm` 提供方（**同时只允许一个**）         | 没有提供方时保留确定性回退；`register()` 重复即抛错             |
| `ctx.sessionTelemetry`       | `session-telemetry`        | `session-telemetry-otel`（唯一）                  | 采集是瀑布事件，交付是后端契约；进程内无消费者                  |

## 3. 能替换 / 不能碰

- **能替换**：持久化后端（实现 `SessionPersistence` + 自己的 `SessionHandle`）；
  投影单元（声明合并 `SessionProjectionMap`，注册纯同步 `apply`）；标题提供方；遥测后端。
- **不能碰**：`session-persistence-jsonl` 的 generation 命名与排他发布规则、session 格式版本与相邻迁移链
  （见 `references/dsh/persistence-and-format.md` §5–§6）；投影检查点的域版本属于格式轴，不能拿来当会话格式版本用。
- **`session-format*` 是构建期库**：它们不是可挂载插件行，`dsh.sessionFormatMigration` 清单由生成器读取。

## 4. 易错点

- **后端必须自己订阅 `session/flush`**：否则 `ctx.sessions.flush()` 报"无参与者"，看起来什么都没提交。
- **抽象 Definition 不能当挂载行**：`session-persistence`、`session-telemetry`、`session-query` 都要有 provider 才能工作。
- **投影 `apply` 必须同步且返回同一引用表示"不关心"**；状态必须是纯 JSON，否则持久缓存不成立。
- **同一投影键注册 N 次共享一个单元**（按引用计数，直到最后一个卸载）；注册是 effect，卸载后键消失。
- **标题提供方只有一个**：两个 `*-llm` 包同时挂载会让第二个注册抛 `session-title provider "…" is already registered`。
- **遥测默认不自动上报**：`session-telemetry-otel` 需要 `ctx.otel`，且除 `DISABLED` 外必须给 `exporter.url`。
- **`session-projection-cache` 的三个检查点（创建 / `turn/end` / 释放）是策略不是可调参数**：`Config` 只暴露节流两项。

## 5. 源码最后手段

- 只看一条事实：`git -C 3rdp/deepseek-harness show deepseek-harness@dsh-v0.2.0-rc.2:<path>`（只读，不切换工作树）。
- 本页引用的每条上游路径都在 `src/facts.test.ts` 有台账条目；失效时测试按条目报出来。
