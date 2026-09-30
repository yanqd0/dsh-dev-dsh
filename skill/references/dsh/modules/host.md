# 模块：host（Web 宿主：HTTP、目录选择、清单）

> 本文是 `references/dsh/modules/index.md` 的子页；索引与页契约见该页。
>
> **范围**：`packages/host` 对外给什么——HTTP 服务器与路由注册、目录选择 seam、只读插件清单、产品遥测上报。
> 浏览器那一半见 `references/dsh/modules/client.md`；启动链路见 `references/dsh/composition-and-boot.md`。
> **事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`。路由与 Config 字段清单以子系统页与包 README 为准。
> 上游权威：`packages/host/README.zh.md`、`docs/subsystems/web-server.zh.md`（路由、匹配顺序与配置）、
> `docs/subsystems/workspace.zh.md`（选择器产出的记录）、`docs/subsystems/product-telemetry.zh.md`（事件与交付上限）。

## 1. 包 / 对外提供

| 包                             | 对外提供                     | 形态                | Config | 说明                                                        |
| ------------------------------ | ---------------------------- | ------------------- | ------ | ----------------------------------------------------------- |
| `host/webserver`               | `ctx.webServer`              | 插件                | 有     | node:http 路由注册表、index 注入、唯一 fallback 座位        |
| `host/frontend-static`         | 无（消费 `ctx.webServer`）   | 插件                | 有     | 服务已构建的 Web 壳，占着 fallback 座位（`distIndex` 必填） |
| `host/directory-picker`        | `ctx.directoryPicker`        | **抽象 Definition** | 无     | 目录选择 seam 与错误词汇；**本身不单独挂载**                |
| `host/directory-picker-native` | 注册到 `ctx.directoryPicker` | 插件                | 无     | 原生系统选择器后端                                          |
| `host/directory-picker-browse` | 注册到 `ctx.directoryPicker` | 插件                | 有     | 应用内浏览后端（列目录 + 建目录），也服务远端               |
| `host/directory-picker-auto`   | 无（启动时按环境挂一个后端） | 插件                | 无     | 解析宿主情况后挂 backend                                    |
| `host/open-in-app`             | 无（注册 3 条路由）          | 插件                | 有     | 应用目录、图标与启动路由                                    |
| `host/plugin-inventory`        | `ctx.pluginInventory`        | 插件                | 无     | Loader 条目状态的只读 Remote 投影（`@Remote('list')`）      |
| `host/product-telemetry-otel`  | `ctx.productTelemetry`       | 插件                | 有     | 显式产品事件上报（OTLP/HTTP logs）；**只提交，不自动采集**  |

## 2. 独占位与注册面

- **`ctx.webServer` 是路由注册面**：路由分 `exact` 与 `prefix` 两种（`prefix` 匹配自身与 `自身/<任意>`，不允许尾斜杠）；
  整个进程只有**一个 fallback 座位**（`frontend-static` 占着）。插件挂新路由就在这里注册，注册是 effect。
- **index 注入有两条通道**：类型化的 `IndexInjection` 行经 `webserver/index-inject` 事件收集（global / script /
  script-src / script-preload / style / html），以及原始的 `tapIndex(html => html)` 钩子——**taps 在行渲染之后跑**。
- **目录选择是唯一显式可替换的 host seam**：`ctx.directoryPicker` 是抽象定义，原生 / 浏览两个后端互相可换，
  `directory-picker-auto` 负责在启动时挑一个。**同时只挂一个后端**。
- **index 响应先过 Connection 的浏览器鉴权**；非 index 的静态资源保持公开。

## 3. 能替换 / 不能碰

- **能替换**：目录选择后端（实现 `DirectoryPicker`）；给 `ctx.webServer` 加路由 / index 注入；
  消费 `ctx.pluginInventory` 与 `ctx.webServer` 做自己的宿主功能。
- **不能碰**：`host/frontend-static`（占 fallback 座位，替换它等于换掉整个前端分发）、`host/plugin-inventory`
  （固定 Remote 面）、`host/product-telemetry-otel`（固定收集器契约）。
- **`distIndex` 是组合应用的 workspace 知识**：通常由 patch 里的 `!!js` 表达式提供，不要在包里写死。

## 4. 易错点

- **`registerFallback` 只有一个座位**：第二个注册会失败；想接管前端分发要替换 `frontend-static` 这一行。
- **prefix 路由不允许尾斜杠**：写成 `/api/` 会匹配不到预期的路径。
- **`tapIndex` 的顺序**：它在类型化注入之后执行，想覆盖别行的输出要用它；想追加行则用 `index-inject`。
- **产品遥测挂上不等于上报**：`ctx.productTelemetry` 只有被显式提交才发事件。
- **远端客户端也走 `directory-picker-browse`**：原生后端在纯远端场景不可用，`auto` 会据此选择。

## 5. 源码最后手段

- 只看一条事实：`git -C 3rdp/deepseek-harness show deepseek-harness@dsh-v0.2.0-rc.2:<path>`（只读，不切换工作树）。
- 本页引用的每条上游路径都在 `src/facts.test.ts` 有台账条目；失效时测试按条目报出来。
