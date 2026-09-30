# 运行时与工具链：peer 门禁、安装链路、HMR 与 loader 语义

本文是 `references/dsh/versions/0-1-5-to-0-2-0/index.md` 的子页。**默认不读**：只有从 0.1.5 线升级、或要解释
「为什么旧插件装得上却起不来」时才进这里。

上游事实出处：`deepseek-harness@dsh-v0.2.0-rc.2`（对照 `dsh-v0.1.5-rc.3` 与 `dsh-v0.1.7-rc.2`）。

## 1. 改了什么

### peer 兼容门禁（本窗口首次出现）

- `packages/boot/app-boot/src/plugin-compatibility.ts` 在 0.1.5 上**不存在**；0.1.7 起，启动与安装都会先判
  peer：只看 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*`，`includePrerelease: true`，`workspace:^` / `~` / `*`
  视为「当前运行时」。不满足即产出：

  > `Plugin <name>@<version> is incompatible with dsh <runtime>: peerDependencies {…}. Running it may cause crashes or data loss. …`

- 同窗口出现「精确版本豁免」命令：`dsh plugin allow-version <pkg@version> --dsh-version <exact> --accept-risk`、
  `revoke-version`、`version-exemptions`（0.1.5 的 `apps/cli/src/plugin.ts` 里没有 `allow-version`）。
- 判定与预检的接线见 `references/dsh/plugin-management.md` §5，机制主干见 `references/dsh/composition-and-boot.md`。

### 安装 / reconcile 从 CLI 内联迁到独立包

0.1.5 的 `dsh plugin` 是「pnpm 转发 + 按**已装状态** reconcile `dsh.profile.bundles`」，逻辑就在
`apps/cli/src/plugin.ts`。0.1.7 起这块能力变成 `packages/boot/plugin-manager`（当时是新包）：

- profile 由**应用**拥有的包管理器接管（Web 侧边栏 / agent 工具都能装、删、启停、选组合包）；
- 新增依赖构建脚本审批（pnpm 的 `allowBuilds` 占位）、失败分类与回滚语义；
- `dsh plugin` 仍然是 pnpm 透传，但参数解释、兼容性预检与 reconcile 都走新实现。

失败面与豁免细节见 `references/dsh/plugin-management.md` 与 `references/develop/build-and-pitfalls.md`。

### HMR 换包、默认开

base 层的 `hmr` 行在两个 tag 上完全不同：

|               | 0.1.5                                                           | 0.1.7                      |
| ------------- | --------------------------------------------------------------- | -------------------------- |
| 模块名        | `@deepseek-ai/cordis-plugin-hmr`（vendored cordis 包）          | `@deepseek-ai/dsh-hmr`     |
| 默认          | `disabled: true`（模块重载按 profile `patchReload: live` 选择） | 有 `profileContext` 即启用 |
| `config.root` | `['.']`                                                         | `[]`                       |

`@deepseek-ai/dsh-hmr`（新包）把模块替换、Include 刷新与 profile 配置变更放进**同一个协调队列**；启动器提供
`profileContext` 时 base 组合包默认启用它，profile 清单与两份用户 patch 的改动会被事务式重载。包安装 / 删除
在该队列之外执行。详见 `references/dsh/composition-and-boot.md` §6。

### 其余新增

- `packages/boot/config-editor`（新包）：配置面的读写入口。
- CLI 新增 `--dump-config-schema`（`apps/cli/src/dump-config-schema.ts`，0.1.5 没有）；启动失败报告改为落
  `$DSH_HOME/logs/startup-<ISO>-<uuid>.log`（`apps/cli/src/startup-diagnostics.ts`，0.1.5 没有）。
- 客户端 combo 引用改为**相对文档**（`packages/client/modules/src/client/manifest.ts` 的注释变化）。
- skill 提供方改用 `realpath` 解析（`packages/skill/skill-filesystem/src/index.ts`）——符号链接目录的行为随之变化。

### loader 同 id 语义翻转

0.1.5 的 `vendor/loader/src/config/group.ts:64` 会抛 `duplicate loader entry id: <id>`；0.1.7 该检查消失，
`create` 变成 `this.tree.store[id] ??= new Entry(...)`：同 id 二次挂载是 **last-wins 静默复用**。当前语义见
`references/develop/mounting-and-manifest.md` §4。

## 2. 为什么坏

- **peer 门禁是本窗口最硬的破坏源**：0.1.5 时代写下的 `@deepseek-ai/dsh*` peer 范围在新运行时上通常不满足
  （prerelease 参与范围；`^0.1.5` 不等于「任何 0.1.x」的宽松承诺），安装或启动阶段直接判不兼容。豁免是**精确**
  的：`插件名@版本` × `运行时版本`，换一个 rc 就要重批。
- **配置里还写着旧模块名**：任何引用 `@deepseek-ai/cordis-plugin-hmr` 的 profile patch 在新版解析失败。
- **同 id 覆盖不再报错**：靠 `duplicate loader entry id` 暴露冲突的自动化失效，冲突变成静默覆盖。
- **HMR 默认开**：0.1.5 里「配置改完等重启」的预期不再成立，改动会立刻生效（这也意味着错误的改动立刻生效）。
- 客户端 bundle 引用按绝对路径拼装的实现，在相对文档语义下会指错位置。

## 3. 升级要动什么

1. `package.json` 的 `@deepseek-ai/dsh*` peer / dev 对齐到新运行时；确实不兼容又必须跑，才用
   `dsh plugin allow-version … --accept-risk` 精确豁免。
2. profile 配置：`hmr` 行改成 `@deepseek-ai/dsh-hmr`；删除 0.1.5 的 `patchReload` 声明（字段已移除，见
   `manifest-and-packages.md`）。
3. 安装路径：改用 `dsh plugin --profile <p> add|remove`，并预期构建审批与失败分类；不要手写
   `dsh.profile.bundles`（reconcile 负责）。
4. 复核：`dsh --profile <p> --dump-config` 看实际挂载 id / config / disabled，启动失败先看
   `$DSH_HOME/logs/` 下的报告（`references/dogfood/runtime-evidence.md` §3）。

## 4. 静默失效

1. peer 范围过期：安装期不一定报，启动门禁才拦。
2. 同 id 覆盖从「报错」变「静默生效」。
3. 依赖 `patchReload` 控制重载时机的假设。
4. 假设 HMR 默认关（改动会在下一次事务里立刻生效）。
5. 把客户端 combo URL 当绝对路径；把 skill 目录当普通目录（`realpath` 之后符号链接语义变了）。

## 5. 复核（只读）

```bash
git -C <checkout> diff dsh-v0.1.5-rc.3 dsh-v0.1.7-rc.2 -- packages/bundle/base/cordis.patch.yml | grep -A6 'id: hmr'
git -C <checkout> diff dsh-v0.1.5-rc.3 dsh-v0.1.7-rc.2 -- vendor/loader/src/config/group.ts
git -C <checkout> show dsh-v0.1.5-rc.3:packages/boot/app-boot/src/plugin-compatibility.ts
git -C <checkout> ls-tree --name-only dsh-v0.1.5-rc.3 packages/boot/
```

第一行给出 HMR 行的换包与默认值；第二行给出同 id 语义翻转；第三行会失败（文件在 0.1.5 不存在）——这正是
peer 门禁属本窗口的证据；第四行列出 0.1.5 还没有 `plugin-manager` / `hmr` / `config-editor`。

---

复核时不要引用本仓笔记里 `dsh-client-runtime` 的说法：该包名在本地三个 tag 上都不存在。
