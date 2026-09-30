# 客户端装载：从声明到浏览器插件树

> 本文是 `references/dsh/index.md` 的子页。
>
> **范围**：客户端插件怎么被声明、宿主怎么把已启用条目组合成启动图并下发 bundle、浏览器怎么两阶段启动它。
> 宿主侧的启动链路见 `references/dsh/composition-and-boot.md`。
> **事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`。本页写装载机制，不写构建配方。
> 上游权威：`packages/client/modules/README.zh.md`（模块系统）、`packages/client/web/README.zh.md`（启动内核）、
> `docs/subsystems/client-modules.zh.md`、`docs/subsystems/web-client.zh.md`。

## 1. 声明面：`dsh.client`

浏览器插件包在自己的 `package.json` 里声明 `dsh.client`：

- `platform: 'web'` 恒有；声明必须配一个 `./client` 导出（没有该导出时扫描直接抛错）。
- `external` 只添加**基线之外**的精确模块请求；基座（React、Cordis、静态 UI 库）对每个动态 bundle 都是隐式的，
  不要在清单里重复声明。
- `immediately: true` 只给「必须在 shell 起来之前就到位」的基础设施行，用于模块阶段的预取层级。
- `inject` 只列出包名依赖边，是**信息性**的（预检展示、HMR diff）：它既不排序激活，也不决定 apply 顺序；
  激活顺序由 Cordis 服务注入决定。

## 2. 宿主侧：扫描、启动图与 bundle 路由

- Node 半侧**逐包增量**扫描已启用的 Loader 条目（没有全量重扫路径），把每份 `dsh.client` 声明变成可加载的
  浏览器 bundle；组合结果是一份规范化的**启动图**（`WebBootEntry` 行）。
- 启动图以 `window.__DSH_BOOT__` 注入页面（其中 `<` 被转义，插件控制的字符串无法逃出 script 元素），
  与 `window.__ModuleLoader__` facade、bootstrap combo 脚本、application combo 的 preload 一起进入 `<head>`。
  Web 载体把这些行渲染进 index 响应；由 shell 持有的载体可以在没有 Web server 时渲染同一批行。
- bundle 通过 `/plugins` 提供：Node 半侧快照每个 `client.js` 入口，把资源分组为 **combo 路由键**
  （`/plugins/??…&rev=…`）——modules 行一个 bootstrap combo，其余行一个或多个 application combo，
  每阶段在 URL 超过 3 KiB 之前分区。
- **revision** 由入口的 `mtimeMs`、`ctimeMs` 与大小派生（不做内容哈希），combo revision 从有序 row revision 派生；
  未变化的产物跨宿主重启保持 revision，SSE 重连不会替换浏览器插件。源码里 `import()` 拆出的 chunk 走
  `require.async("./client.<name>.js")`，按需以单资源 URL 取回。

## 3. 浏览器侧：模块表与惰性 factory

- shell 初始化一张**冻结**的模块表 `PLATFORM_MODULES`（React、Cordis 与静态 UI 库）；每个动态 bundle 都精确
  针对该基座解析 external。模块系统作为 `internal` 装进 shell 自己的 Loader，并发布为 `ctx.modules`——
  不同 Cordis 树不会通过模块级全局状态串在一起。
- 执行插件 bundle **只注册 factory**：模块体副作用（含 CSS 注入）都在 factory 闭包里，物化时才运行，
  因此插件首次被使用之前什么都不跑。factory 依赖另一个已注册未物化的模块时递归物化；
  **require 循环直接抛错**（factory 形式的 CJS 给不出部分导出）。
- 交给 factory 的同步 `require` 按固定顺序解析：平台 seed 表 → 已记忆记录 → 启动图 row → 已注册 factory；
  其他情况一律抛错。`require.async` 返回 Promise，并在物化前先取回生成的包内 chunk；chunk 必须**自包含**，
  入口与 chunk 产物之间不能同步 require 另一个相对 `client*.js`。

## 4. 两阶段启动与激活审计

`apps/web` 的 Vite 入口对挂载点跑 `AppWebEntry.run()`，启动分两阶段：

1. **模块阶段**：接纳 parser 已加载的 bootstrap 批次，`window.__ModuleLoader__.create({ boot, staticModules, … })`
   返回构造好的模块系统与解析后的 manifest，并通过共享的 application 批次 URL 预取 `immediately` 层级。
2. **插件阶段**：挂载 Loader、把 `loader.internal` 赋为模块系统、为每条启动图行创建 entry、等待完全停稳，
   然后**审计激活**：任何 import 失败、因缺服务 pending、或落入其他非 active 状态的 entry 都会抛出一个
   聚合错误，点名每个失败 entry。

启动页只依赖原生 DOM 与本地 CSS：它显示 spinner 并**逐 entry** 报告状态，失败时按名称给出原因（缺失服务、
导入失败、状态），而不是白屏；只有全部就绪才把启动 DOM 交给 UI 渲染器 hydrate。初始激活审计是严格的，
启动后页面本地的失败显示在「设置 → 插件 → 插件列表」，不影响 Host 的启用状态。

## 5. 开发环与边界

- 宿主下发的是**已构建**的客户端 bundle（`lib/client.js`）：源码启动会把宿主侧导入映射到 TypeScript 源码，
  但浏览器仍然消费构建产物；缺失 bundle 会显式导致激活失败，并给出构建说明与包 / 路径列表。
- 客户端 HMR receiver 始终挂载，但只有在 `pnpm run dev:web`（或 dsh 的对应重建命令）持续重建客户端 bundle
  时才产生效果；只跑 watcher（`--no-serve` 形态）时配合别处已起来的 `dsh web`。
- **0.1.0 不承诺仓外客户端插件的构建能力**：官方的 `clientBundle` 构建 preset 未随包发布，复现它属于
  0.2.0 的门类（见 `notes/evaluation.md` §8.5、§8.7）。本页只讲装载链路；仓外插件的构建面见
  `references/develop/build-and-pitfalls.md`。

## 6. 与宿主启动的关系

Web profile 的 required 条目包含 `webserver`、`modules` 与 `connection`：其中任一已启用条目失败，
Web 就起不来（`references/dsh/composition-and-boot.md` §4）。反过来，`packages/client/web` 自身**不是**
Loader 条目：它的静态 import 只负责播种 `PLATFORM_MODULES`，parser 预载的动态行才是普通 Loader 条目。

## 7. 源码最后手段

- 只看一条事实：`git -C 3rdp/deepseek-harness show deepseek-harness@dsh-v0.2.0-rc.2:<path>`（只读，不切换工作树）。
- 本页引用的每条上游路径都在 `src/facts.test.ts` 有台账条目。
