# 内置 plugin 索引：位置分类与冲突语义（占位：位置机制已就位）

> 占位｜归属：dsh 本体｜填充：plan #16
>
> 本文是 `references/dsh/index.md` 的子页。

**事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`（逐页填充时按页重声明）。

本页回答两件事：**能挂在哪里**、**挂上去会不会撞车**。逐模块的 `ctx` 契约见 `references/dsh/modules/index.md`；
事件域判据见 `references/dsh/extension-points.md`。

## 1. 位置分类

| 位置          | 挂载方式                                                                                           | 撞车时                                                                  | 权威                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 挂载行        | profile 的 `dsh.profile.bundles`；bundle 的 `dsh.bundle.patch`；patch 条目 `insert` / 按 `id` 覆盖 | 同 `id` 由后面的层整体替换（不合并）；条目挂载身份冲突由 Loader 处理    | 清单字段 `packages/util/package-manifest/src/types.ts`；语义 `vendor/include/src/index.ts` |
| 事件          | `declare module '@deepseek-ai/cordis'` 合并 `Events`，带 `@mode`                                   | 同事件多监听者按 mode 组合（`waterfall` 必须 `next()`）                 | `docs/user/develop/framework/events.zh.md`                                                 |
| 能力 seam     | 注册在既有 `ctx.<key>` 上（适配器 / provider / 后端）                                              | 单例注册表重复注册直接抛错；按 key 注册的表同名即抛错                   | 逐 seam：`references/dsh/modules/index.md`；全景 `docs/capability-seams.zh.md`             |
| 模型可见位    | `ctx.tools` 注册工具；`ctx.commands` 注册命令；技能目录 `SKILL.md`                                 | **按 scope 同名即抛错**（见 §2）；命令同名同样抛错                      | `docs/tool-catalog.zh.md`（生成）；命令语义 `packages/interaction/commands`                |
| 持久化位      | 合并 `SessionEventMap` 新增会话事件类型                                                            | 新增类型默认 required-on-read：老构建读到必须拒绝整份日志               | `references/dsh/session-log.md` §6；`docs/persistence-catalog.zh.md`（生成）               |
| 客户端位      | `package.json` 的 `dsh.client` + `exports["./client"]`；slot 注册                                  | slot 一个 declarer；同 id 同 priority 第二次注册抛错                    | `references/dsh/client-loading.md`；`packages/client/ui-slots/src/index.ts`                |
| HTTP / Remote | `ctx.webServer` 注册路由（exact / prefix）或 index 注入；Typert `@Remote` 方法                     | 路由精确/前缀匹配、同路径冲突由注册顺序决定；唯一 fallback 座位只能一个 | `docs/subsystems/web-server.zh.md`；`docs/api-gateway.zh.md`                               |
| 状态位        | settings / credentials 键；`ctx.storage` 域                                                        | 键名冲突按各注册表规则；域名单句柄                                      | `docs/subsystems/settings.zh.md`；`references/dsh/modules/` 下的 storage 页                |

## 2. 冲突语义速查（实现里已验证的错误串）

| 位置                    | 语义                                                              | 触发后的表现                                                                                                            |
| ----------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `ctx.tools` 工具名      | 一个 scope 内名字唯一（子 agent 用 `agent.ctx` 注册局部变体）     | `tool "…" is already registered in this scope`（`packages/core/tools/src/index.ts`）                                    |
| `ctx.tools.presentAs()` | 一个 scope 只能声明一种展示（`native` / `ptc` / `both`）          | 第二次声明抛「conflicts with … already declared for this scope」                                                        |
| `ctx.commands` 命令名   | 一个 scope 内名字唯一                                             | `command "…" is already registered in this scope`（`packages/interaction/commands/src/index.ts`）                       |
| `ctx.llm` 模型适配器    | 按 provider 唯一，**不是**单一 provider                           | `LlmError('DUPLICATE_ADAPTER')`（`packages/llm/llm/src/index.ts`）                                                      |
| `ctx.sessionTitle`      | 同时只允许一个提供方；没有则保留确定性回退                        | `session-title provider "…" is already registered`（`packages/session/session-title/src/index.ts`）                     |
| `ctx.permissionPresets` | `auto` preset 单例                                                | `permission: preset "auto" is already registered`（`packages/interaction/permission-presets/src/index.ts`）             |
| 客户端 slot             | 一个 slot 一个 declarer；同 id 同 priority 只允许一次             | `slot "…" is already declared` / `slot factory "…" already has a definition`（`packages/client/ui-slots/src/index.ts`） |
| 挂载行覆盖              | patch 命中同 `id` 时**整份替换 `config`**；命中失败只 warn 不报错 | `vendor/include/src/index.ts`（层序见 `references/dsh/composition-and-boot.md`）                                        |

## 3. 已占清单在哪里（不要手抄）

| 想知道什么                         | 读哪里                                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 哪些能力位置已被占、谁提供、谁消费 | `docs/capability-seams.zh.md`（生成；provider/consumer 是 curated 列表，可能漏记，写页时用源码 grep 补）                |
| 哪些工具名已存在、需要什么         | `docs/tool-catalog.zh.md`（生成；按工具包 → 模型可见名 → 依赖 → 写入的事件）                                            |
| 某个插件包的全部 Config 字段       | `docs/config-catalog.md`（生成；按包名索引）                                                                            |
| 哪些包可以作为挂载行               | 生成的插件包清单：在 `packages/preset/agent-preset/skills/cordis-composition-reference/` 目录里，文件名是 `packages.md` |
| 客户端有哪些 slot、座位被谁占了    | `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`（生成）+ `docs/subsystems/slots.zh.md`            |
| 新增会话事件类型要怎么声明         | `references/dsh/session-log.md` §6                                                                                      |

## 4. 逐模块的已占情况

`references/dsh/modules/` 逐组页列出该组的 `ctx` 键、seam 与"能替换 / 不能碰"。**本页不重复它们**；
A/B 批（`core`、`llm`、`session`、`session-query`、`storage`、`boot`+`bundle`+`apps`、`host`、`api`、`client`）
已有页，其余批次的进度见 `references/dsh/modules/index.md` 的覆盖表。

## 5. 源码最后手段

- 只看一条事实：`git -C 3rdp/deepseek-harness show deepseek-harness@dsh-v0.2.0-rc.2:<path>`（只读，不切换工作树）。
- 本页引用的每条上游路径都在 `src/facts.test.ts` 有台账条目；失效时测试按条目报出来。
