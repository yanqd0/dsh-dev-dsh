# 运行时取证：日志在哪、怎么要到更多 debug 信息

本文是 `references/dogfood/index.md` 的子页，回答「插件跑起来之后，运行期状态与失败留下哪些证据、每种证据怎么取」。
前置动作（建 profile、装插件、确认在树里）见 `references/dogfood/dogfood-setup.md`；拿到证据之后怎么按顺序定位见
`references/dogfood/runtime-triage.md`。

上游事实出处：`deepseek-harness@dsh-v0.2.0-rc.2`。

## 1. 先接受一个事实：默认没有「完整运行日志」

dsh 不在后台维护一份全量日志。默认证据面只有三类：

| 证据                | 位置                                             | 什么时候有               |
| ------------------- | ------------------------------------------------ | ------------------------ |
| 进程输出            | 启动它的那个终端（stdout / stderr）              | 总是                     |
| 启动失败报告        | `$DSH_HOME/logs/startup-<ISO>-<uuid>.log`        | 只有 required 条目失败时 |
| 装 / 删插件操作日志 | `$DSH_HOME/profiles/<p>/.plugin-manager/logs/*/` | 每次 `dsh plugin …` 操作 |

`ctx.logger` 的 warn / error **不会**自动出现在任何地方（§4），所以「终端干净」不等于「没出错」。

## 2. 进程输出：默认唯一的日志面

自己留档（跑一次性实验时最省事）：

```bash
dsh --profile dogfood --port 0 --no-open >> /tmp/dsh-dogfood.log 2>&1 &
tail -f /tmp/dsh-dogfood.log
```

- `--port 0` 让 OS 挑端口、`--no-open` 不抢浏览器；它们是 web 应用的启动参数
  （`packages/bundle/web-app/src/startup.ts:53`），要写在启动器 flag 之后。
- URL 行（`dsh web: http://…`）是 **stdout** 上的 `console.log`（`packages/bundle/web-app/src/index.ts:271`）；
  其余诊断都走 **stderr**。

启动期关键串（照抄进 `grep` 即可）：

| 串                                           | 出处                                        | 含义                                 |
| -------------------------------------------- | ------------------------------------------- | ------------------------------------ |
| `<bin>: warning: N entries did not activate` | `packages/boot/app-boot/src/index.ts:875`   | 非 required 条目没激活，进程照常起来 |
| `<bin>: startup failed: …`                   | 同文件 `:886`                               | required 条目失败，退出码 1          |
| `<bin>: skipping profile bundle "x": …`      | `packages/boot/app-boot/src/profile.ts:120` | 组合包被跳过（peer 不兼容等）        |
| `patch: entry "x" not found`                 | `vendor/include/src/index.ts`               | patch 没命中目标（最贵：静默不生效） |
| `dsh: failed to read overlay …`              | `packages/boot/app-boot/src/index.ts:340`   | patch 文件读不到，启动失败           |

## 3. 两份文件日志

**启动失败报告**——CLI 唯一主动落盘的运行期证据。required 条目失败时终端只印 `error.message` 与
`Full diagnostics: <path>`，完整报告（错误栈、未激活条目元数据、启动期 warn / error）写到
`$DSH_HOME/logs/startup-<ISO 时间>-<uuid>.log`（`apps/cli/src/startup-diagnostics.ts:58`，0600）：

```bash
ls -t "$HOME/.dsh/logs" | head
```

报告含插件错误原文，**可能带配置或凭据值**（文件头自带这条警告），外发前先脱敏；写不进去时会降级为把完整
报告打到 stderr。

**装 / 删插件的操作日志**——每次 `dsh plugin …` 在 profile 下开一个目录，pnpm 的完整输出在里面：

```bash
ls -t "$HOME/.dsh/profiles/dogfood/.plugin-manager/logs" | head -3
cat "$HOME/.dsh/profiles/dogfood/.plugin-manager/logs"/<最新的>/pnpm.log
```

- 目录名 `operation-*`（pnpm 运行）与 `github-connection-*`（git 安装前的连通性检查，文件是 `git.log`）；
  出处 `packages/boot/plugin-manager/src/operations.ts:290`。
- 典型用途：`ERR_PNPM_IGNORED_BUILDS` 这类被终端折叠的安装失败，完整原因在这里。

## 4. `ctx.logger` 的真相与「开 debug」配方

`ctx.logger.debug/info/warn/error` 只把消息交给**已注册的 exporter**。随附组合没有注册 console exporter，
`LoggerService` 自己只挂一个 1000 条的 ring buffer：

- 阈值语义：`exporter.levels[name] ?? exporter.levels.default ?? logger.level ?? INFO` ≥ 消息级别才导出；
  `LoggerLevel` 是 `ERROR=0, INFO=1, WARN=2, DEBUG=3`（`vendor/cordis/src/logger.ts:155`）；
- 内建 buffer exporter 不设 `levels`，即只收 ≥ INFO（`vendor/cordis/src/logger.ts:213`）；
- 自查（挂 sink **之前**）：`dsh --profile dogfood --dump-config | grep -i logger` 应为空——随附组合里确实
  没有 logger 行。

要真的看到 debug，就自己挂一个 sink。**这是本仓验证过的模式，不是 dsh 既有能力**；它用的「overlay 挂本地
相对路径插件」是官方也在用的写法（`docs/user/guide/github-review.zh.md`、
`apps/cli/config/examples/github-review/cordis.yml:9`）。

`$DSH_HOME/profiles/dogfood/logger-sink.mjs`（不 import 任何包，所以放在 profile 目录即可）：

```js
export function apply(ctx) {
  ctx.logger.exporter({
    levels: { default: 3 }, // 3 = DEBUG；改成 2 只看 warn / error
    export: ({ ts, name, type, args }) => {
      process.stderr.write(
        `${new Date(ts).toISOString()} [${type}] ${name} ${args.map(String).join(' ')}\n`
      );
    },
  });
  ctx.logger('logger-sink').debug('sink installed'); // 启动时自报一行，确认它真的挂上了
}
```

挂进 profile 的 `cordis.patch.yml`（或 `--patch` 指向的文件；注意文件本身是顶层 YAML 数组）：

```yaml
- insert:
    - id: logger-sink
      name: './logger-sink.mjs'
      config: {}
```

再按 §2 启动，期望 stderr 出现 `[debug] logger-sink sink installed`；要按 logger 名细分，把 `levels` 写成
`{ default: 2, loader: 3 }` 这样的映射。

## 5. 三种 dump：静态证据

```bash
dsh --profile dogfood --dump-default-config   # 只组合包各层
dsh --profile dogfood --dump-config           # 加上 profile / home patch 与 --patch
dsh --profile dogfood --dump-config-schema    # JSON Schema（会 import 插件模块）
```

- 内容差异、注释标注与「不跑应用参数」见 `references/dsh/composition-and-boot.md` §5。
- 两个操作要点：dump **会重写** profile 根的 `cordis.yml`（`apps/cli/src/profile-boot.ts:171`），只读环境会
  `EACCES`；`--dump-config-schema` 会执行插件模块导入，只对可信 profile 跑。

## 6. 持久证据：会话日志

模型看到过什么、工具调用参数是什么，最终都能从会话日志重建——格式与位置见
`references/dsh/session-log.md` 与 `references/dsh/persistence-and-format.md`。

- 适用：复现「上一轮到底发了什么」「工具收到的参数是什么」这类问题，比翻插件自建日志可靠。
- 不适用：插件加载失败**不**进会话日志，别去那里找。

## 7. 客户端证据入口

浏览器层的证据（`__DSH_BOOT__`、SSE `/plugins/events`、combo `/plugins/??…&rev=`）与只读探针见
`references/dogfood/client-console-diagnosis.md`；装载机制见 `references/dsh/client-loading.md`。

## 8. 取证纪律

- **一条判断一条命令**：先做最便宜的证伪，再决定要不要读大文件。
- **先看时间分布再看内容**：任何 ndjson 日志先
  `grep -o '"at":"[0-9-]*' <file> | sort | uniq -c`，确认它覆盖了你要解释的时间窗；过期日志冒充现状是最常见
  的误判。
- **把已证伪的假设写下来**（模板见 `references/dogfood/runtime-triage.md`），下一轮不重查。
