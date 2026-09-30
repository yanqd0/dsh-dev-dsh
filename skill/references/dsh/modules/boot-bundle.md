# 模块：boot + bundle + apps（启动、装配与启动器）

> 本文是 `references/dsh/modules/index.md` 的子页；索引与页契约见该页。
>
> **范围**：`packages/boot`、`packages/bundle` 与 `apps/` 对外给什么——profile 怎么叠层、bundle 与 patch 的字段与语义、
> 启动器解析什么、哪些是应用面不能 fork 的。层序与失败判定的链路走查见 `references/dsh/composition-and-boot.md`；
> 运行期安装 / 启停 / reconcile 见 `references/dsh/plugin-management.md`。
> **事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`。字段级契约以清单类型与 patch 读取器为准。
> 上游权威：`packages/boot/README.zh.md`、`packages/bundle/README.zh.md`、`apps/cli/README.zh.md`、
> `apps/cli/reference/README.zh.md`（模式、层序与 dump）、`apps/cli/composition.md`（逐 profile 的生成装配图）；
> 清单字段 `packages/util/package-manifest/src/types.ts`、profile 读取与 patch 语义
> `packages/boot/app-boot/src/profile.ts` 与 `vendor/include/src/index.ts`。

## 1. 包 / 对外提供

| 包                                   | 对外提供                                                             | 形态       | Config | 说明                                                         |
| ------------------------------------ | -------------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------ |
| `boot/app-boot`                      | `ctx.dshHomePath`；声明 `pluginPackages`、`profileContext`           | 插件       | 无     | 应用侧启动粘合：`.env`、Loader 守卫、配置解析、启动序列      |
| `boot/cmdline`                       | `ctx.cmdlineArgs`、`ctx.appExit`、`ctx.appReady`                     | 插件       | 无     | 把不可变 argv 交给应用插件                                   |
| `boot/config-editor`                 | `ctx.configEditor`                                                   | 插件       | 无     | 经 profile patch 持久化插件配置并触发重载对齐                |
| `boot/hmr`                           | `ctx.hmr`                                                            | 插件       | 有     | 模块 + profile 配置的协同热重载                              |
| `boot/plugin-manager`                | `ctx.pluginManager`                                                  | 插件       | 有     | 当前 profile 的插件 / 组合包管理（CLI、Web、agent 工具共用） |
| `bundle/base`                        | 无（`export {}`，实质是 patch 文件）                                 | **bundle** | 无     | 共享第一层：主干插件行都挂在这一层                           |
| `bundle/web-app`                     | `ctx.webStartup`、`ctx.webRuntime`                                   | bundle     | 有     | 浏览器面（web profile 的第二层）                             |
| `bundle/headless`                    | `ctx.headlessStartup`                                                | bundle     | 有     | 一次性 CLI 任务面                                            |
| `bundle/acp-app`                     | `ctx.acpAppStartup`                                                  | bundle     | 无     | 自动化 ACP stdio 面                                          |
| `bundle/sdk-app`                     | `ctx.sdkAppStartup`                                                  | bundle     | 有     | SDK JSON-RPC stdio 面                                        |
| `bundle/sdk-minimal`                 | 无（完整独立树，不叠 base）                                          | **bundle** | 无     | 刻意不套 base 的最小组合                                     |
| `apps/cli`                           | 无（启动器；向被启动的树 provide `profileContext`/`pluginPackages`） | **应用**   | 无     | **唯一受支持的 Node 应用启动器**                             |
| `apps/web`                           | 无（构建产物：浏览器入口）                                           | **应用**   | 无     | Vite 入口，被 web profile 服务                               |
| `apps/desktop` / `apps/desktop-host` | 无（私有 Electron 壳与宿主进程）                                     | **应用**   | 无     | 未发布；`desktop` profile 名保留                             |

## 2. 挂载点的字段与语义（仓外最常碰的部分）

- **profile** 是 `$DSH_HOME/profiles/<name>/` 下的 `package.json` + `cordis.patch.yml`；
  `dsh.profile.bundles` 是**有序**的组合包层列表。启动器内置模板（`web` / `headless` / `acp` / `sdk` / `sdk-minimal`），
  默认层是 `@deepseek-ai/dsh-base`。
- **bundle** 靠 `dsh.bundle.patch: string | string[]` 声明 patch 文件（相对包根）；一个包没有 `dsh.bundle` 时
  仍然可以安装，只是**不会成为 profile 层**（安装器只给一句警告，不报错）。
- **层序**：各 bundle 层 → profile 自己的 `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → `--patch` overlay（按 argv 顺序）。
  **最后的层赢**；命中同 `id` 的 patch **整份替换该行的 `config`（不是合并）**。
- **patch 条目**：`insert` 追加新行（无 `id` 追加到根，带 `id` 追加到某个 `group` 行的子行）；非 insert 必须给 `id`；
  `name` 只作错配守卫（不匹配就 warn + 跳过）；整份输入会被结构化克隆，因此同一文件里后面的 patch 可以定位前面插入的行。
- **相对 `name` 会按 patch 文件所在目录改写成 file URL**；被引用的 patch 文件读不到会**抛错并让启动失败**。
- **行顺序没有加载语义**：激活由服务可用性驱动，不由行序决定。

## 3. 能替换 / 不能碰

- **能替换**：发布自己的 bundle（`dsh.bundle.patch`）；用 profile patch 覆盖内置行；用 `--patch` 做一次性实验；
  用 `ctx.pluginManager` 或 `dsh plugin` 管理 profile 的依赖。
- **不能碰**：`apps/*` 不是 Cordis 插件（没有 `Context`/`Events`/`apply`），**不要试图给应用打补丁**——扩展点是 profile 层。
  启动器的 flag 解析与 "只有 `dsh` 能启动 Node 应用" 的约定也不要绕。
- **启动器预置键**（`profileContext`、`pluginPackages`、`cmdlineArgs`）由 bin 在 Loader 行之前 provide；
  插件只消费，不自行 provide。

## 4. 易错点

- **patch 是替换不是合并**：只想改一个字段也要把该行 `config` 写全，否则丢配置。
- **命中失败只 warn**：写错 `id` 的 patch 会静默跳过（启动照常），排查时先看启动日志里的 warn。
- **`dsh <name>` ≡ `--profile <name>`**，但 `dsh plugin` 是子命令，所以名为 `plugin` 的 profile 必须写 `--profile plugin`；
  `desktop` 名字保留给 Electron profile。
- **`--dump-config` / `--dump-default-config` / `--dump-config-schema` 互斥**。
- **HMR 只监视 profile manifest 与两份用户 patch**：默认 bundle 层的改动需要重启；启用 HMR 时配置改动即时生效。
- **`sdk-minimal` 不叠 base**：它的 insert 就是完整树，但用户层 / home 层 / `--patch` 仍然会叠在它之上。

## 5. 源码最后手段

- 只看一条事实：`git -C 3rdp/deepseek-harness show deepseek-harness@dsh-v0.2.0-rc.2:<path>`（只读，不切换工作树）。
- 本页引用的每条上游路径都在 `src/facts.test.ts` 有台账条目；失效时测试按条目报出来。
