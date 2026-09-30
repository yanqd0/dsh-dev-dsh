# 模块：client（浏览器半边）与 typert（类型面）

> 本文是 `references/dsh/modules/index.md` 的子页；索引与页契约见该页。
>
> **范围**：`packages/client` 的浏览器半边怎么声明与挂载、有哪些子族；`packages/typert` 作为类型面给两边提供什么。
> 装载链路（启动图、combo 路由、两阶段启动）见 `references/dsh/client-loading.md`；宿主面见 `references/dsh/modules/host.md`；
> Remote 见 `references/dsh/modules/api.md`。
> **事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`。构建配方**不在**本手册 0.1.0 的承诺范围。
> 上游权威：`packages/client/README.zh.md`（组内 ctx 键表）、`docs/subsystems/client-modules.zh.md`（声明与启动图）、
> `docs/subsystems/slots.zh.md`（slot 归属与扩展）、`docs/subsystems/web-client.zh.md`（层与所有权）、
> `packages/client/AGENTS.md`（包规则）、`packages/typert/README.zh.md`、`docs/subsystems/typert.zh.md`。

## 1. 客户端半边怎么声明

包在自己的 `package.json` 里给出两样东西：

```json
{
  "dsh": {
    "client": { "platform": "web", "inject": ["…包名"], "immediately": true, "external": ["…"] }
  },
  "exports": {
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }
  }
}
```

- **`./client` 子路径就是插件 bundle**：`<id>/client` 与裸 `<id>` 解析到同一份导出。
- **`inject` 是信息性的包名边**，不是 Cordis 服务注入；真正的依赖穿过注入的服务或 slot。
- **`immediately: true`** 表示"必须在 shell 起来之前到位"（模块阶段预取）；省略则属于共享应用批次。
- **基线外部模块对每个动态 bundle 都是隐式的**（React、Cordis、`client-store`、`ui-slots`、`ui-primitives`、`ui-dockkit`），
  **不要**在 `dsh.client.external` 里重复声明；基线名单在 `packages/client/web/src/platform.ts`。
- **缺少 `lib/client.js` 会大声失败**（激活报错并给出构建提示），宿主只服务已构建的 bundle。

## 2. 客户端子族（按 ctx 键找入口）

| 子族             | 代表包 / 键                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| shell / 启动内核 | `client/web`（无 ctx 键；`PLATFORM_MODULES` + shell 库），由 `apps/web` 渲染                                                                |
| 模块加载         | `client/modules`：宿主 `ctx.clientModules`（扫描 `dsh.client`、组 boot graph、服务 `/plugins`），浏览器 `ctx.modules`                       |
| 传输与状态       | `client/connection`（`ctx.connection`）、`client/file-upload`（`ctx.fileUpload`/`ctx.fileUploads`）、`client/store`（无键，React 无关原语） |
| 扩展注册表       | `client/ui-slots`（无键，slot 定义）、`client/ui-renderer`（`ctx.slots`、`ctx.uiRenderer`，唯一的 ctx→React 绑定点）                        |
| 会话呈现         | `client/ui-session`、`ui-layout`、`ui-conversation`、`ui-chat`、`ui-tool`、`ui-workspace`、`ui-theme` 等                                    |
| 侧栏             | `ui-sidebar`、`ui-sidebar-right`（`ctx.sidebarRight`、`ctx.sidebarRightTabs`）、`ui-sidebar-documentpreview` 等                             |
| agent 面         | `ui-goal`、`ui-plan`、`ui-deliverables`、`ui-jobs`、`ui-schedule`、`ui-skill`、`ui-commands`（`ctx.command`/`ctx.commandUi`）等             |
| settings         | `ui-settings`（`ctx.settingsSchema`、`ctx.configForms`）+ 各 `ui-settings-*` 卡片插件                                                       |
| 插件管理 UI      | `ui-plugin-manager`（`ctx.pluginRegistryProbe`、`ctx.pluginNavigation`）、`ui-settings-plugins`（分节壳 + tab 扩展点）                      |
| 目录 / 打开应用  | `ui-directory-picker-browse`、`ui-directory-picker-native`、`ui-open-in-app`                                                                |
| 其它             | `locale`（`ctx.locale`）、`shortcuts`（`ctx.shortcuts`）、`hmr`（开发期刷新）、`product-analytics`（`ctx.productAnalytics`）                |

## 3. 加一个浏览器可见行为

1. 建一个带 `dsh.client` + `./client` 的包；在 `apply` 里 `ctx.slots.register({ name, … }, Component)` 或消费注入的服务。
2. **slot 一个 declarer**：同一个 slot 只能有一个声明者，同 id 同 priority 第二份注册会抛错（`already declared` /
   `already has a definition`）。
3. **跨包不 import 运行时代码**：功能插件之间只经模块表（外部化基线）共享，见 `packages/client/AGENTS.md`。
4. 只有 `ui-renderer` 允许组合 hooks / context；业务组件只拿派生 props，不接触 `ctx`。

## 4. typert：类型面

- `packages/typert` 是构建期生成器 + 运行时注册表 + 协议包：`ctx.typert` 保存生成的反射与实时 schema；
  `ctx.typert` 是**唯一**注册表，`typert-loader` 是**唯一**自动注册路径。
- **产物契约是 `exports` 里名为 `./typert` 的子路径**（字符串，或带字符串 `default` 的对象）；
  生成物导出 `TYPERT`（host 面）/ `TYPERT_REMOTE`（remote 面）。
- `typert-loader` 的 `Config.packages` 是**显式白名单**（默认空）：没被选中的包不会自动注册。
- 注册表同时也跑在浏览器（`dsh.client` + `./client`），所以 `ctx.typert` 在两边都存在。

## 5. 能替换 / 不能碰与易错点

- **能替换 / 扩展**：新的 `dsh.client` 包与 slot 注册；自己的 `@Remote` 服务（见 api 页）。
- **不能碰**：`client/web` 的模块表基线、`client/modules` 的 boot graph 与加载器、`client/connection` 的 rpcId、
  `ui-renderer`、`ui-slots`；`typert` 的注册表与 loader 单例。
- **易错点**：`dsh.client.inject` 不是服务注入；把基线模块写进 `external` 会与 shell 的共享实例冲突；
  在 0.1.0 不要指望仓外自建 client bundle 的官方配方（属 0.2.0 门类）。

## 6. 源码最后手段

- 只看一条事实：`git -C 3rdp/deepseek-harness show deepseek-harness@dsh-v0.2.0-rc.2:<path>`（只读，不切换工作树）。
- 本页引用的每条上游路径都在 `src/facts.test.ts` 有台账条目；失效时测试按条目报出来。
