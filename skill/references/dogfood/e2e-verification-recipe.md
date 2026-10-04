# 端到端验收配方：怎么证明「它真的生效了」

本文是 `references/dogfood/index.md` 的子页，回答「改完一个插件（**客户端半边尤其**）之后，
用什么手法证明它生效、失败时怎么一步收窄」，并把「无副作用的交互测试」写成可直接执行的命令。

前置动作（建 profile、装插件、确认在树里）见 `references/dogfood/dogfood-setup.md`；
证据面总览见 `references/dogfood/runtime-evidence.md`；只读探针见
`references/dogfood/client-console-diagnosis.md`；能自证到哪一层见
`references/dogfood/client-verification-ladder.md`。

上游事实出处：`deepseek-harness@dsh-v0.2.0-rc.2`。

## 1. 纪律：先证「值到了」，再谈「行为对不对」

客户端功能的失败绝大多数落在「配置/产物没到浏览器」，而不是「逻辑写错」。所以顺序固定：

```
重启生效 → 注入到位 → 产物同源 → 才轮到行为与交互
```

顺序反了的典型代价：改了三轮行为代码，最后发现开关根本没进页面。上一段里三条判据都不成立时，
**改行为代码是纯浪费**——其中第 2、3 条见 §2，第 1 条见 §3。

## 2. 三条机械判据（全自动，不需要人看）

### 2.1 拿带 token 的页面

宿主启动日志的最后一行就是页面地址（含一次性 token）：

```bash
grep -o 'http://127.0.0.1:[0-9]*/?token=[A-Za-z0-9_-]*' <宿主日志> | tail -1
curl -sL "<该地址>" -o /tmp/idx.html -w '%{http_code} %{size_download}\n'   # 必须 -L：无 token 会 303/401
```

### 2.2 验「产物同源」：浏览器拿到的就是磁盘上那份

```bash
# 页面里的单文件 URL（每个包一条，带 rev）
grep -o 'plugins/??<包名>/client.js&rev=[a-f0-9]*' /tmp/idx.html | head -1
curl -s "http://127.0.0.1:<port>/plugins/??<包名>/client.js&rev=<rev>" -o /tmp/served.js
diff <(sed 's,//# sourceMappingURL.*,,' /tmp/served.js) \
     <(sed 's,//# sourceMappingURL.*,,' dist/client.js) && echo 同源
```

不同源 = 浏览器拿的是旧包；缺 rev / 陈旧 rev 会 404。**注意**：宿主在 combo 批量 URL 里会补一个 `;`，
单文件 URL 也可能如此——diff 出的差异只有尾部分号即可视为同源。

### 2.3 验「重启生效」

客户端产物与注入表都在**宿主启动时**定型：改了 `dist/**` 之后不重启，跑着的进程仍用旧模块。

```bash
ps -eo pid,lstart,args | grep 'bin.js web' | grep -v grep   # 进程启动时间
ls -l --time-style=+%F_%H:%M dist/client.js dist/index.js    # 产物 mtime（必须更早）
```

**mtime 早于进程启动时间**才算生效。这条能挡掉「其实没重启」这一类假失败。

## 3. 验「注入到位」：一条 grep 判定整个通道

宿主给浏览器传值靠页面全局（原理与陷阱见 `references/develop/host-to-client-channel.md`）。

```bash
grep -o '__DSH_[A-Z_]*__' /tmp/idx.html | sort -u   # 页面里所有宿主注入的全局
```

- 列表里**有**你的名字 → 通道成立，继续查行为；
- 列表里**没有**你的名字 → 通道失效（多半是宿主半边没订阅 `webserver/index-inject`，或用了
  `ctx.get('webserver')` 先查服务那条死路）。**此时不要动客户端代码。**

## 4. 无副作用的交互测试：怎么造出「需要人按一下」的现场

有些能力（提示卡、审批、键盘、焦点）只有在真实交互里才会走到。下面三个手法都能**无害地**造出现场。

### 4.1 造一张真实授权卡

请求一次「文件策略必然拒绝」但无害的沙箱升级——在工作区**外**建一个临时文件、立刻删掉：

```bash
MARKER="$HOME/.dsh/<plugin>-verify-$$.txt"; touch "$MARKER" && rm -f "$MARKER"
```

配套纪律：

- **不要用 `/tmp`**：平台允许的临时区不会被拦，拿不到卡（本仓实测：`/tmp` 直接成功、无审批）。
- 需要审批时按常规提权重试一次，并在 `justification` 里写清这是**验收用的无害动作**——审批记录本身
  就是证据。
- 名字要**一眼可辨**（`<plugin>-verify-<pid>.txt`），便于事后核对无残留。

### 4.2 用内置提问机制造一张「选项卡」

需要「有选项、有默认项、要人确认」的卡片时，直接调用内置提问工具：它就是产品自己的
`[data-question-key]` 卡片，默认项由选项文案控制（带「推荐 / recommended」的选项会被预选）。
这比手搓 UI 更快，也天然覆盖了真实渲染路径。

### 4.3 读授权结果（不靠人描述「我按了什么」）

会话日志是 zstd 压缩的 JSONL，授权审计对就在里面：

```bash
zstd -dc ~/.dsh/sessions/<项目目录>/<session>/session.v4.jsonl.zstd \
  | grep -o '{"type":"approval/\(asked\|decided\)".\{0,180\}' | tail -4
```

- `asked → decided: allowed-once` = 放行；`decided: rejected` = 拒绝/取消。
- **时间差也是证据**：`asked` 到 `decided` 只隔一两秒，通常是键盘直接确认；隔了几十秒到几分钟，
  多半是人读了再由鼠标点。用它可以区分「键盘生效」与「鼠标点的」。
- 同一份日志还能给用量账：每条 `assistant/message` 里带 `usage`（`inputTokens` / `outputTokens` /
  `cacheReadTokens`），可按 turn 聚合出「哪一阶段最贵」。

### 4.4 记录「无副作用」的验收口径

验收记录里写清**是键盘还是鼠标**、以及对应的审计行（`seq` + `outcome`）。本仓 `notes/keyboard.md` §7
是现成范例。

## 5. 决策矩阵：失败时先查哪里

| 现象                               | 先查                                               | 结论                                                                           |
| ---------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------ |
| 页面里没有我的全局                 | §3 grep                                            | 宿主注入面失效，客户端无需动                                                   |
| 页面有全局，但功能不生效           | §2.2 产物同源                                      | 不同源 = 旧包；同源则进下一行                                                  |
| 同源且全局在，交互仍无反应         | 事件投递面                                         | 查该能力依赖的观察面/事件是否真的被调用（加一行日志最省事）                    |
| 改完重启仍无变化                   | §2.3                                               | 多半没重启，或进程持着旧 `dist`                                                |
| 重启后整页不启动                   | 启动审计                                           | 客户端 entry 抛错会把这一行判为未激活，整页拒绝启动——检查 `apply` 是否真的不抛 |
| 只有人眼能判断（视图、焦点、布局） | `references/dogfood/client-verification-ladder.md` | 明确写下「需要人确认」，不要用间接推断冒充证据                                 |

## 6. 两个反模式（本次实测踩过）

1. **「没找到服务就先查服务再注册事件」。** 事件订阅不需要服务存在；多这一步会让特征静默失效，
   而失败若又被「没有 logger 就不打日志」的兜底吞掉，就变成**整条特性无声失效**——
   这正是最难查的一类问题。兜底日志要能留下「特性没装上」这种信号。
2. **用间接推断代替端到端验证。** 「单元测试过了」「产物 diff 一致」「构建成功」都不等于
   「浏览器里生效」。写下结论前，先跑一遍 §2 + §3 的机械判据。
