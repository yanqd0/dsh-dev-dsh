# dsh-dev-dsh

[![CI](https://github.com/yanqd0/dsh-dev-dsh/actions/workflows/ci.yml/badge.svg)](https://github.com/yanqd0/dsh-dev-dsh/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@yanqd0/dsh-dev-dsh.svg)](https://www.npmjs.com/package/@yanqd0/dsh-dev-dsh)

[English](README.md) | 中文

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）插件：把**仓外**
（out-of-tree）dsh 插件开发手册做成一份 skill 随包发布——装上插件，手册就一起到位。

所谓「仓外」，是指插件住在自己的仓库、用自己的工具链构建、发布到 npm，而不是塞进
`deepseek-harness` 单体仓。

## 安装

```sh
dsh plugin --profile web add @yanqd0/dsh-dev-dsh \
  --allow-build=@yanqd0/dsh-dev-dsh
```

`web` 就是 `dsh web` 背后的 profile，换成其它 profile 名同样成立。`--allow-build` 让包的
`postinstall` 执行 skill 同步；不加也能用——同步有两条触发路径，插件加载时的那条是保底。

装完要重启 DSH（插件配置与 profile 的包解析都在启动时定型），然后确认插件已挂载、skill 已就位：

```sh
dsh --profile web --dump-config | grep -c 'id: dsh-dev-dsh'   # 必须为 1
ls ~/.dsh/skills/dsh-dev-dsh/SKILL.md
```

### 从 GitHub Packages 安装

两个注册表发布同一个包名。GitHub Packages 即使是公开包也要求认证，token 需带 `read:packages`
权限；把两行写进 `~/.npmrc`：

```
@yanqd0:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

之后照上面的命令安装即可。

## 用法

直接让 agent 开发、打包或排障一个住在自己仓库里的 dsh 插件。不需要敲任何命令：skill 自己判断
这次请求适不适用、路由到对应的 reference 页，页面没覆盖的情况回落到运行时 dsh 的事实。

手册是一个薄入口（`SKILL.md`）加带索引的三类页面——**插件开发**（各类插件的流程、清单与挂载、
客户端 / UI 插件、子进程信任面）、**dsh 本体**（架构、组装与启动、会话日志与存储、内置模块）、
**dogfood 与排障**（本地把插件跑起来、运行时取证、客户端 Console 诊断）。

手册顶层不含上游路径与版本号，因此不随 dsh 版本变迁而过时。各页复核所依据的 dsh 基准只声明一处：
手册的版本页（`references/dsh/versions/index.md`）。

## 选项

两个可选项**默认都关闭**。在 profile 的 `cordis.patch.yml` 里开启其一并重启 harness。

### `uv` 工具（实验性）

在 `workspace-write` 文件策略下，每次普通的 `uv` 调用都会撞沙箱：uv 要往 `$HOME` 下写共享缓存与
托管安装，于是每次都被拒、再带提权重试一次——一条命令一次审批。这个子模块改为把 `uv` 跑在
**插件进程内**，经宿主的 subprocess 缝隙执行，会话文件沙箱看不到它，argv 与输出原样透传。

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- id: dsh-dev-dsh
  config:
    uv:
      enabled: true
      # entry: ~/.local/bin/uv    # 缺省：从 PATH 解析 `uv`
      # timeoutMs: 600000         # 单次墙钟上限，缺省 10 分钟
      # passEnv: [UV_INDEX_URL]   # 按需转发凭证形状的环境变量名
```

之所以是 opt-in，是因为它放宽了信任边界：`uv` 及其子进程（包括 `uv run` 执行的一切）不再受会话
文件沙箱约束。仍有几类命令按「同会话同类首次」询问（`self update`、`publish`、`cache clean|prune`、
`python install|uninstall`、`tool install|uninstall|upgrade`、`auth`、`uv pip --system`，以及任何
指向工作区之外的目标）；没有应答方时这几类一律 fail closed。

### 提示卡按键（实验性）

Web GUI 里的每个提示卡——授权卡、方案复核卡、`ask_user_question` 卡——都会接管输入框却**不取得
焦点**，而每张卡都把键盘行为绑在「必须已经聚焦」的元素上。焦点落在 `document.body` 时，这些卡上的
Enter 因此完全无效。这个子模块从浏览器半边正好补上这个缺口：Enter 触发卡片默认动作，↑/↓ 在选项间
移焦，新渲染出来的卡会先取得一次焦点。它从不 `consume()` 手势，因此凡是上游已有行为之处，仍以上游为准。

```yaml
# ~/.dsh/profiles/<profile>/cordis.patch.yml
- id: dsh-dev-dsh
  config:
    keyboard:
      enabled: true
```

与 `uv` 工具不同，这个开关由**浏览器半边**判定（浏览器读不到挂载行），所以开启它需要重启 harness
**并**刷新页面。

两个子模块的设计取舍、被否决的方案与已知限制，都索引在 [CONTRIBUTING.md](CONTRIBUTING.md) 里。

## 许可证

MIT
