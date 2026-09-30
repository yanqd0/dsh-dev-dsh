# dogfood 环境搭建：把插件跑起来并确认真的生效

本文是 `references/dogfood/index.md` 的子页，回答「写好的插件怎么在本机 dsh 上跑起来，以及怎么确认它**真的**进了
运行中的树」。每一步都给可直接粘贴的命令与预期；流程只用本机已安装的 dsh，不读 `3rdp/`、不联网。

上游事实出处：`deepseek-harness@dsh-v0.2.0-rc.2`。机制叙述路由到既有页，本页只写可执行步骤。

## 0. 前置与纪律

- 一份已装好的 dsh（`dsh --version` 有输出）；`$DSH_HOME` 默认 `~/.dsh`。
- **不要拿正在用的 profile 做实验**：装错一个包会让 GUI 起不来。实验一律用独立 profile（§1）。
- 命令在宿主 shell 跑：dsh 会写 `$DSH_HOME`（§3 有具体的写点）。

## 1. 建一个隔离 profile

```bash
dsh --profile dogfood --from-default-profile web
```

- `--from-default-profile web` 用随附模板初始化一个**尚不存在**的 profile，目录是
  `$DSH_HOME/profiles/dogfood/`；名字已被占用会直接报错——那是保护，不是故障。
- 随附模板各由哪些组合包叠成、`web` 与 `headless` 的差别见 `references/dsh/composition-and-boot.md` §2。
- 不想要这个环境时，删掉 `$DSH_HOME/profiles/dogfood/` 即可；随附模板随时能重建。

## 2. 装插件

三条来源走同一条命令（`dsh plugin` 把参数原样透传给 profile 目录里的 pnpm）：

```bash
dsh plugin --profile dogfood add <包名>             # npm 注册表
dsh plugin --profile dogfood add /abs/path/to/repo  # 本地目录（file: 依赖）
dsh plugin --profile dogfood add ./pkg.tgz          # tarball
```

装完先看 profile 清单，**别信 `add` 自己的输出**：

```bash
node -e "const p=require(process.env.HOME+'/.dsh/profiles/dogfood/package.json');console.log(p.dsh.profile.bundles)"
```

- 期望：列表末尾多出刚装的包。**没有多出来 = 它没成为配置层**，插件不会生效。
- 追加发生在 reconcile 阶段，且只看**第一次出现**的依赖：`add` 失败（最典型 `ERR_PNPM_IGNORED_BUILDS`）
  不会追加，重跑 `add` 也不会补，可复现的重试路径是 `remove` 之后再 `add`——完整失败面见
  `references/develop/build-and-pitfalls.md` §2 与 `references/dsh/plugin-management.md` §2。
- 装包前的 inspect、DSH peer 兼容门禁与回滚语义同样见 `references/dsh/plugin-management.md` §2。

## 3. 确认它进了生效树

`add` 阶段还没有 profile 根配置，条目的 id 与最终 config 要到 **boot** 才落定：

```bash
dsh --profile dogfood --dump-config | grep -n -B2 -A6 '<你的 id 或包名>'
```

- 期望：出现你的条目，注释标出它来自哪个 patch 文件。
- dump 打印的是**解析应用参数之前**的组合结果；三种 dump 的内容差异见
  `references/dsh/composition-and-boot.md` §5。
- **副作用**：dump 与启动都会把 profile 根的 `cordis.yml` 重写为空根桩，所以只读挂载或沙箱里会
  `EACCES: permission denied`（`apps/cli/src/profile-boot.ts:171`）。

## 4. 改配置与重启边界

三个落点，越靠后越优先（层序与「同一行后应用者胜」见 `references/dsh/composition-and-boot.md` §2）：

| 落点                                          | 作用范围         | 适用                       |
| --------------------------------------------- | ---------------- | -------------------------- |
| `$DSH_HOME/profiles/dogfood/cordis.patch.yml` | 只这个 profile   | 日常改自己插件的 config    |
| `$DSH_HOME/cordis.patch.yml`                  | 本机所有 profile | 机器级偏好                 |
| `--patch <path>`                              | 这一次启动       | 一次性实验、复现别人的组合 |

- 判据是**该 profile 有没有启用 HMR**：`web` 模板默认启用，HMR 监视 profile 清单与 profile 级 / home 级
  两份用户 patch，按事务重组并应用；`--patch` 是本次调用的 overlay，改了要重开进程。HMR 被禁用或模板本身
  没有它时，配置改动需要重启进程。重载失败的处理见 `references/dsh/composition-and-boot.md` §6，
  实现是 `packages/boot/hmr`。
- 挂载写法（`insert:` 包裹、`config` 必填、同 id 是覆盖语义）见 `references/develop/mounting-and-manifest.md`。

## 5. 生效判定：启动输出里不该出现什么

启动后第一件事是读进程输出（stdout/stderr）——以下三条任一出现，说明「装上了」和「跑起来了」不是一回事：

| 关键串                                       | 含义                                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------- |
| `<bin>: warning: N entries did not activate` | 有非 required 条目没激活（`packages/boot/app-boot/src/index.ts`）      |
| `<bin>: startup failed: …`                   | required 条目失败，进程不启动                                          |
| `<bin>: skipping profile bundle "x": …`      | 组合包被跳过（peer 不兼容等，`packages/boot/app-boot/src/profile.ts`） |

日志面、关键串清单与「怎么要到更多 debug」见 `references/dogfood/runtime-evidence.md`。

技能 / 数据型插件还要确认落位（以随包分发 skill 为例）：

```bash
ls -l "$HOME/.dsh/skills/<skill 名>/SKILL.md"
```

用户级 skill 的发现根与 rank 见 `docs/subsystems/skills.zh.md`；本仓 `src/install-skill.ts` 是这种模式的一个
实现样例（content-sync，整树比对一致就不动）。

## 6. 善后

- 实验 profile 留着复用即可；不要把它写进 `web` profile 的 bundles，也不要手改 `dsh.profile.bundles`。
- 卸载：`dsh plugin --profile dogfood remove <包名>`；同样只在 reconcile 生效，必要时重启确认。
- 每次实验前用 §3 的 dump 复核一次，比事后翻日志便宜。
