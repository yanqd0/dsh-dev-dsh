# 模块：session-query / storage（查询与通用持久状态）

> 本文是 `references/dsh/modules/index.md` 的子页；索引与页契约见该页。
>
> **范围**：`packages/session-query`（会话语料查询、全文索引、导出）与 `packages/storage`（通用 KV 后端与域形式）。
> 会话日志与持久化本身见 `references/dsh/session-log.md` 与 `references/dsh/persistence-and-format.md`。
> **事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`。字段与错误码清单以子系统页与包 README 为准。
> 上游权威：`packages/session-query/README.zh.md`、`docs/subsystems/session-query.zh.md`、`docs/tool-catalog.zh.md`（五个工具 schema，生成）、
> `packages/storage/README.zh.md`、`docs/subsystems/storage.zh.md`、`docs/subsystems/workspace.zh.md`（域形式的首个消费方）。

## 1. 包 / 对外提供

| 包                                   | 对外提供                                                          | 形态                           | Config      | 说明                                                         |
| ------------------------------------ | ----------------------------------------------------------------- | ------------------------------ | ----------- | ------------------------------------------------------------ |
| `session-query/session-query`        | `ctx.sessionQuery`                                                | **抽象 Definition**            | 构造 Config | 精确读取、过滤、关系追踪与语料观测已实现；全文搜索是抽象方法 |
| `session-query/session-query-sqlite` | 注册到 `ctx.sessionQuery`                                         | 插件                           | 有          | SQLite FTS5 索引生命周期、排序、游标                         |
| `session-query/session-log-export`   | host：`/export` 命令 + ZIP 路由；浏览器：`ctx.sessionLogDownload` | 插件（**host + client 双半**） | 有          | ZIP 里是规范 JSONL + 附件；浏览器半由 `dsh.client` 声明      |
| `session-query/tool-session-query`   | 注册到 `ctx.tools`                                                | 插件                           | 有          | 五个经工作区授权的模型工具                                   |
| `storage/storage`                    | `ctx.storage`                                                     | 插件                           | 无          | 命名后端注册表 + 已挂载的数据形式；**枢纽本身不做 IO**       |
| `storage/storage-json`               | 注册后端 `json`                                                   | 插件                           | 有          | 文件树后端（人类可读）                                       |
| `storage/storage-sqlite`             | 注册后端 `sqlite`                                                 | 插件                           | 有          | 单库后端（定点更新）                                         |
| `storage/storage-domain`             | `ctx.storageDomain`（并合并 `ctx.storage.domain`）                | 插件                           | 有          | schema 校验 + 变更通知的类型化 KV 域                         |

## 2. seam 与独占位

- **`ctx.sessionQuery` 的定义包自己注册服务、自己实现读取**；只有 `searchSessions` / `searchEvents` 是抽象的。
  换后端＝写一个 `extends SessionQueryEngine` 的 provider（`session-query-sqlite` 就是这么做的），
  并**用 `static override inject = ['sessions']`**。
- **`ctx.storage` 是后端注册表**：后端按名字唯一（`json` / `sqlite`）；域形式是 `ctx.storage` 上可合并扩展的一张表
  （`StorageForms`），同时以 `ctx.storageDomain` 暴露。
- **后端注册与消费的生命周期键**：`storage.backend.<name>` 是给域形式提供方注入用的生命周期键，
  目的是激活不早于后端注册；调用方仍经注册表解析。
- **五个模型工具名固定**：`session_search`、`session_event_search`、`session_trace`、`session_event_trace`、
  `session_event_read`（schema 见生成的 `docs/tool-catalog.zh.md`）。

## 3. 能替换 / 不能碰

- **能替换**：会话查询后端（实现抽象引擎）；storage 后端（`json` / `sqlite` 或自己的）；
  用 `defineDomain` 声明自己的域。
- **不能碰**：`session-log-export` 的 ZIP 结构与路由形状（导出格式是跨实现约定：规范 JSONL + 附件，不看后端）；
  `ctx.sessionQuery` 的过滤语义（provider 无关层已实现，提供方只负责搜索）；
  SQLite 索引是**可重建的派生数据**，不要当权威。
- **`ctx.storage` 不是会话存储**：它按 `(unit, key)` 存文档；会话历史走 `ctx.sessionPersistence`。二者不要混。

## 4. 易错点

- **冷读不回写**：查询侧的冷读在内存里配平被中断的轮次，磁盘不动；需要写修复的场景只有 resume（见持久化页 §4）。
- **冷读缓存按 `(服务实例 identity, stat revision)` 键控**：revision 变了必须重读，别按 id 缓存。
- **SQLite 索引不兼容时原地重置**（派生数据）；这与 `storage-sqlite` 对不兼容 schema **直接拒绝**的策略相反——两者不要互相类推。
- **`openAt: 'never'` 会关掉全文搜索**：精确读取 / 过滤 / 追踪仍可用，搜索报 `SESSION_QUERY_SEARCH_DISABLED`，且不会 import SQLite。
- **导出路由需要三个服务**：缺少 sessionQuery / sessionPersistence / attachments 时返回 HTTP 500；导出前会先 flush 活会话。
- **`storage-domain` 的 `Config.backend` 必填**（没有普适介质）；域名单句柄，第二次 `open` 拒绝；
  单元 / 表名必须匹配 `UNIT_NAME_RE`（小写 + 下划线）；`domain/changed` 只带新快照、在持久化之后发出。

## 5. 源码最后手段

- 只看一条事实：`git -C 3rdp/deepseek-harness show deepseek-harness@dsh-v0.2.0-rc.2:<path>`（只读，不切换工作树）。
- 本页引用的每条上游路径都在 `src/facts.test.ts` 有台账条目；失效时测试按条目报出来。
