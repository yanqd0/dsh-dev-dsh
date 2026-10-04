# dsh 模块与子系统索引（占位：A/B 批已就位）

> 占位｜归属：dsh 本体｜填充：plan #16
>
> 本文是 `references/dsh/index.md` 的子页。

**事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`（本册逐页填充时按页重声明）。

本册回答：「这个模块 / 子系统是干什么的、对外暴露哪些 `ctx` 服务与事件、仓外插件什么时候会碰到它」。
「某个能力位置有没有被占」见 `references/dsh/plugins/index.md`；能力 seam 的三角色判据见
`references/dsh/extension-points.md` §2。

## 页契约

- 命名：`references/dsh/modules/<group>.md`，`<group>` 取上游 `packages/<group>` 的组名（kebab-case）；一个组需要多页、
  或两个组同属一个数据平面时用 `<group>-<语义>.md`，并在本索引逐页登记。
- 每页六段：页头块（回链 + 范围 + pin + 上游权威）→ **包 / 对外提供**表 → **seam 与独占位** → **能替换 / 不能碰** →
  **易错点** → **源码最后手段**。
- 「对外提供」表必须区分四种形态：**可挂载插件**、**抽象 Service Definition**（本身不能单独挂载，provider 才是行）、
  **纯库**（无 `ctx` 键）、**只有 `dsh.client` 半边的包**。把 Definition 当可挂载行是最常见的误判。
- 页预算 ≤140 行（软约束）；超了按子族拆页并在本索引登记。
- **不重复别页已拥有的事实**，只留一行路由：事件语义 → `references/dsh/session-log.md`；持久化与格式版本 →
  `references/dsh/persistence-and-format.md`；启动链路 → `references/dsh/composition-and-boot.md`；
  运行期插件管理 → `references/dsh/plugin-management.md`；客户端装载 → `references/dsh/client-loading.md`。
- 每页一条 provenance pin；引用上游路径必须同步登记 `src/facts.test.ts`。

## 已就位的模块页

- `references/dsh/modules/kernel.md`：`packages/core` 主干服务（agents / sessions / tools / system-prompt / scope）。
- `references/dsh/modules/model.md`：`packages/llm` 模型调用与适配器。
- `references/dsh/modules/sessions.md`：`packages/session` 持久会话数据平面四族。
- `references/dsh/modules/session-query-storage.md`：`packages/session-query` 查询 / 导出与 `packages/storage` 通用持久状态。
- `references/dsh/modules/boot-bundle.md`：`packages/boot` + `packages/bundle` + `apps/` 的启动、装配与启动器。
- `references/dsh/modules/host.md`：`packages/host` 的 HTTP 路由、目录选择 seam 与插件清单。
- `references/dsh/modules/api.md`：`packages/api` 的 Remote 声明、命名空间与转发白名单。
- `references/dsh/modules/client.md`：`packages/client` 浏览器半边（+ `packages/typert` 类型面）。

## 覆盖表（逐批推进）

状态含义：**已就位**＝本册有页可按；**A/B 批**＝本 plan 交付并按页登记；**C–E 批**＝已排期、尚无页（不要按图索骥）。

| 上游 group                                                                                                                                                                                                     | 页                                                | 状态        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------- |
| `core`                                                                                                                                                                                                         | `references/dsh/modules/kernel.md`                | 已就位（A） |
| `llm`                                                                                                                                                                                                          | `references/dsh/modules/model.md`                 | 已就位（A） |
| `session`                                                                                                                                                                                                      | `references/dsh/modules/sessions.md`              | 已就位（A） |
| `session-query` + `storage`                                                                                                                                                                                    | `references/dsh/modules/session-query-storage.md` | 已就位（A） |
| `boot` + `bundle` + `apps`                                                                                                                                                                                     | `references/dsh/modules/boot-bundle.md`           | 已就位（B） |
| `host`                                                                                                                                                                                                         | `references/dsh/modules/host.md`                  | 已就位（B） |
| `api`                                                                                                                                                                                                          | `references/dsh/modules/api.md`                   | 已就位（B） |
| `client`（+ `typert`）                                                                                                                                                                                         | `references/dsh/modules/client.md`                | 已就位（B） |
| `fs` `shell` `sandbox` `subprocess` `ssh` `terminal` `ptc-runtime` `mcp` `skill` `attachment` `spill` `lsp` `document` `web`                                                                                   | C 批                                              | 待建        |
| `todo` `plan` `goal` `schedule` `subagent` `jobs` `workflow` `preset` `compaction` `context` `interaction` `feedback` `hooks` `webhook` `guard` `identity` `settings` `credentials` `telemetry` `deliverables` | D 批                                              | 待建        |
| `util` `brand` `runtime-diagnostics` `test-support`                                                                                                                                                            | E 批（按需）                                      | 待建        |
| `experimental/*`                                                                                                                                                                                               | 按需（预稳定原型）                                | 待建        |

## 与其它页的分工

- 层的划分与依赖方向：`references/dsh/architecture.md`（组清单不在这里复制）。
- 逐组外部契约：本册。
- 跨组的委派与并行机制（`subagent` + `workflow` + loop 调度）：`references/dsh/delegation-and-parallelism.md`；
  子级与用户决策（plan mode 边界、咨询循环）：`references/dsh/delegation-and-user-decisions.md`
  ——D 批的 `subagent` / `workflow` 模块页只补各组自己的对外契约，机制不在本册重写。
- 能力位置是否被占、冲突语义：`references/dsh/plugins/index.md`。
- 新行为该放哪（判据）：`references/dsh/extension-points.md` §1 与 §4。

## 上游对照

- 组索引与一行职责：`packages/README.md`（中文对侧 `packages/README.zh.md`）；逐组 `packages/<group>/README.zh.md`。
- 生成清单（不要手抄，只路由）：seam 三角色表 `docs/capability-seams.zh.md`；工具 schema `docs/tool-catalog.zh.md`；
  Config schema `docs/config-catalog.md`；可载入插件清单（在 `packages/preset/agent-preset/skills/cordis-composition-reference/` 目录里，
  文件名是 `packages.md`）；客户端 slot 座位表
  `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`；包依赖图 `docs/module-graph.zh.md`。
