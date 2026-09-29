# 挂载与清单：patch 语义、层序、包清单字段

本文是 `SKILL.md` 的分册，回答「仓外插件怎么被挂上去、清单哪些字段真正起作用」。
每条结论后括号内是快照 `deepseek-harness@dsh-v0.1.7-rc.2` 里的出处；行号随版本漂移，
`src/facts.test.ts` 会在 `3rdp/` 存在时逐条复核。官方完整叙述见
`docs/user/develop/basic/publish.zh.md`，本文只补它没写透的失败面。

## 1. 两种 manifest，不要混

- **bundle**：npm 包 + 配置层，声明 `dsh.bundle`。唯一必填字段是 `patch`，类型
  `string | string[]`（`packages/util/package-manifest/src/types.ts:69`）。
- **profile**：`$DSH_HOME/profiles/<name>/` 下的目录，声明 `dsh.profile.bundles`（有序包名数组）。
  它由 dsh 的 `plugin_manager` 与安装后的 reconcile 维护，**不要手写**——`dsh plugin add` 只是
  pnpm 透传，见 §5。
- 没有 `dsh.bundle` 的包仍可安装，但只算普通依赖，dsh 会打印
  `dsh: warning: <name> declares no dsh.bundle — installed as a plain dependency, not a profile layer`
  并跳过它（`packages/boot/plugin-manager/src/operations.ts:102`）。

## 2. 读 patch 文件

`dsh.bundle.patch` 指向的文件在**已安装包的目录**里被读取，所以：

- patch 文件必须列入 npm `files`。漏了会在启动时抛
  `dsh: failed to read overlay <file>: <error>`（`packages/boot/app-boot/src/index.ts:340`）——
  这类失败是**启动失败**，不是警告。
- `patch` 不是字符串或字符串数组时抛
  `dsh.bundle.patch must be a file path or a list of file paths`
  （`packages/boot/app-boot/src/profile.ts:58`）。
- 多个 patch 文件按数组顺序作为**同一层**应用（`packages/boot/app-boot/src/profile.ts:654`）。

## 3. patch 语义：`insert:` 追加，裸条目覆盖

`vendor/include/src/index.ts:57` 的 `applyEntryPatches` 是唯一实现（`--dump-config` 与启动共用同一份）：

- **带 `insert:`**：把 `insert` 里的行追加进当前列表（`vendor/include/src/index.ts:79`）。
  若该 patch 自己还带 `id` 且命中了已有行，则要求那行是 group，新行被 push 进它的 `config`；
  命中失败给 `patch insert: entry %C not found`，目标不是 group 给
  `patch insert: entry %C is not a group`（`vendor/include/src/index.ts:83`、`:87`）。
- **不带 `insert:`**：必须有 `id`，否则警告 `patch: id is required for non-insert patches` 并跳过
  （`vendor/include/src/index.ts:105`）。命中行后按字段逐个赋值 `target[key] = value`，
  所以 `config` 是**整体替换**，不是深合并；`name` 是断言而非改名，不一致时警告
  `patch: name mismatch for %C (expected %C, got %C), skipping`（`vendor/include/src/index.ts:111`、`:116`）。
- 所有命中失败都以 `patch: entry %C not found` 形式出现（如 `patch: entry "dsh-dev-dsh" not found`），
  由 loader logger 渲染 `%C` 为带引号的 id（`vendor/include/src/index.ts:241`）。

> 仓外最常踩的一条：新挂载必须写 `- insert: [...]`。写成裸 `- id: x` 就变成"覆盖"，
> 目标行不存在时只留一条警告，插件静默不生效。

## 4. 同 id 二次挂载：last-wins，不报错

0.1.7-rc.2 没有重复 id 的抛错。`EntryGroup.create` 用 `this.tree.store[id] ??= new Entry(...)`
复用同一 entry（`vendor/loader/src/config/group.ts:20`），`ensureId` 只给**缺 id** 的行生成随机 id
（`vendor/loader/src/config/tree.ts:51`）。因此：

- 同一 id 出现在两层（例如 profile 手写的 `cordis.patch.yml` 与你的 bundle patch）**不会**抛
  `duplicate loader entry id`（该串在本快照中不存在，只出现在归档笔记引用的旧文件里）；
- 实际行为是后应用的层**静默复用/替换**该 entry，profile 照常启动；
- 结论不变：两者只能留其一，否则配置被静默覆盖，比报错更难排查。

## 5. 层序与验证

生效配置按层组合，后应用者按行胜出：

1. `dsh.profile.bundles` 里各 bundle 的 patch，按列表顺序；
2. profile 自己的 `<profileDir>/cordis.patch.yml`（bundle 层收集完之后才读取并追加为最后一层，
   `packages/boot/app-boot/src/profile.ts:684`）；
3. `$DSH_HOME/cordis.patch.yml`；
4. 每个 `--patch <path>` overlay，按 argv 顺序。

验证手段（不需要浏览器）：

```sh
dsh --profile <p> --dump-config          # 看 "# == <你的包名>" 层是否存在
dsh plugin --profile <p> add <pkg>       # 装包；成功后由 dsh 追加进 dsh.profile.bundles
dsh plugin --profile <p> remove <pkg>    # 依赖与层一起移除
```

`dsh plugin` 把参数**原样转发给 pnpm**（`add` / `remove` / `why` / `list` …），
只拦截 `allow-version` / `revoke-version` / `version-exemptions`；没有 `dsh plugin list`，
也没有 `dsh profiles`（`apps/cli/src/args.ts:191`、`apps/cli/src/plugin.ts`）。
两处命令与层序的权威叙述在 `apps/cli/reference/README.zh.md`。

### 5.1 `add` 什么时候才真的写进 `dsh.profile.bundles`

`add` 本身不碰 bundles。**安装成功**之后 dsh 才做 reconcile：遍历 profile 里「**第一次出现**的依赖」，
声明了 `dsh.bundle` 的追加进 bundles 并加载其 patch
（`packages/boot/plugin-manager/src/operations.ts:242`、`:255`）。由此三个可观测行为：

- `pnpm add` 退出码非 0（最典型是 `ERR_PNPM_IGNORED_BUILDS`）⟹ 不追加、不加载 patch。
  先按 `build-and-pitfalls.md` §2 放行构建脚本，再重装。
- reconcile 只看**新**依赖。依赖已在 `node_modules` 里时，再跑一次 `add` 不会重试这一步；
  用 `dsh plugin --profile <p> remove <pkg>` 再 `add` 才是可复现的重试路径。
- 层内的 entry **id 落定在 boot**：`add` 阶段 profile 目录还没有 `cordis.yml`，
  要看实际挂载的 id 与 `config`，用 `--dump-config`，不要看 `add` 的输出。

> 实测（dsh `0.2.0-rc.1`，干净 profile）：未放行构建脚本时 `add` 退出码 1、bundles 不变；
> 放行后 `remove` + `add` 退出码 0、bundles 追加该包，`--dump-config` 出现
> `id: dsh-dev-dsh` / `name: '@yanqd0/dsh-dev-dsh'` / `config: {}`，0 条 patch 警告。

## 6. 清单字段中真正被读的那些

- **`exports`**：显示元数据（title/description/icon）经 Node ESM resolver 读
  `<pkg>/package.json` 与 `<pkg>/locale/en.json`，因此要让前者可解析；`ERR_PACKAGE_PATH_NOT_EXPORTED`、
  `ERR_MODULE_NOT_FOUND`、`MODULE_NOT_FOUND`、`ENOENT`、`ENOTDIR` 都按"资源缺失"处理，
  只降级显示、不报错（`packages/boot/app-boot/src/package-meta.ts:61`）。
- **peer 兼容门禁**：只检查 `peerDependencies` 里名为 `@deepseek-ai/dsh` 或 `@deepseek-ai/dsh-*` 的项，
  不匹配时打印 `Plugin <name>@<version> is incompatible with dsh <runtime>: peerDependencies ...`
  并给出 `dsh plugin allow-version` 豁免路径（`packages/boot/app-boot/src/plugin-compatibility.ts:98`）。
- **依赖三分**：需要与宿主共享实例的 dsh 包同时进 `peerDependencies` 与 `devDependencies`；
  独立版本的第三方依赖与无状态 dsh 工具包进 `dependencies`（`docs/user/develop/basic/publish.zh.md`）。
- **`engines`**：`dsh` / `node` / `npm` 只是声明，注释明说 "DSH compatibility is declarative until
  a reader enforces it"，当前没有 reader 读取（`packages/util/package-manifest/src/types.ts:22`）——
  写成什么都不会被校验，别把它当兼容性保证。

## 7. 入口形态

function plugin 具名导出 `name` / `inject` / `Config` / `apply`，或**单个** default 对象；
两种形态不可混用。上游约定见 `packages/AGENTS.md` 的 "Plugin exports" 一条。
混用的后果与用法见 `host-entry-and-di.md`。
