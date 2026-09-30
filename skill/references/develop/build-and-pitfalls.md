# 构建、发布与踩坑：仓外仓库的工程面

本文是 `references/develop/index.md` 的子页，回答「仓外插件仓库怎么构建、怎么发布、报错怎么归因」。
出处在快照 `deepseek-harness@dsh-v0.2.0-rc.2`；行号由 `src/facts.test.ts` 复核。

## 1. 模块形态

- 插件与它引用的入口必须是 ESM（`"type": "module"`）。dsh 的源码启动走 tsx 的 ESM-only hook，
  它触达的模块不能是 CJS-only。
- 相对导入带扩展名——Node 的原生规则，dsh **不加包装、不改写**任何模块解析：
  dsh 只是把 Node 的 `ERR_MODULE_NOT_FOUND` / `MODULE_NOT_FOUND` /
  `ERR_PACKAGE_PATH_NOT_EXPORTED` 当作"资源缺失"处理（显示元数据场景下静默降级，
  `packages/boot/app-boot/src/package-meta.ts:61`）。无扩展名导入得到的就是 Node 原生报错。
- `exports` 决定外部能解析到什么：插件入口、`./package.json`（元数据读取需要）、
  以及可选的 `./locale/*.json`。

## 2. pnpm ≥10 的构建脚本拦截（仓外最常见的第一道坎）

pnpm 10+ 默认拦截依赖的 install/build 脚本，未 allowlist 的脚本是**硬失败**：

- 失败被归类为 `build-blocked`，匹配 `/ERR_PNPM_IGNORED_BUILDS|Ignored build scripts/`
  （`packages/boot/plugin-manager/src/install-failure.ts:22`）。
- pnpm 会在 `<profileDir>/pnpm-workspace.yaml` 的 `allowBuilds` 下留一个占位字面量
  `set this to true or false`；把它改成 `true` 即放行（`packages/boot/plugin-manager/src/build-approval.ts:27`）。
  该文件必须是 YAML 映射，且 `allowBuilds` 不能用锚点/别名。
- dsh 的放行流程是「写 `true` **并重跑安装脚本**」（`plugin_manager` 的 `installBundle` 在装包前
  先 `approveBuilds`，`packages/boot/plugin-manager/src/index.ts:474`）。**手工**只把占位符改成
  `true`、再对**已装好**的包跑一次 `dsh plugin add`，实测**不会**重跑安装脚本（pnpm 判依赖已存在，
  跳过构建步骤）⟹ 依赖构建脚本的副作用（如 postinstall 落位数据）不会发生。
  可复现的补跑方式是经 dsh 的放行流程，或 `dsh plugin --profile <p> remove <pkg>` 后再 `add`。
- git 安装时 dsh 直接给出修法：`dsh: git-hosted plugins build on install via their prepare
script, which pnpm blocks until allowed — add the exact key pnpm printed above under
allowBuilds in <profileDir>/pnpm-workspace.yaml, then re-run`
  （`apps/cli/src/plugin.ts:82`）。
- 本仓自己的 `pnpm-workspace.yaml` 也遵守同一机制：`allowBuilds: esbuild: true`（删掉则 `install`/`build` 失败）。

## 3. 三种分发形态

| 形态                | 用户侧成本                                       | 作者侧要求                                                              |
| ------------------- | ------------------------------------------------ | ----------------------------------------------------------------------- |
| 发布到 npm（推荐）  | 无构建授权                                       | 发布前构建好产物，把产物目录与 patch 放进 `files`                       |
| git 安装            | 需 `allowBuilds` 授权，且授权=允许安装期执行代码 | 提供自包含 `prepare`（不能假设旁边有 monorepo checkout）；建议锁 commit |
| `pnpm pack` tarball | 无构建授权                                       | 同 npm，交付 `.tgz`                                                     |

三种形态与 `prepare`/`allowBuilds` 的完整叙述见 `docs/user/develop/basic/publish.zh.md`。
仓外自查：`pnpm pack --dry-run`（本仓 `pnpm pack:check`）确认 tarball 里真的有入口与 patch 文件——
`files` 写错的代价是用户侧启动失败，而不是安装期报错。

## 4. 失败串 → 成因 → 修法

| 观察到的串                                                                                           | 成因                                                | 修法                                                   |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------ |
| `patch: entry "<id>" not found`                                                                      | 新挂载写成了裸 `- id/name`（覆盖语义），或 id 拼错  | 用 `- insert: [...]` 包裹                              |
| `patch: id is required for non-insert patches`                                                       | 没有 `insert:` 也没写 `id`                          | 补 `insert:` 或 `id`                                   |
| `patch insert: entry "<id>" is not a group`                                                          | 对非 group 行做嵌套 insert                          | 改为顶层插入                                           |
| `invalid config:` … `(at <path>)`                                                                    | `Config` 校验失败（含必填字段缺省）                 | 在 patch 的 `config` 里写全必填项                      |
| `dsh: failed to read overlay <file>`                                                                 | patch 文件没进 npm `files`，或路径写错              | 把 patch 加进 `files`                                  |
| `dsh.bundle.patch must be a file path or a list of file paths`                                       | `patch` 类型不对                                    | 改成字符串或字符串数组                                 |
| `dsh: warning: <name> declares no dsh.bundle — installed as a plain dependency, not a profile layer` | 包没声明 `dsh.bundle`                               | 补 `dsh.bundle.patch`（见 `mounting-and-manifest.md`） |
| `ERR_PNPM_IGNORED_BUILDS` / `Ignored build scripts`                                                  | 构建脚本未授权                                      | 在 profile 的 `allowBuilds` 放行                       |
| `Plugin <name>@<version> is incompatible with dsh <runtime>`                                         | peer 版本门禁                                       | 对齐 peer 范围，或按提示申请精确版本豁免               |
| `duplicate loader entry id`                                                                          | **0.1.7-rc.2 与 0.2.0-rc.2 均不出现**（旧笔记遗留） | 同 id 是 last-wins 静默覆盖，改掉重复来源              |

## 5. 本仓已验证的两个可复用模式

这两条不是 dsh 官方契约，而是本仓在 `@yanqd0/dsh-dev-dsh` 上跑通并测试过的工程做法，
可整体搬到别的仓外插件仓库。

**模式 A：随包安装一份 skill（或任何随包分发的数据）**

- `skill/` 是单一真源；构建期整目录拷进 `dist/skill`（tsup 不拷非 TS 资产，需要一步脚本）。
- 两个触发点：`package.json` 的 `postinstall`（npm 总会跑，pnpm 可能被拦）与宿主 `apply()`
  内的同步（保底路径）。
- 同步是 content-sync：目标与源**整树一致**就不动（避免每次开会话抖动）；目标是 symlink 则永不覆盖
  （开发流用符号链接接管该目录）；任何失败只记一行并返回失败标记，**绝不让插件加载或包安装失败**。

**模式 B：把上游事实做成可校验台账**

- 每条被引用的上游事实记 `<repo>@<tag>`、`path`、可选 `line`。
- 元数据断言始终跑；"checkout 存在时逐条复核"是**可选**路径：`3rdp/` 之类参考树在测试/生产环境
  不存在，缺失必须静默跳过，不能阻塞构建、安装或 `pnpm test`。
- 好处：dsh 升级后失效的不是"某段过期文档"，而是一条可定位、可一次性列出的条目。
