# web UI / 客户端插件：声明、加载与挂载

本文是 `references/develop/index.md` 的子页，回答「一个带浏览器半边的插件，要声明什么、怎么被加载、怎么挂上去」。
**事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`。上游权威：`docs/subsystems/client-modules.zh.md`（声明与启动图）、
`docs/subsystems/web-client.zh.md`（分层与所有权）、`docs/subsystems/slots.zh.md`（slot 归属）。

> **0.1.0 边界**：本页只写**架构、加载与挂载面**。客户端 bundle 的构建配方（`clientBundle` preset、外部化基线、
> 管线）属 0.2.0 门类，本手册当前不承诺；官方 `packages/client/tsdown.client.ts` 是仓内 sibling 模块，
> 不随 npm 发布、也没有仓外可用的等价 preset。

声明形状与 slot 阶梯的实现侧细节见 `references/dsh/modules/client.md`；两阶段启动、combo 路由与失败审计见
`references/dsh/client-loading.md`；挂载与清单见 `references/develop/mounting-and-manifest.md`。

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

## 5. 失败面

| 看到的串                                                                                                                            | 成因                                 | 修法                                   |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------- |
| `client-modules: <pkg> declares dsh.client but exports no "./client" bundle`                                                        | 有 `dsh.client` 但缺 `./client` 导出 | 补 `exports["./client"]`               |
| `client-modules: <pkg> exports["./client"] must be a string or an object with a string default`                                     | `./client` 类型不受支持              | 改成字符串或带 `default` 的一层对象    |
| `client-modules: <pkg> has a non-object dsh.client declaration` / `… platform must be a string` / `… immediately must be a boolean` | 声明字段畸形                         | 按 §2 修                               |
| `client-modules: client bundle not found; run \`pnpm run build\` before launch`                                                     | 声明了但产物缺失                     | 先构建                                 |
| `client-modules: cannot resolve "<spec>" — not a seed word, not a materialized module, and not a row in the boot graph`             | 用了没写进 `external` 的非基线模块   | 把精确请求加进 `external`              |
| `client-modules: duplicate factory registration for "<id>" (bundle executed twice without invalidate?)`                             | bundle 被重复执行                    | 检查产物与 rev                         |
| `client-modules: module graph cycle a -> b -> a` / `"<id>" requests module "<m>" that it answers itself`                            | 依赖环 / 自带包写进自己的 `external` | 去掉环与该条声明                       |
| `slot "<name>" is not declared (a parent entry's children table must declare it)`                                                   | 向未声明的 slot 注册                 | 让父组件声明子 slot，或改用已声明 slot |
| `slot "<key>" is already declared (by …)` / `slot factory "<name>" already has a definition`                                        | slot 重声明 / 同 id 二次注册         | 一个 declarer，改 id                   |

**静默项**：`platform !== 'web'` 时宿主**不报错**，只是把该包当成非 client 行——「插件完全不出现」先查这里。

## 6. 验收

- 宿主：`dsh --profile <p> --dump-config` 里有你的 entry（证明 row 进了 Loader）。
- HTTP：`GET /plugins/??<pkg>/client.js&rev=<rev>` 能取到 bundle；缺 rev / 陈旧 rev → 404，非 GET/HEAD → 405。
- 页面：`window.__DSH_BOOT__` 里出现你的 row（`id` / `url` / `rev` 等）；浏览器 `ctx.modules` 模块表里有对应 key。
- 激活审计：import 失败、缺服务 pending、非 active entry 会被聚合错误逐个点名；启动后的本地失败显示在
  设置 → 插件列表。

## 7. 源码最后手段

`deepseek-harness@dsh-v0.2.0-rc.2:packages/client/modules/src/index.ts`（扫描与 combo 路由）、
`packages/client/modules/src/client/system.ts`（浏览器模块表）。默认不读。
