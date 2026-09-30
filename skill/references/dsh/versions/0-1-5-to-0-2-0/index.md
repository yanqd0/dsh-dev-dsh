# 0.1.5 → 0.2.0 差分：入口与硬门禁

本文是 `references/dsh/versions/index.md` 的子页（一个升格后的版本线目录）。**默认不读**：只有「插件从 0.1.5
线升级」或「定位 0.1.5 时代的插件问题」、且确实涉及版本差异时才进这里。

上游事实出处：`deepseek-harness@dsh-v0.2.0-rc.2`（对照 `dsh-v0.1.5-rc.3` 与 `dsh-v0.1.7-rc.2`）。

## 0. 读法

1. 0.1.7 → 0.2.0 的部分在 `references/dsh/versions/0-1-7-to-0-2-0.md`，本目录**不重复**它。
2. 本目录负责 0.1.5 → 0.1.7 那一段：两个 tag 之间 3647 个提交（跨两天），逐项枚举不现实。
   ⟹ 这里只写**影响仓外插件的面**，不写产品功能清单。
3. 先读 §1 硬门禁，再按主题进下面三页；每页都把四问（改了什么 / 为什么坏 / 升级改什么 / 静默失效）各自成节。

## 1. 硬门禁（先看这三条）

| 门禁                  | 一句话                                                                              | 详见                                                                |
| --------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 会话格式 V3 → V4      | `SESSION_FORMAT_VERSION` 3 → 4；V3 数据要靠官方迁移边恢复，证据不足会被拒           | `references/dsh/versions/0-1-5-to-0-2-0/session-format-v3-to-v4.md` |
| peer 兼容门禁首次生效 | `@deepseek-ai/dsh*` 的 peer 不满足即判不兼容（prerelease 参与范围），需精确版本豁免 | `references/dsh/versions/0-1-5-to-0-2-0/runtime-and-tooling.md`     |
| 包与清单改版          | `code-runtime` / `e2b` 等包整组消失，`dsh` 清单字段增删                             | `references/dsh/versions/0-1-5-to-0-2-0/manifest-and-packages.md`   |

## 2. 四问总览

**① 改了什么 / 删了什么**

- 会话格式 V3 → V4，并首次出现持久化变更记录体系与 V3 → V4 迁移库。
- 安装 / reconcile 从 CLI 内联迁到独立包，新增构建审批、失败分类与回滚；新出现 HMR 与配置编辑器。
- peer 兼容门禁与「精确版本豁免」命令首次出现。
- `dsh` 清单新增 `manifestVersion: 1` 与包级身份字段，移除三个内部 / 实验字段。
- 11 个包目录被移除、57 个新增（`ptc-runtime` / `ssh` / `browser-use` / `computer-use` / `deliverables` /
  `document` / `mcp-resources` / `agent-preset` / `skill-office` 等）。
- loader 的同 id 语义翻转；客户端 combo URL 改为相对文档。

**② 历史插件为什么坏**

- V3 日志与 V4 构建互不成立：不认识的事件类型不会被「宽容读取」，证据不足的 V3 数据会被迁移边拒绝。
- peer 范围是按旧运行时写的（例如 `^0.1.5` 这类范围在 `0.1.7-rc.2` 上不满足）⟹ 启动 / 安装阶段直接判不兼容。
- 依赖已移除包或旧包路径的 import、挂载行、`files` 清单全部失效。
- 依赖「同 id 二次挂载会抛 `duplicate loader entry id`」的自动化：新版改为静默 last-wins。

**③ 升级要动哪些文件与字段**

1. 先做 V3 → V4 的事件词汇与投影适配（见格式专页）。
2. 对齐 `package.json` 的 `@deepseek-ai/dsh*` peer 与依赖；必要时申请精确版本豁免。
3. 清理 `dsh.*` 里已移除的字段、被移除包的 import 与挂载行、旧包路径。
4. 用真实 profile 启动复核（`--dump-config` + 启动输出），别只看类型编译。

**④ 哪些写法静默失效**

- 用「类型 / 字段存不存在」判断兼容性（权威是 `SESSION_FORMAT_VERSION` 与持久化变更记录）。
- `peerDependencies` 写成过期范围或非 `workspace:` 的本地引用——安装期不报，启动门禁才拦。
- 依赖同 id 覆盖会报错的假设。
- 把客户端 combo URL 当绝对路径拼装（见 `references/dsh/client-loading.md`）。

## 3. 主题页

| 主题                                          | 页面                                                                |
| --------------------------------------------- | ------------------------------------------------------------------- |
| 会话格式 V3 → V4：迁移边、拒绝规则与适配动作  | `references/dsh/versions/0-1-5-to-0-2-0/session-format-v3-to-v4.md` |
| 清单字段增删与包 / 组增删                     | `references/dsh/versions/0-1-5-to-0-2-0/manifest-and-packages.md`   |
| peer 门禁与豁免、安装工具链、HMR、loader 语义 | `references/dsh/versions/0-1-5-to-0-2-0/runtime-and-tooling.md`     |

## 4. 复核手法（只读，可复制）

本目录每条结论都能在本地 tag 上对上；**不切换工作树、不改写已存储代际**：

```bash
git -C <checkout> show dsh-v0.1.5-rc.3:packages/core/session/src/types.ts | grep SESSION_FORMAT_VERSION
git -C <checkout> diff dsh-v0.1.5-rc.3 dsh-v0.1.7-rc.2 -- packages/util/package-manifest/src/types.ts
git -C <checkout> diff dsh-v0.1.5-rc.3 dsh-v0.1.7-rc.2 --name-status | grep 'package.json$'
```

第一行看格式版本、第二行看清单字段增删、第三行看包目录增删；各主题页末尾还有更细的命令。
