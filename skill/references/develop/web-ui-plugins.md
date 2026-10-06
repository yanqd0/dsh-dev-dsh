# web UI / 客户端插件：声明、加载与挂载

本文是 `references/develop/index.md` 的子页，回答「一个带浏览器半边的插件，要声明什么、怎么被加载、怎么挂上去」。
**事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`。上游权威：`docs/subsystems/client-modules.zh.md`（声明与启动图）、
`docs/subsystems/web-client.zh.md`（分层与所有权）、`docs/subsystems/slots.zh.md`（slot 归属）。

> **0.1.0 边界**：本页只写**架构、加载与挂载面**。客户端 bundle 的构建配方（`clientBundle` preset、外部化基线、
> 管线）属 0.2.0 门类，本手册当前不承诺；官方 `packages/client/tsdown.client.ts` 是仓内 sibling 模块，
> 不随 npm 发布、也没有仓外可用的等价 preset。

声明形状与 slot 阶梯的实现侧细节见 `references/dsh/modules/client.md`；两阶段启动、combo 路由与失败审计见
`references/dsh/client-loading.md`；挂载与清单见 `references/develop/mounting-and-manifest.md`；
「这一层能自证到什么程度」见 `references/dogfood/client-verification-ladder.md`。

## 1. 判据

- 插件要往浏览器里加东西（面板、卡片、设置项、快捷键）——即同时有 host 半边与 browser 半边。
- **只做宿主侧行为、不碰页面**：那是普通宿主插件，不要声明 `dsh.client`（见 `references/develop/host-entry-and-di.md`）。

## 2. `dsh.client` 字段

| 字段          | 形态       | 语义                                                                                         |
| ------------- | ---------- | -------------------------------------------------------------------------------------------- |
| `platform`    | `string`   | 必填；Web 消费者只认 `'web'`，其它值**静默跳过**（不报错）                                   |
| `inject`      | `string[]` | 信息性包名依赖，**不是** Cordis 服务注入                                                     |
| `immediately` | `boolean`  | 第一阶段 registration barrier；省略 = 共享 application 批次                                  |
| `external`    | `string[]` | 基线之外的**精确模块请求**（含 `<pkg>/client` 这类子路径）；`import type` 被擦除、不产生请求 |

唯一 validator 是 `parseDshClient`（`packages/client/modules/src/client/manifest.ts`），
字段畸形会抛出 `client-modules: …` 前缀的具体错误（见 §5）。

## 3. 从声明到挂载的完整链路

1. **`dsh.client` 本身不产生 Loader entry**。宿主扫描只覆盖**已存在的 loader row**，所以仓外包必须另有
   `dsh.bundle.patch`（或 profile 手写行）才能进 roster——这是「声明了却不出现」最常见的原因。
2. 宿主从 row 的包目录读 `package.json` → `dsh.client` → `exports["./client"]`，解析出 bundle 绝对路径。
3. 页面通过 `/plugins/??<pkg>/client.js&rev=<rev>` 拉取 bundle；两阶段启动决定注册 barrier 顺序。
4. browser 半边 `inject = ['slots']`，在 `apply` 里向**已声明**的 slot 注册（或自带父组件时先声明子 slot）。

## 4. 最小骨架

```
my-web-plugin/
├── package.json
├── cordis.patch.yml
└── src/
    ├── index.ts          # host 半边：可以是空 apply
    └── client/index.ts   # browser 半边：slot 注册
```

```json
{
  "name": "my-web-plugin",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./dist/index.js",
    "./client": { "default": "./dist/client.js" },
    "./package.json": "./package.json"
  },
  "files": ["dist", "cordis.patch.yml"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-layout"] }
  }
}
```

host 半边可以只有一个空 `apply`（上游 `packages/client/ui-shortcuts/src/index.ts` 就是这样：
host entry 不做事，行为全在 browser 半边）。browser 半边：

```ts
export const inject = ['slots'];
export function apply(ctx: Context) {
  ctx.slots.inject('<已声明的 slot 名>', () => ctx.slots.register({ name, id, order }, Component));
}
```

`cordis.patch.yml` 照常 `- insert:` 一行；构建产物本身需要你自备（本页不给配方）。

## 5. 产物形态：你的 bundle 里应该长什么样

宿主消费的是**已构建**的 `./client` 产物，所以至少要知道产物对浏览器承诺了什么；机制见
`references/dsh/client-loading.md`，这里只写形状。

- **包装形态**：bundle 顶部把注册交给全局 facade——
  `window.__ModuleLoader__.load({ id: "<包名>", factory: (require) => { … } })`。`id` 就是包名；
  模块体副作用（含 CSS 注入、slot 注册）**必须留在 factory 闭包里**，物化之前什么都不跑。
- **解析 external**：factory 收到的同步 `require` 按平台 seed 表 → 已记忆记录 → 启动图 row → 已注册 factory
  的顺序解析，其它情况抛错；`require.async("./client.<name>.js")` 用于拆出的 chunk（chunk 必须自包含）。
- **基线（不要写进 `external`）**：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、
  `@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、
  `@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`——共享实例，重复声明会冲突。

## 6. 静态插件怎么从宿主取数（host↔client 通道）

> **本节只讲「浏览器 → 宿主」取数。反向的「宿主 → 浏览器」传值（含本插件的 `config`）是另一条通道，
> 且客户端 entry **拿不到挂载行 `config`**——先读 `references/develop/host-to-client-channel.md`。**

**结论**：已安装（静态）插件的 browser 半边取数走**宿主 `ctx.webServer` 路由 + 浏览器 `fetch`**。

这条是排除法得到的，别再从别处找：

- **Typert `remote` 不行**：客户端的 Remote 命名空间装配是硬编码导入 + 数组，能力集在构建期固定，仓外包
  无法 join（见 `references/dsh/modules/api.md`）。它服务的是随本体一起发布的 Remote。
- **`harness.handle` / `host.call` 不行**：那是**动态** Cordis 包 runner 的通道——进程内、会话作用域、
  重启即失，且要 session 里装载 cordis 工具组。静态插件没有这条边。
- **剩下的就是 `ctx.webServer`**：与随附功能插件同一条路——host 半边注册路由，browser 半边 `fetch`
  相对路径（同源，无 CORS，不需要 /api 的 cookie 认证）。

最小骨架（`webServer` 必须在 `apply` 里按需取，headless / 无 Web 的组合没有这个服务）：

```ts
export const inject = ['webServer']; // 或 ctx.get('webServer') 后判空
export function apply(ctx: Context) {
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: '/my-plugin', // 无尾斜杠，见下节
      handler: (req, res) => {
        /* 自己拥有整个响应生命周期 */
      },
    })
  );
}
```

**纪律**：这条通道只受 Host / Origin 信任约束，没有业务认证。要处理用户动作或写操作时，自己加校验与授权，
别假设 `fetch` 的身份可信。

## 7. prefix 规则与「空 body 404」

`register({ kind: 'prefix', path })` 的匹配只有两条：请求 pathname **等于** `path`，或以 `path + '/'` 开头。
因此：

- **`path` 绝不要带尾斜杠**。注册 `/my-plugin/` 只能命中 `/my-plugin/` 与 `/my-plugin//…`，
  `/my-plugin/issues` 会漏，落到 SPA fallback；fallback 在 dist 里找不到该路径的文件，于是回一个
  **404 加空 body**——看起来像"路由不存在"，其实是前缀写法错。
- **装不了 `prefix` 语义**：想要"只匹配 `/my-plugin` 但不匹配 `/my-plugin-other`"，得注册 `exact` 的那一条。
- **排查两步**：先看响应状态与 body（200 但返回 index.html = 落 fallback；404 空 body = 前缀没命中）；
  再 `curl http://127.0.0.1:<port>/<prefix>/…` 直连自证（见 `references/dogfood/client-verification-ladder.md`）。

## 8. 官方功能区 seat 索引（右侧边栏 + conversation.view）

| seat                            | kind   | scope   | 声明者             | 用途                                        |
| ------------------------------- | ------ | ------- | ------------------ | ------------------------------------------- |
| `rightbar`                      | single | root    | `ui-layout`        | 右侧栏根容器；子表需声明 `rightbar.session` |
| `rightbar.session`              | single | session | `ui-sidebar-right` | 一个 Session 的右侧栏 View                  |
| `sidebar.right.pane.tab`        | keyed  | session | `ui-sidebar-right` | tab 正文，键 = tab 类型 `id`                |
| `sidebar.right.pane.tab.title`  | keyed  | session | `ui-sidebar-right` | tab 标题；不注册则用开 tab 时捕获的标题     |
| `sidebar.right.tab.guide`       | chain  | session | `ui-sidebar-right` | 替换 guide 正文而不替换 tab                 |
| `sidebar.right.tab.guide.entry` | keyed  | session | `ui-sidebar-right` | 一个 guide 条目的自定义卡片                 |
| `sidebar.right.tab.menu.item`   | list   | session | `ui-sidebar-right` | tab 右键菜单里追加"关于内容"的项            |
| `conversation.view`             | list   | session | `ui-conversation`  | 主列视图列表（与右侧栏并列的另一条轴）      |

两阶段一律走公开路径：**类型**用 `ctx.sidebarRightTabs.register({ id, kind, patterns?, priority?, canOpen?, title, guide?, keepMounted? })`，
**正文**用 `ctx.slots.register({ name: 'sidebar.right.pane.tab', key: definition.id }, Body)`；正文里用
`useTabInfo()` 拿 `{ sidebar, panel, tab }`。每个 seat 的 register 选项与 owner props 以运行时
`cordis_inspect_query`（`platform: 'client'`、provider `Slots`、method `listSubTree`）为准——**本表只给索引**，
不复制官方契约、也不保证列全所有功能区 seat；新 seat 先在 inspect 结果里确认，再加进本表。

## 9. 失败面

| 看到的串                                                                                                                            | 成因                                  | 修法                                   |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------- |
| `client-modules: <pkg> declares dsh.client but exports no "./client" bundle`                                                        | 有 `dsh.client` 但缺 `./client` 导出  | 补 `exports["./client"]`               |
| `client-modules: <pkg> exports["./client"] must be a string or an object with a string default`                                     | `./client` 类型不受支持               | 改成字符串或带 `default` 的一层对象    |
| `client-modules: <pkg> has a non-object dsh.client declaration` / `… platform must be a string` / `… immediately must be a boolean` | 声明字段畸形                          | 按 §2 修                               |
| `client-modules: client bundle not found; run \`pnpm run build\` before launch`                                                     | 声明了但产物缺失                      | 先构建                                 |
| `client-modules: cannot resolve "<spec>" — not a seed word, not a materialized module, and not a row in the boot graph`             | 用了没写进 `external` 的非基线模块    | 把精确请求加进 `external`              |
| `client-modules: duplicate factory registration for "<id>" (bundle executed twice without invalidate?)`                             | bundle 被重复执行                     | 检查产物与 rev                         |
| `client-modules: module graph cycle a -> b -> a` / `"<id>" requests module "<m>" that it answers itself`                            | 依赖环 / 自带包写进自己的 `external`  | 去掉环与该条声明                       |
| `slot "<name>" is not declared (a parent entry's children table must declare it)`                                                   | 向未声明的 slot 注册                  | 让父组件声明子 slot，或改用已声明 slot |
| `slot "<key>" is already declared (by …)` / `slot factory "<name>" already has a definition`                                        | slot 重声明 / 同 id 二次注册          | 一个 declarer，改 id                   |
| 200 但 body 是 index.html                                                                                                           | 请求落 SPA fallback（路由没命中）     | 查 `kind` 与 `path` 写法（§7）         |
| 404 且 body 为空                                                                                                                    | 同上；fallback 在 dist 里找不到该文件 | 同上                                   |
| 插件页（侧栏插件面板 / 设置 → 插件）只有包名、无标题与描述，且没有任何提示                                                          | `exports` 未暴露 `./package.json`     | 补 `"./package.json"`，见下            |

**静默项**：`platform !== 'web'` 时宿主**不报错**，只是把该包当成非 client 行——「插件完全不出现」先查这里。
展示元数据（标题 / 描述 / 图标）另有一整条静默链：reader、`exports` 门禁与 locale 目录纪律见
`references/develop/mounting-and-manifest.md` §6 及其 §6.1——**它不报错，只是页面变干净**。

## 10. 验收

- 宿主：`dsh --profile <p> --dump-config` 里有你的 entry（证明 row 进了 Loader）。
- HTTP：`GET /plugins/??<pkg>/client.js&rev=<rev>` 能取到 bundle；缺 rev / 陈旧 rev → 404，非 GET/HEAD → 405。
- 页面：`window.__DSH_BOOT__` 里出现你的 row（`id` / `url` / `rev` 等）；浏览器 `ctx.modules` 模块表里有对应 key。
- 激活审计：import 失败、缺服务 pending、非 active entry 会被聚合错误逐个点名；启动后的本地失败显示在
  设置 → 插件列表。
- 取数与自证边界：路由可用 `curl` 直连验数据层；slot 注册可用 Client Inspect 的活 slot 树核对；
  视图层需要人眼或浏览器控制——见 `references/dogfood/client-verification-ladder.md`。

## 11. 源码最后手段

`deepseek-harness@dsh-v0.2.0-rc.2:packages/client/modules/src/index.ts`（扫描与 combo 路由）、
`packages/client/modules/src/client/system.ts`（浏览器模块表）。默认不读。
