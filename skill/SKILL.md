---
name: dsh-dev-dsh
description: >-
  在独立仓库（非 deepseek-harness monorepo）里开发、构建与发布 DSH 宿主插件：
  包形态与挂载声明、cordis 宿主契约、以及官方文档未覆盖的失败面与踩坑清单。
whenToUse: 需要仓外开发一个可发布的 DSH 插件，或排查其挂载 / 加载 / 安装失败时。
---

# dsh-dev-dsh

面向**仓外**（out-of-tree）DSH 插件仓库的开发指引：插件有自己的仓库、自己的工具链，
发布到 npm，而不是放进 `deepseek-harness` monorepo。

> **0.1.0 边界**：只覆盖**宿主面**插件。客户端 / UI 插件（`dsh.client` 声明与预构建 bundle）
> 不在范围内，属 0.2.0。仓外客户端构建目前没有可用的官方 preset——`packages/client/tsdown.client.ts`
> 未随 npm 发布，官方 cookbook 也要求仓库外自行复现（`docs/cookbook/adding-a-settings-card.md`）。
> 本 skill 不承诺该路径。

## 1. 先路由：不要重复官方已有的内容

按顺序优先用官方能力，本 skill 只补它们不写的仓外工程面：

| 需要什么                                                  | 去哪里                                                                                                                                                           |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 在**当前 profile** 里写/装/调一个插件、bundle、页面、工具 | Creator mode 的自带 skill：`cordis-plugin-development`（含 host/ui/mcp 参考与 templates/）、`editing-cordis-compositions`；`packages/preset/agent-preset/skills` |
| loader patch 方言                                         | `cordis-composition-reference`（同上目录）                                                                                                                       |
| 运行时 API 事实                                           | `cordis_inspect_list` / `cordis_inspect_query`（Service / Event / Config schema / Tool / Slot）                                                                  |
| 安装与开关                                                | `plugin_manager`（如 `install_bundle`）；命令行 `dsh plugin --profile <p> add <pkg>`                                                                             |
| 概念与教程                                                | `docs/user/develop`（basic / framework / practice）                                                                                                              |

官方**明确不管**仓外工程化：它自己的 SDK 项目脚手架与项目模板已被主动移除
（`.agents/notes/archived/simplification/2026-08-11-remove-sdk-project-toolchain.zh.md`）。
本 skill 的价值就在这里。

## 2. 仓外仓库形态（最小清单）

- 包形态：`"type": "module"` + ESM 入口 + `exports`；产物目录（如 `dist/`）随 npm 发布。
- `files` 必须包含 **bundle patch 文件**。漏了会在用户启动时抛 `dsh: failed to read overlay <file>`。
- `dsh.bundle.patch` 指向该文件，类型是字符串或字符串数组（同层按序应用）。
- 需要与宿主共享实例的 dsh 包同时进 `peerDependencies` 与 `devDependencies`；
  独立版本的第三方依赖与无状态工具包进 `dependencies`。
- `engines` 是声明式字段，当前没有 reader —— 别把它当兼容性保证。
- 不要手改 profile 目录（`package.json` / `cordis.patch.yml`）：`dsh plugin` 与 `plugin_manager`
  会维护 `dsh.profile.bundles`。

细节与失败串：`references/mounting-and-manifest.md`。

## 3. 宿主入口与 Config

- 具名导出 `name` / `inject` / `Config` / `apply`，**或**单个 default 对象，二选一。
  混用会让 default 取代命名空间，静默丢掉 `inject` 与 `Config`。
- `Config` 是 Standard Schema（如 zod object），校验**同步**且失败即加载失败，文本形如
  `invalid config:\n  - <message> (at <path>)`。
- 对象 schema 缺省为 `{}`：patch 里省略 `config` 与写 `config: {}` 等价，**必填字段照样失败**。
  所以 patch 的 `config` 必须显式写全必填项。
- 注册工具用 `ctx.tools.register(defineTool({...}))`；`output: { schema, render }` 必填。
  注册本身是 effect，随插件卸载回收。

细节与事件表（含"本版本没有 `agent/session-start`"）：`references/host-entry-and-di.md`。

## 4. 挂载 patch 的三条约束

1. 新条目必须用 `insert:` 列表包裹。裸 `- id: x` 是**覆盖**语义：目标行不存在时只留
   `patch: entry "<id>" not found` 警告，插件静默不生效。
2. `config` 必须显式给出（理由见上一节）。
3. 与 profile 里手写的同 id 条目并存**不会报错**：0.1.7-rc.2 是 last-wins 静默复用/替换
   （旧说法 `duplicate loader entry id` 已不成立于本版本）。两者仍只能留其一，否则配置被静默覆盖。

层序、警告串与验证命令：`references/mounting-and-manifest.md`。

## 5. 分发形态怎么选

| 形态                | 用户侧成本                                                 | 对作者的要求                              |
| ------------------- | ---------------------------------------------------------- | ----------------------------------------- |
| 发布到 npm（首选）  | 无                                                         | 发布前构建产物，产物与 patch 都进 `files` |
| git 安装            | 需在 profile 的 `allowBuilds` 授权（= 允许安装期执行代码） | 提供自包含 `prepare`；建议锁 commit       |
| `pnpm pack` tarball | 无                                                         | 同 npm                                    |

pnpm ≥10 默认拦截构建脚本（`ERR_PNPM_IGNORED_BUILDS`），pending 项在 `allowBuilds` 下留
`set this to true or false` 占位。完整对照表：`references/build-and-pitfalls.md`。

## 6. 两个已验证可复用的模式

这两条不是 dsh 契约，而是本仓（`@yanqd0/dsh-dev-dsh`）跑通并测试过的工程做法：

- **随包安装一份数据/skill**：仓库内目录是单一真源，构建期整目录拷进发布目录；
  两个触发点（`postinstall` + 宿主 `apply()`）；同步是 content-sync——目标与源整树一致就不动、
  目标是 symlink 永不覆盖、失败只记一行绝不让加载或安装失败。
- **版本化事实台账**：每条上游事实记 `<repo>@<tag>` + `path`(+`line`)；元数据断言始终跑，
  "checkout 存在时逐条复核"是可选路径——参考树在测试/生产环境通常不存在，缺失必须静默跳过。

## 7. 验收清单

```sh
pnpm pack --dry-run                      # 产物里真有入口与 patch
dsh plugin --profile <p> add <pkg>       # 安装并写入 dsh.profile.bundles
dsh --profile <p> --dump-config          # 确认自己那一层存在
```

- 装完通常需要重启 profile 才加载新 JS 模块；不要用日志或进程列表代替上述检查。
- 只在**真实消费方仓库**上验收，而不是只跑单测。

## references

| 主题                                                 | 文件                                  |
| ---------------------------------------------------- | ------------------------------------- |
| 挂载与清单：patch 语义、层序、包清单字段             | `references/mounting-and-manifest.md` |
| 宿主入口与 DI：导出形态、Config 校验、工具注册、事件 | `references/host-entry-and-di.md`     |
| 构建、发布与踩坑：仓外仓库的工程面                   | `references/build-and-pitfalls.md`    |

上游事实的版本 pin 与来源记录在 `src/facts.test.ts` 的 fact 清单里（绑定
`deepseek-harness@dsh-v0.1.7-rc.2`）：本 skill 每引用一条上游事实，必须同步登记一条 fact。
