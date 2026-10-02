# 运行期插件管理：安装、启停与 reconcile

> 本文是 `references/dsh/index.md` 的子页。
>
> **范围**：一棵已经起来的插件树在运行期怎么被改——安装 / 删除组合包、启停条目、选择组合包层、兼容性豁免与重载。
> 启动与层序见 `references/dsh/composition-and-boot.md`；清单字段与 patch 写法见 `references/develop/mounting-and-manifest.md`。
> **事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`。本页写改动链路与残留语义，不堆类型。
> 上游权威：`packages/boot/plugin-manager/README.zh.md`、`docs/subsystems/boot.zh.md`（服务方法）、
> `apps/cli/reference/README.zh.md`（`dsh plugin` 命令面）。

## 1. 两条入口，一套实现

- **CLI**：`dsh plugin --profile <p> <pnpm 参数>` 把参数**原样转发给 pnpm**（`add` / `remove` / `why` / `list` …），
  只额外拦截 `allow-version` / `revoke-version` / `version-exemptions`。没有 `dsh plugin list`（转发给 pnpm），
  也没有 `dsh profiles`。
- **服务**：`ctx.pluginManager`（`packages/boot/plugin-manager`）。Web 侧边栏的**插件**页与 Creator 模式里的
  `plugin_manager` 工具都通过它操作；工具调用需要 `danger-full-access` 或本次调用的批准。
- 两者共用 `operations.ts` 里的包管理操作，并共用 profile manifest 的**写锁**（并发包操作与 manifest 写入互斥；
  HMR 不取该锁，pnpm 在 HMR 队列之外执行）。CLI 继承终端、输出不捕获因而不受空闲上界约束；服务捕获输出并受
  `idleTimeoutMs` 约束，超时按 `timeout` 归类且不再问下一个注册表。

## 2. 安装链路：`dsh plugin add` 到底改了什么

顺序是**先查、再装、后 reconcile**：

1. **inspect**：注册表包名走 `pnpm view`（在 profile 目录里跑，继承代理与认证）；绝对路径读它的 `package.json`；
   git / tarball 只回答自己的形式与被拉取的 host。答复带 `problem`：`invalid-spec`、`already-installed`、
   `not-found`、`not-a-package`、`not-a-bundle`、`network`、`unknown`。
2. **兼容性检查**：registry spec 在 pnpm 启动**之前**判 DSH peer（不兼容就不下载、不跑构建脚本）；
   git / tarball 必须先抓取，因此在安装**之后**判定并走回滚路径。
3. **pnpm**：按计划的注册表顺序执行；GitHub 仓库在启动 pnpm 前先做一次有界连接检查
   （`githubConnectionTimeoutMs`，默认 5000ms；只有网络失败与超时会停止安装）。
4. **reconcile（关键）**：`add` 本身**不碰** `dsh.profile.bundles`。安装成功后，管理器遍历 profile 里
   **第一次出现**的依赖，把声明了 `dsh.bundle` 的追加进 `dsh.profile.bundles` 并加载它的 patch。
   由此产生三条可观测行为：
   - `pnpm add` 退出码非 0（最典型是 `ERR_PNPM_IGNORED_BUILDS`）⟹ 不追加、不加载 patch；
   - reconcile 只看**新**依赖：依赖已在 `node_modules` 里时再跑一次 `add` 不会重试这一步，
     可复现的重试路径是 `dsh plugin --profile <p> remove <pkg>` 再 `add`；
   - 层内 entry 的 id 落定在 **boot**：`add` 阶段 profile 还没有 `cordis.yml`，要看实际挂载的 id 与 `config`
     用 `--dump-config`，不要看 `add` 的输出。

**回滚语义**：失败、被取消，或装入了没有 bundle patch 的包时，管理器把 `package.json` 与 `pnpm-lock.yaml`
恢复成 pnpm 运行前的快照；已下载的文件、构建脚本副作用、`pnpm-workspace.yaml`（记录待审批构建名）**不**回滚。

## 3. 依赖构建脚本的拦阻

pnpm 拦截依赖构建脚本时，失败的安装在 `pendingBuilds` 里报告整个 profile 待决定的包名（包括先前尝试留下的），
并在 `pnpm-workspace.yaml` 的 `allowBuilds` 下留一个占位字面量：

- Web 插件页提供「允许这些脚本并重试」；工具侧可用 `install_bundle` 的 `approvedBuilds` 代为授权
  （用户批准后），服务只校验待决定的名字，不核实对话历史。
- 授权按包名保存在当前 profile，允许以宿主用户权限执行命令，并在再次安装失败后保留。
- 只能批准当前**未决定**的名字；已有拒绝与通配规则不能被覆盖；`allowBuilds` 里出现 YAML 锚点或别名时拒绝授权。
- 手工修改只应把占位符改成 `true`，不要手写新条目。

## 4. 启停条目与选择组合包层

- **启停插件**：只更新 profile 的 `cordis.patch.yml` 中**最后一条匹配覆盖项**的 `disabled`；没有匹配项时追加。
  匹配依据是条目 id 与覆盖项声明的模块名。agent preset 条目保持只读。
- **选择组合包层**：修改 `package.json` 的有序 `dsh.profile.bundles`。关闭**保留**依赖；开启则追加到列表末尾，
  因此可能改变配置优先级。home 级 patch 与本次启动的 `--patch` 仍然优先级更高。
- 变更**跨会话持久**并影响使用该 profile 的所有会话；已安装的 Host 代码在宿主进程内运行，不受工作区沙箱限制
  （开发含义：插件自己的子进程同样不受会话文件沙箱约束，见 `references/develop/subprocess-and-trust.md`）。
- 已选择但加载失败的组合包仍会出现在 `listBundles` 中并带 `error`：`enabled` 表示**保存的选择**，不代表加载成功。
- 每次完成的操作发 `plugin-manager/changed`；在管理器之外应用的 patch 代（HMR 监视到 CLI 或手工编辑后）
  **不发**通知，界面要到下一次读取才知道。

## 5. 版本兼容性与豁免

- **门禁**：只检查 `peerDependencies` 里名为 `@deepseek-ai/dsh` 或 `@deepseek-ai/dsh-*` 的项，与当前运行时版本比较；
  未声明 DSH peer 时不施加约束，无效范围视为不兼容。启动时会再次独立检查（`skippedBundles`）。
- **豁免文件**：profile 自己的 `compatibility.json`（与 `package.json`、`cordis.patch.yml` 并列），
  把精确的 `package-name@version` 映射到精确 DSH 运行时版本列表。插件升级与 DSH 升级都**不继承**授权。
  文件损坏不阻止启动：可读的记录仍生效，被拒记录随插件拒绝信息一起输出，此后文件按只读处理。
- **命令与工具**：`dsh plugin --profile <p> version-exemptions` / `allow-version <pkg>@<ver> --dsh-version <runtime> --accept-risk` /
  `revoke-version …`；服务侧对应 `list_version_exemptions` / `set_version_exemption`，授权要求 `acceptRisk: true`。
- **生效时机**：下次组合时生效。在线 profile 会重新组合并在当前会话里挂载（结果 `applied`）；
  仅启动型 profile 保留当前条目并报 `restart-required`。

## 6. 重载边界

- HMR 启用时，配置变化立即生效：HMR 串行执行模块重载、文件监视与管理写入，每次刷新重新读取组合包选择与
  patch 层，更新原根 Include，并等待被移除插件释放、Loader 树稳定；未启用 HMR 时运行中的组合保留到重启
  （`references/dsh/composition-and-boot.md` §6）。
- **替换已加载包的代码需要重启进程**才能加载新的 JavaScript 模块版本；仅启动型 profile 不能删除当前进程
  启动时用的包，需要停进程后用 `dsh plugin`。
- 管理器直接读文件与 Loader 状态，不维护第二份目标状态注册表。

## 7. 失败行为

| 操作                          | 处理                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------ |
| 安装：pnpm 或 bundle 校验失败 | 恢复 `package.json` 与 `pnpm-lock.yaml` 快照；已下载文件可能保留；报告安装失败 |
| 启用：保存选择或加载失败      | 保留已安装依赖与已保存的选择；报告启用失败，允许修正、停用或卸载               |
| 卸载：任一步失败              | 停在失败步骤，保留已完成改动与待重试删除的依赖；不重新启用组合包               |

卸载依次执行：从 `dsh.profile.bundles` 移除 → 卸载运行时贡献 → `pnpm remove`；任一步失败都不继续。
完整配置项（`pnpmCommand`、`registry`、`fallbackRegistries`、`outputBytes`、`lockWaitMs` 等）与注册表顺序规则见
`packages/boot/plugin-manager/README.zh.md`。

## 8. 源码最后手段

- 只看一条事实：`git -C 3rdp/deepseek-harness show deepseek-harness@dsh-v0.2.0-rc.2:<path>`（只读，不切换工作树）。
- 本页引用的每条上游路径都在 `src/facts.test.ts` 有台账条目。
