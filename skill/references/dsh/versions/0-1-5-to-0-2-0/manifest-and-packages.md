# 清单与包：0.1.5 → 0.1.7 的契约面变化

本文是 `references/dsh/versions/0-1-5-to-0-2-0/index.md` 的子页。**默认不读**：只有从 0.1.5 线升级、或维护当年
写下的 `package.json` / 挂载清单时才进这里。

上游事实出处：`deepseek-harness@dsh-v0.2.0-rc.2`（对照 `dsh-v0.1.5-rc.3` 与 `dsh-v0.1.7-rc.2`）。

## 1. 改了什么

### `package.json.dsh` 的字段增删

| 变化 | 字段                                                                                                                                                 | 说明                                                                                                        |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 新增 | `manifestVersion?: 1`                                                                                                                                | 清单自身格式版本，与 npm 包版本、Session 格式版本都无关                                                     |
| 新增 | `engines?: { dsh?, node?, npm?, … }`                                                                                                                 | 运行时要求；**声明式**，当前没有 reader 强制执行                                                            |
| 新增 | 包级身份字段 `DshPackageManifest`（`name` / `version` / `description?` / `icon?` / `private?` / `dependencies?` / `peerDependencies?` / `engines?`） | 供发现与展示读取；本地 profile 可给部分声明                                                                 |
| 放宽 | `dsh.bundle.patch`                                                                                                                                   | 由 `string` 变成 `string \| string[]`：多个 patch 文件按数组顺序拼成**同一层**                              |
| 移除 | `dsh.profile.patchReload`                                                                                                                            | 0.1.5 用它声明 `live` / `startup`；新版该字段不再被读（重载能力改由 HMR 提供，见 `runtime-and-tooling.md`） |
| 移除 | `dsh.configTrees`                                                                                                                                    | 实验镜像打包器的声明                                                                                        |
| 移除 | `dsh.sessionFormatMigration`                                                                                                                         | 目录生成器读取的相邻迁移元数据                                                                              |
| 移除 | `dsh.moduleFallback`                                                                                                                                 | 启动器生成的内部代理元数据                                                                                  |
| 未变 | `dsh.bundle` / `dsh.profile` / `dsh.client` 三个角色本身                                                                                             | `client.{platform,inject,immediately,external}` 字段一字未改                                                |

### 包与组增删（只列作者相关的面）

**包名消失或改名**（写在依赖、挂载行、`files` 清单里的名字都会失效）：

| 0.1.5                                                                         | 0.1.7 的替代                                                                                       |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `@deepseek-ai/dsh-agent-presets`                                              | `@deepseek-ai/dsh-agent-preset` + `@deepseek-ai/dsh-agent-preset-registry`                         |
| `@deepseek-ai/dsh-settings-file`                                              | 不再有同名包（设置落点改由 settings 子系统与服务承担）                                             |
| `@deepseek-ai/dsh-code-runtime`、`-worker-thread`（服务键 `ctx.codeRuntime`） | `@deepseek-ai/dsh-ptc-runtime`、`-node`（服务键 `ctx.ptcRuntime`；**键名不是别名，注入方必须改**） |
| `@deepseek-ai/dsh-e2b`、`-fs-e2b`、`-subprocess-e2b`                          | 该远端后端整组移除                                                                                 |
| `@deepseek-ai/dsh-experimental-code-runtime-python`                           | `@deepseek-ai/dsh-experimental-ptc-runtime-python`                                                 |
| `@deepseek-ai/dsh-experimental-agent-team-web-profile`                        | 该实验组合包移除                                                                                   |
| `@deepseek-ai/dsh-workflow-worker-thread`                                     | `@deepseek-ai/dsh-workflow-ptc`                                                                    |

**只是搬家、包名没变**：`@deepseek-ai/dsh-tool-present` 由 `packages/fs/tool-present` 移到
`packages/deliverables/tool-present`——对 npm 消费者**没有影响**，但按目录路径写死的脚本会失效。

**新增的关键包**：`@deepseek-ai/dsh-plugin-manager`、`-hmr`、`-config-editor`、
`-session-format-v3-to-v4`、`-ptc-runtime`、`-ssh`（+ `-fs-ssh` / `-sandbox-ssh` / `-subprocess-ssh`）、
`-browser-use`、`-computer-use`、`-deliverables`（含 `-workspace-changes`）、`-office-to-pdf`、
`-mcp-resources`、`-agent-preset`、`-skill-office`、`-tool-workspace-dependencies`，以及一批 `client/ui-*`
与 `api/*-controller`。分组口径见 `packages/README.zh.md`。

## 2. 为什么坏

- **依赖或挂载已消失的包名**：解析直接失败（不是兼容性门禁，是 module resolution）。改名的四组尤其容易漏。
- **服务键一起改了**：`ctx.codeRuntime` → `ctx.ptcRuntime`（`inject: ['codeRuntime']` 或 `ctx.codeRuntime` 的写法
  在新版直接不成立），类型名也从 `CodeRuntime` 系变成 `PtcRuntime` 系。
- **`dsh.profile.patchReload`**：字段被移除后是声明式残留——不报错，但你的重载预期不再由它控制。
- **`dsh.configTrees` / `dsh.sessionFormatMigration` / `dsh.moduleFallback`**：同理，写了没人读。
- **把目录布局当契约**：`fs/tool-present` → `deliverables/tool-present` 这类搬家对 import 无害，但按路径拼装、
  按组名判断能力的脚本会错。
- **别引错证据**：本仓笔记里提到的 `@deepseek-ai/dsh-client-runtime` 在本地三个 tag 上都不存在，不能当作本窗口
  的移除项。

## 3. 升级要动什么

1. `package.json`：删掉已移除的 `dsh.*` 字段；需要多个 patch 时把 `dsh.bundle.patch` 写成数组；按需补
   `engines`（声明式）与展示字段（`description` / `icon`）。
2. 依赖与挂载行：把上表左列的包名换成右列；`peerDependencies` 里的 `@deepseek-ai/dsh*` 范围按
   `runtime-and-tooling.md` 对齐。
3. `files` 清单：`dsh.bundle.patch` 指向的文件必须在 `files` 里，否则启动时 `failed to read overlay`（见
   `references/develop/mounting-and-manifest.md`）。
4. 复核：`dsh --profile <p> --dump-config` 看实际挂载的行与 config（见 `references/dsh/composition-and-boot.md` §5）。

## 4. 静默失效

1. **声明式字段没人读**：`engines`、`manifestVersion` 当前都不强制，写了不等于生效。
2. 被移除字段的残留声明（见 §2）。
3. 手写 `dsh.profile.bundles` 与安装期 reconcile 的交互——装完之后谁写这一行要看
   `references/dsh/plugin-management.md` §2，别按 0.1.5 的印象手改。
4. 按包目录名 / 组名推断能力，而不是按包名与导出的服务。

## 5. 复核（只读）

```bash
git -C <checkout> diff dsh-v0.1.5-rc.3 dsh-v0.1.7-rc.2 -- packages/util/package-manifest/src/types.ts
git -C <checkout> diff --name-status dsh-v0.1.5-rc.3 dsh-v0.1.7-rc.2 | grep 'package.json$'
git -C <checkout> show dsh-v0.1.5-rc.3:packages/preset/agent-presets/package.json | grep '"name"'
git -C <checkout> show dsh-v0.1.7-rc.2:packages/preset/agent-preset/package.json | grep '"name"'
git -C <checkout> show dsh-v0.1.5-rc.3:packages/code-runtime/code-runtime/src/index.ts | grep "ctx, 'codeRuntime'"
git -C <checkout> show dsh-v0.1.7-rc.2:packages/ptc-runtime/ptc-runtime/src/index.ts | grep "ctx, 'ptcRuntime'"
```

第一行给出字段增删；第二行列全部包目录增删；中间两行是「改名」的一个实例（0.1.5 侧还有
`packages/settings/settings-file` 这类消失包可用同样方式复核）；最后两行给出服务键从 `codeRuntime` 到
`ptcRuntime` 的证据。目录搬家的实例见 `packages/fs/tool-present` 与 `packages/deliverables/tool-present`
（包名不变）。
