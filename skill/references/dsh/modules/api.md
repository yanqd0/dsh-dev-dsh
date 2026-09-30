# 模块：api（Client ↔ Host 的 Remote 层）

> 本文是 `references/dsh/modules/index.md` 的子页；索引与页契约见该页。
> **范围**：`packages/api` 对外给什么——Remote 服务怎么声明、wire 命名空间怎么定、转发事件白名单、哪些装配清单不能扩展。
> 类型面构建在 `packages/typert`（见 `references/dsh/modules/client.md` §4）；浏览器半边见同一页。
> **事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`。装饰器与查找规则以权威页与 cookbook 为准。
> 上游权威：`packages/api/README.zh.md`（组内一行职责）、`docs/api-gateway.zh.md`（Remote 模型权威）、
> `docs/subsystems/typert.zh.md`（协议与注册表契约）、`docs/cookbook/adding-a-remote-api.zh.md`（新增 Remote 的步骤化实操）。

## 1. 包 / 对外提供

| 包                         | 对外提供                                              | 形态         | Config | 说明                                     |
| -------------------------- | ----------------------------------------------------- | ------------ | ------ | ---------------------------------------- |
| `api/gateway`              | host `ctx.typertGateway`；客户端 `ctx.remote`         | 插件（双半） | 有     | Remote 方法调用的承载与分发              |
| `api/remotes`              | 无自己的键（装配 host 转发循环与客户端命名空间表）    | 插件（双半） | 无     | 决定暴露哪些能力、转发哪些事件           |
| `api/session-controller`   | `ctx.sessionController` 等（命名空间 `session`）      | 插件（双半） | 有     | 会话命令、冷读与实时控制传输             |
| `api/job-controller`       | `ctx.jobController`（命名空间 `job`）                 | 插件（双半） | 有     | 任务观察流与引用计数的客户端任务输出服务 |
| `api/workspace-controller` | `ctx.workspaceController`（命名空间 `workspace`）     | 插件（双半） | 有     | workspace 变更与完整客户端投影           |
| `api/terminal-controller`  | `ctx.terminalController`（命名空间 `terminal`）       | 插件（双半） | 有     | 会话拥有的交互式终端、屏幕恢复           |
| `api/settings-controller`  | `ctx.settingsController`、`ctx.credentialsController` | 插件         | 无     | 配置与凭据面的 Remote 拥有者             |
| `api/workspace-files`      | `ctx.workspaceFiles`（命名空间同名）                  | 插件（双半） | 有     | 有界文件读取 / 列目录 / 元数据服务       |
| `api/account-controller`   | `ctx.accountController`（命名空间 `account`）         | 插件         | 无     | 已鉴权的账号操作                         |

## 2. Remote 的声明与命名

- **一个 `TypertRemoteService` 的构造绑定两面**：`super(ctx, serviceKey, { namespace? })` 同时给出 `ctx.<serviceKey>`
  与 wire 命名空间（默认等于 `serviceKey`）。所以命名空间不是单独登记的。
- **只有 `@Remote` / `@RemoteScope` 注解的方法**进入生成的客户端类型与运行时的 `ctx.remote`；
  `@Remote({ mode: 'stream' })` 用来标记逻辑流。
- **命名段校验**：允许 `[A-Za-z0-9_$.-]`，并拒绝 `.` / `..` 这类段。
- **宿主对象参数只能是顶层参数**：`Agent` / `Session` 这类要在 `TypertLookupMap` 里声明并注册运行时解析器，
  线上字段会改名（如 `agent` → `agentId`）。
- **转发事件来自白名单**：`ctx.remote.$on` 的键只来自 `packages/api/remotes/src/remote-events.ts` 的
  `API_REMOTE_FORWARDED_EVENTS`（`{ event, mode }` 行）；**没登记的宿主事件不会被转发**。

## 3. 能替换 / 不能碰

- **能替换 / 扩展**：在自己的包里写 `TypertRemoteService` 子类并加 `@Remote` 方法（官方 cookbook 的 5 步）；
  在自己的 tsdown 配置里跑 Typert 构建插件。
- **不能碰**：`api/gateway` 的 `/api` 契约与分发；`remote-events.ts` 作为唯一的转发白名单归属；
  `packages/api/remotes/src/client/index.ts` 的客户端命名空间装配——它是一份**硬编码的导入 + 数组**，
  仓外新增命名空间不能只靠自己声明就出现在客户端，需要上游扩这份清单或自建等价装配。

## 4. 易错点

- **服务键与命名空间不同不是错误**：`namespace` 只是可选的 wire 名；但客户端要按命名空间调用。
- **没进白名单的事件在浏览器里永远收不到**：调试"事件没到前端"先看这份清单。
- **双半包要同时声明 `dsh.client`**：只挂 host 半边不会给客户端任何键（见客户端页 §1）。
- **config 与 Remote 是两件事**：Remote 方法的入参 schema 由类型生成，不走插件的 `Config`。

## 5. 源码最后手段

- 只看一条事实：`git -C 3rdp/deepseek-harness show deepseek-harness@dsh-v0.2.0-rc.2:<path>`（只读，不切换工作树）。
- 本页引用的每条上游路径都在 `src/facts.test.ts` 有台账条目；失效时测试按条目报出来。
