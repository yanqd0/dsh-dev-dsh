# uv 子模块：宿主 uv 工具

> 本页是 `src/uv/` 的设计与取舍记录（试验性子模块 #1，plan #22）。
> 定位：本仓除「skill + 安装它的宿主插件」之外的**试验性小模块**；稳定后再考虑剥离为独立插件。
> 现象与证据都来自本机实测，不写「预期如此」。

## 1. 问题：uv 每次调用都要一次提权审批

本机 web profile 的文件策略是 `workspace-write` + Landlock（Landlock 只做部分强制，见运行时的 `landlock-run: partial enforcement`）。
uv 的常规操作会写会话工作区之外的路径（`~/.cache/uv` 及其 `simple-v24`、`wheels-v6`、`environments-v2` 等子目录），于是：

1. `bash` 里的 `uv …` 被沙箱拒绝，结果是 `[sandbox: file access denied under workspace-write mode]`；
2. 模型按工具提示把同一条命令重试为 `sandbox_permissions: danger-full-access`；
3. 每次重试都是一次用户审批。

一次真实会话里：

- 73 次 `bash` 调用，38 次带提权；uv 相关调用几乎全部提权，reason 形如
  `escalate sandbox to danger-full-access: uv 需要写全局缓存 ~/.cache/uv 才能运行 black/ruff/pytest…`；
- 其余 38 次提权也多为「工具链顺手要写 home」的同类场景。

也就是说：**痛点不是某条命令危险，而是沙箱把「uv 的常规工作」全部归到了提权档**。

## 2. 方案选择

### 2.1 采纳：宿主 `uv` 工具（插件进程内执行）

与该宿主的另一个进程内工具同构：插件自己的子进程不经过 `ctx.sandbox`——沙箱是 **bash 执行器**（`dsh-bash-sandbox`）在拼 `['bash','-c',cmd]` 时调 `ctx.sandbox.confine()` 施加的，`ctx.subprocess` 自身不施加限制。于是工具在插件进程内直接跑 uv：**无需授权、缓存与镜像配置照常可用、输出与退出码直通**。

代价是明确的：**uv 及其子进程不再受会话文件沙箱约束**。这不比用户当前逐次批准的 `danger-full-access` 重试更宽，但它从「每次手动批准」变成「一次配置信任」。

### 2.2 否决：把 uv 的 home 态目录重定向进工作区

uv 支持 `UV_CACHE_DIR`、`UV_PYTHON_INSTALL_DIR`、`UV_TOOL_DIR`、`UV_TOOL_BIN_DIR`（也可写进 `uv.toml`），把它们指向工作区内的目录确实能让沙箱放行、且不改一行代码。**但它会让全局缓存退化为项目级缓存**：

- 每个项目各存一份 cache（本项目的依赖含 numpy / opencv / scikit-image，体量不小），hardlink 去重失效，**全局磁盘占用显著增大**；
- `uv tool` 命令按官方配置文档**忽略项目级配置**，重定向仍不完整（要么写用户级配置 `~/.config/uv/uv.toml`、影响所有项目，要么只覆盖一部分命令）；
- 重定向后原缓存不被命中，等价于全量重下。

「影响所有项目」与「磁盘放大」这两条正是本机需要避免的，所以本子模块**不动 uv 的任何目录配置**，缓存继续留在 `~/.cache/uv`（工具内 `["cache","dir"]` 的输出就是它）。

### 2.3 其他被否决/未采纳的路

| 方案                                                   | 未采纳原因                                                                                                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 会话切 `danger-full-access`                            | 零开发，但整个会话（含非 uv 命令）失去文件沙箱；粒度太粗                                                                                                                       |
| 实验性 Auto review 预设                                | 逐次调用都要模型复核，多花 token，且仍可能放行/误杀                                                                                                                            |
| 自定义 `ctx.sandbox` provider 追加可写根               | 需要替换 base bundle 的 sandbox 服务并复刻 runner 选择与 profile 构建，成本与脆弱性都高；更适合作为上游 feature request（「可配置的额外可写根」）                              |
| 给 bash 里的 uv 提权做「同会话自动放行」的 approval 门 | 既有宿主工具的裸命令匹配只认裸命令，而实测 uv 调用大量是 `cd X && uv run …` / `uv run python - <<'PY'`；宽松匹配会把非 uv 提权一并放行。工具化用同一份能力达成目的且边界更清楚 |

## 3. 工具契约

- 名字 `uv`；参数 `args: string[]`（不含 `uv` 本身，误带开头的 `uv`/`uvx` 会被忽略）、可选 `cwd`、可选 `timeoutMs`。
- 执行：`ctx.subprocess.spawn({ argv: [<entry>, ...args], cwd, stdio: { stdin: 'ignore', stdout/stderr: collect+spill }, graceMs: 5000, signal, env })`。
  - 子进程环境 = subprocess 服务的凭据 scrub 之后再叠 `uv.passEnv`（从父进程取指定名）与 `uv.env`（显式键值）；
  - 超时与 `exec.signal` 融合到一个 AbortSignal 上，触发即走 managed-range 的终止流程；
  - 输出保留有界尾部（`maxOutputBytes`），完整流写入 spill 文件（`maxSpillBytes`），截断时在模型可见文本里给出 `[output truncated; full output: <path-or-(unavailable)>]`。
- 规范返回值：`{ ok, exitCode, stdout, stderr, notes }`。`notes` 按 bash 工具的既有标记拼写：`[timed out after <ms>ms]`、`[stopped: <reason>]`、`[killed by signal: <sig>]`、`[exit code: N]`（末位）。这套拼写是**本包的约定**，不是宿主契约。
- 渲染：stdout → `[stderr]\n…` → notes，逐行；全空输出 `(no output)`。

### 3.1 ask 类表（`src/uv/policy.ts` 的 pinned 常量）

| 类                                                 | 触发                                                                                                                                            | 授权理由                            |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `self-update`                                      | `self update`                                                                                                                                   | 替换 uv 自身二进制                  |
| `cache-clean` / `cache-prune`                      | `cache clean` / `cache prune`                                                                                                                   | 清空/裁剪共享缓存 `~/.cache/uv`     |
| `python-install` / `python-uninstall`              | `python install` / `python uninstall`                                                                                                           | 写/删 uv 管理的解释器（工作区之外） |
| `tool-install` / `tool-uninstall` / `tool-upgrade` | `tool …`                                                                                                                                        | 写/删全局工具与 bin（工作区之外）   |
| `publish`                                          | 任意 token 为 `publish`                                                                                                                         | 向包索引上传制品，不可撤销          |
| `auth`                                             | 任意 token 为 `auth`                                                                                                                            | 读写 uv 凭据存储                    |
| `pip-system`                                       | 含 `pip` 且（`--system` 或 `--python` 指向工作区外解释器）                                                                                      | 写项目环境之外的 Python             |
| `cwd-escape:<绝对路径>`                            | `--directory` / `--project` / `--cache-dir` / `--config-file` / `--target` / `--prefix` / `--root`，或工具 `cwd` 参数，解析后落在会话工作区之外 | 目标目录在工作区之外                |

判定细节：

- 匹配是 **argv token 级**，不是 shell 解析：`["run","python","-c","…uv cache clean…"]` 里的文本只是一个 token，不会被误判；
- 越界判定用 canonical 路径（存在则 `realpathSync`，可识别符号链接逃逸），不存在则用词法解析；
- 纯 help/version 调用（`--help` / `-h` / `--version` / `-V` / `help …`）永不过问；
- **未识别的调用一律放行**（默认放过），假阳性只导致「同会话多问一次」，因此规则表是常量 + 单测固定，而不是运行时从 `uv --help` 推断。

### 3.2 授权记忆

- 经 `ctx.approval.request({ agent, toolName: 'uv', callId, reason, signal })` 询问，写 `approval/asked` + `approval/decided` 审计对；
- `uv.grant: 'session'`（默认）按 `sessionId + classId` 记住 `allowed-once`，同一会话同类不再问；`'call'` 则每次问；
- `uv.autoApprove: true` 直接放行并在结果首行留痕；
- **fail closed**：没有 `approval` 服务、没有 `agent`（嵌套派发）、`unavailable`，一律不执行，并给出两条出路（改用 bash 走常规提权；或显式设 `autoApprove`）。

## 4. 配置与开启

默认 **`uv.enabled: false`**：本包是随 npm 发布的包，工具会把 uv 的执行从「受限」变成「不受文件沙箱约束」，默认开启等于替所有安装方改安全姿态。

在 profile 的 `cordis.patch.yml` 追加覆盖行即可开启（profile 层在 bundle 层之后生效，last-wins；同 id 并存不报错）：

```yaml
- id: dsh-dev-dsh
  config:
    uv:
      enabled: true
      # entry: ~/.local/bin/uv    # 缺省按 PATH 解析 `uv`
      # timeoutMs: 600000         # 单次上限，默认 10 分钟
      # passEnv: [UV_INDEX_URL]   # 需要私有索引凭据时显式放行
```

改完需要重启 harness：跑着的 dsh 进程持有它加载时的 `dist` 模块（`src/**` 改动先 `pnpm build`）。

## 5. 已知限制

- **信任边界**：只要开启，`uv run` / `uvx` / 项目构建脚本就能在文件沙箱之外写任何地方，工具内的 token 扫描管不到 uv 子进程内部（例如 `uv run bash -c 'uv cache clean'`）。这与用户逐次批准的 `danger-full-access` 等价，只是把「每次确认」换成「一次配置」。
- 无 shell 语义：管道 / 重定向 / heredoc 需先落脚本文件再 `["run","python","<脚本>"]`，或退回 bash（继续走常规提权）。
- 无后台作业集成：长任务（大依赖的 `uv sync`）会阻塞到超时；`timeoutMs` 可调，但没有 `ctx.jobs` 的 detach/handoff（bash 工具那条路径仍在）。
- 无 Web UI 卡片：结果按通用工具卡呈现。
- 未注册 `isConcurrencySafe`：同一 agent 的多次 uv 调用按独占调度执行，避免并发写同一 `.venv`。
- 越界判定对**不存在**的路径只能做词法解析；symlink 指向不存在目标时可能漏判（沙箱自己也是 canonical 匹配，这是同一口径的残留缺口）。

## 6. 未来：剥离为独立插件

`src/uv/` 已经按可整目录搬走设计：只依赖 `node:*` 与 `zod`，宿主面走本地结构化类型（不 import `@deepseek-ai/*`），配置块自包含（`config.ts`），接线只在 `uv/index.ts`。剥离时需要：

1. 新建独立包，把 `src/uv/*` 移入 `src/`，加 `cordis.patch.yml`（`insert:` + 显式 `config`）与 skill；
2. 宿主入口改为模块级 `inject`（独立插件不必再为「skill 同步」保留无服务也能加载的语义）；
3. `notes/uv.md` 拆为独立仓的 `NOTES`/`docs`，本页保留一条指针。

## 7. 验收

- 单测：`pnpm test`（含 ask 规则表、越界判定、授权记忆、超时/取消/截断/失败面、注册降级）。
- 门禁：`pnpm test:coverage`、`pnpm check-types`、`pnpm lint`、`pnpm build`、`pnpm pack:check`。
- **组合级探针（可复现，worktree 内闭环）**：用隔离 `DSH_HOME`（`.tmp-accept/dsh-home`，gitignored）在 web profile 里按路径挂载 `dist/index.js` 并 `uv.enabled: true`，另加一个探针插件打印 `ctx.tools.schemas()` 并经真实注册表派发工具：

  ```bash
  DSH_HOME=.tmp-accept/dsh-home dsh web --no-open --port 0
  # [uv-probe] count=1 names=uv        → 真实组合下已注册
  # [uv-probe] >>> --version           → uv 0.12.8 (aarch64-unknown-linux-gnu)
  # [uv-probe] >>> cache dir           → ~/.cache/uv（共享缓存保留）
  # [uv-probe] >>> cache prune         → 未执行：缺少可询问的 agent（fail-closed）
  # 对照：uv.enabled: false → count=0、uv=ABSENT
  ```

  这组证据覆盖「注册 → 真实 `ctx.subprocess` 执行 → 共享缓存 → 危险类 fail-closed」；探针脚本与 patch 都在 `.tmp-accept/` 里，不随包发布。

- 活性（需重启 harness）：一次实测会话中 `["cache","dir"]` 输出 `~/.cache/uv`；`["sync"]`、`["run","pytest","-q"]` 零审批；`["cache","prune"]`/`["publish"]` 各首次一次审批、同会话再调免问；会话日志里 `tool/call.name = "uv"` 且上述零审批命令的 `approval/asked` 计数为 0。
