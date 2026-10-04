# host → browser 通道：配置、偏好与数据怎么到客户端半边

本文是 `references/develop/index.md` 的子页，回答「宿主侧的值（**尤其是插件的 `config`**）怎么到达浏览器半边」。
声明、挂载与产物形状见 `references/develop/web-ui-plugins.md`；浏览器侧怎么取运行时状态见
`references/dogfood/runtime-evidence.md`。

上游事实出处：`deepseek-harness@dsh-v0.2.0-rc.2`。

> **先记住这一条，它能省掉一轮返工**：**客户端 entry 拿不到挂载行的 `config`。**
> 官方 `@deepseek-ai/dsh-client-shortcuts` 为此把校验过的配置经 `webserver/index-inject` 注入成
> `globalThis.__DSH_SHORTCUTS_CONFIG__`；`ui-settings-models` 注入 `__DSH_MODELS_ONBOARDING__`。
> 于是「宿主半边只负责把值写成页面全局，浏览器半边从全局读」是本类插件的**标准分工**。

## 1. 四条通道（先选通道，再写代码）

| 通道                                    | 方向                       | 适用                                                                 | 代价 / 限制                                                                                    |
| --------------------------------------- | -------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **`webserver/index-inject` → 页面全局** | host → browser，**一次性** | 启动期就要的值：本插件的 `config`、初始主题、引导开关、页内样式/脚本 | 只在 index 渲染时注入；值是 JSON；**没有 web server 的组合不生效**（headless / CLI）           |
| **settings 服务**                       | 双向                       | 用户偏好：会被 UI 改、要落用户设置文档、要活更新                     | 需要 `settings` 服务与对应 controller；比一次性开关重                                          |
| **`ctx.webServer` 路由 + `fetch`**      | browser → host 取数        | 浏览器发起的数据查询                                                 | 只受 Host/Origin 信任约束，无业务认证；路由细节见 `references/develop/web-ui-plugins.md` §6/§7 |
| **Typert `remote` / `host.call`**       | —                          | **仓外静态插件用不了**                                               | `remote` 能力集构建期固定；`host.call` 只服务动态 Cordis 包 runner。排除法见 web-ui-plugins §6 |

判据很直接：**「只在启动时读一次的宿主配置」→第一条；「用户能在设置里改、要持久化」→第二条；
「浏览器按需向宿主要数据」→第三条。**

## 2. 第一条通道怎么用（最常用，也最容易写完不生效）

宿主半边只做一件事：**订阅注入事件，往表里 push 行**。

```ts
// src/index.ts（宿主半边）
const GLOBAL_NAME = '__MY_PLUGIN_CONFIG__';

export function apply(ctx: Context, config: Config) {
  // 不要先 ctx.get('webserver') 再注册：那是自造的一条路（见 §3 陷阱 1）
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: GLOBAL_NAME, value: { enabled: config.enabled } });
  });
}
```

```ts
// src/client-entry.ts（浏览器半边）
export function apply(ctx: ClientContext, cfg: Record<string, unknown> = {}) {
  const published = (globalThis as Record<string, unknown>)[GLOBAL_NAME];
  const enabled =
    typeof published === 'object' && published !== null
      ? (published as { enabled?: unknown }).enabled === true
      : false;
  // 没有 logger、没有服务时静默返回，绝不抛：客户端 entry 抛错会让整页启动失败
  if (!enabled) return;
  // …按需接线
}
```

行的形状（`kind` 决定页面怎么消费它）：

| `kind`                          | 字段                | 页面动作                              |
| ------------------------------- | ------------------- | ------------------------------------- |
| `global`                        | `name`, `value`     | 在脚本之前 `globalThis[name] = value` |
| `script`                        | `text`, `placement` | 按顺序插一段内联脚本                  |
| `html`                          | `html`, `placement` | 插一段 HTML                           |
| `style`                         | `text`              | 插一段样式                            |
| `script-src` / `script-preload` | `src`               | 由页面资产通道加载外部脚本            |

## 3. 四个必踩的陷阱

1. **不要为了「拿服务」而绕路注册事件。** cordis 的 `on` 不需要 `inject`，事件没有监听者也不会报错；
   而 `ctx.get('webserver')` 在插件 `apply` 的时刻**可能还没提供**。官方的宿主半边（`ui-settings-models`、
   `ui-theme`、`client-shortcuts`）一律是**直接 `ctx.on(...)`**。写错这一步的后果是：配置注入静默不发生，
   浏览器侧永远读到「未开启」——**排查时极易误判成客户端逻辑坏了**。
2. **行顺序就是执行顺序。** 注入表按订阅者激活顺序 push、页面按表顺序执行。官方 `ui-theme` 用
   `ctx.on('webserver/index-inject', fn, { prepend: true })` 把行塞到最前，保证「先设好全局/样式，
   再跑读它的脚本」。你的 `global` 行若排在别处之后，早读的脚本会拿到 `undefined`。
3. **只放 JSON 兼容的公开值。** 这是**服务端渲染进 HTML 的文本**：不要放函数、类实例、`undefined` 之外的哨兵，
   也不要把密钥类值放进去（它会出现在页面源码里）。
4. **无 web server 的组合必须无害。** headless / CLI profile 永远收不到 emit。这不是错误，也不需要清理；
   但如果插件在**所有**组合里都不可用，应该把「没有页面通道」写进插件文档，而不是让调用方到运行期才发现。

## 4. 客户端 entry 里的两条纪律

- **`apply` 绝不抛。** 客户端 entry 的 `apply` 失败会让启动审计把这一行判为未激活；浏览器模块系统会连整页
  一起拒绝启动（`… did not activate`）。所以每个可选服务都要判空、每条失败路径都要降级成 warn 或静默。
- **区分「加载失败」和「功能关闭」。** 关闭时不要留任何半装状态（不订阅、不移焦、不打日志）；
  失败时才允许 warn。本仓 `src/keyboard/host.ts` 与 `src/keyboard/client.ts` 是这两种姿态的现成范例。

## 5. 三条机械判据（写完必查，比读代码快）

配置类改动的失败几乎都落在「值没到」而不是「逻辑错」，所以先证前两条再看行为：

1. **注入到位**：`curl` 页面 HTML 后 `grep -o '__MY_PLUGIN_CONFIG__'`（或直接看 `globalThis["…"] = …`）。
   页面里没有你的名字 → **注入面失效**，此时改客户端代码是纯浪费。
2. **产物同源**：从 HTML 取 `plugins/??<pkg>/client.js&rev=<rev>`，`curl` 下来与 `dist/client.js` 比对。
   不同源说明浏览器拿的是旧包。
3. **重启生效**：宿主进程启动时间晚于 `dist/*.js` 的 mtime。客户端产物与注入表都在**宿主启动时**定型，
   改完必须重启 harness **并刷新页面**。

取 token 页面、比对产物、弹卡与读授权日志的完整命令见
`references/dogfood/e2e-verification-recipe.md`。

## 6. 源码最后手段

`deepseek-harness@dsh-v0.2.0-rc.2`：`packages/host/webserver/src/index.ts`（`webserver/index-inject`
事件声明与 `collectIndexInjections`）、`packages/client/shortcuts/src/index.ts` 与
`packages/client/ui-settings-models/src/index.ts`（两个「注入页面全局」的官方宿主半边写法）、
`packages/client/web/src/apply-injections.ts`（页面侧解释器：行顺序执行）。默认不读。
