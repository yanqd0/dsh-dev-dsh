# dsh-dev-dsh 方向评估：该不该做、做成 skill 还是 plugin

> 评估时点 2026-09-27；依据 dsh 快照 `3rdp/deepseek-harness/`（0.1.7-rc.2，官方仓 237.2k★，2026-08-13 建仓）
> 与联网竞品核查。所有"官方已有"结论均带文件行号；竞品数据取自 GitHub API（含星数、最后 push）。

## 一、结论速览

| 问题                 | 结论                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| 这个方向有价值吗？   | **有条件有价值**。作为"给自己/团队用"的工具价值高；作为"社区产品"价值未证实。         |
| 做成 skill 就够吗？  | **不够**。纯知识型 skill 与官方内置能力重叠，且照抄不解决问题（不能校验、不能构建）。 |
| 应该做成 plugin 吗？ | **应该，但必须是"窄而硬"的 plugin**，而不是又一个 devkit。                            |
| 社区有类似项目吗？   | **有，但基本是 0–2★ 的一次性弃坑**；唯一在维护的同类（dsh-doctor）仅 5★。空位仍在。   |

**一句话**：官方已把"dsh 开发方法"内置进 Creator mode（skill + 探针 + 管理器），所以
"再写一份教学 skill"没有价值；真正没被覆盖、且官方**明确留给第三方**的，是
**仓外（out-of-tree）可发布插件的工程化**——尤其是**客户端插件的构建**。建议做
"skill 做路由 + plugin 做确定性能力"的混合体，只打这一点。

## 二、关键事实核查（推翻了两个直觉）

### 2.1 官方已经在"固化开发方法"了

dsh 内置 **Creator mode**（agent preset id = `cordis`），随包发布：

- 三个官方 creator skill：`cordis-plugin-development`（含 `references/` 与可复制的
  `templates/`）、`editing-cordis-compositions`、`cordis-composition-reference`
  —— `packages/preset/agent-preset/skills/`，由 `packages/preset/agent-preset/README.md:50` 描述。
- 运行时 API 探针 `cordis_inspect_list` / `cordis_inspect_query`（`packages/extensions/tool-cordis/README.md`）。
- 插件/ bundle 安装管理 `plugin_manager`（`packages/boot/plugin-manager/README.md`）。
- 挂载点：`packages/bundle/web-app/presets/cordis.patch.yml:141-153`。

`cordis-plugin-development` 已覆盖：宿主插件、UI 插件、MCP bundle、实践准则、验证边界，
并自带 `templates/decoration/`（4 文件）与 `templates/mcp/`（2 文件）骨架，
且**明确指导用 `plugin_manager` 而非手改 profile**。

上游另有面向作者的官方文档树 `docs/user/develop/`：`basic/`（第一个插件→工具→配置→打包安装）、
`framework/`（生命周期/服务/事件）、`practice/`（三角色 capability、LLM adapter、动态配置），
外加 7 章 `docs/cordis-tutorial/` 与 8 篇 `docs/cookbook/`。

→ **"deepseek 的 LLM 不懂 dsh" 在 dsh 运行态里并不成立**：一旦在 Creator mode，
知识由 harness 注入，且随 dsh 版本同步更新。第三方再写一份知识型 skill，
既重复又必然更快过时。

### 2.2 "赛道拥挤"是假象：竞品几乎全是弃坑

GitHub API 实测（2026-09-27）：

| 项目                                                                      | ★    | 建仓  | 最后 push | 判读                                                                              |
| ------------------------------------------------------------------------- | ---- | ----- | --------- | --------------------------------------------------------------------------------- |
| [dsh-market/dsh-market](https://github.com/dsh-market/dsh-market)         | 4669 | 08-14 | 09-27     | 生态真实存在（但这是市场，不是开发工具）                                          |
| [astra3294/dsh-doctor](https://github.com/astra3294/dsh-doctor)           | 5    | 08-14 | 09-27     | 唯一在维护的同类；目标是**诊断/修复**                                             |
| [CkEFFAF/dsh-plugin-devkit](https://github.com/CkEFFAF/dsh-plugin-devkit) | 1    | 09-15 | 09-15     | README 很强（547 测试），但**当天建当天停**，单次投放                             |
| [dsh-io/dsh-plugin-skill](https://github.com/dsh-io/dsh-plugin-skill)     | 2    | 08-17 | 08-17     | 单日弃坑；正是"知识型 skill"形态                                                  |
| [dsh-io/dsh-dev](https://github.com/dsh-io/dsh-dev)                       | 0    | 08-17 | 08-17     | README 自称 "official toolchain"（**虚假**，官方是 `deepseek-ai`）；39 分钟后停更 |

`dsh-io` 组织 2026-08-17 建号，6 个仓库，其中还占了 `dsh-io/deepseek-harness` 名字 —— 属抢名行为，非官方。

→ 该子赛道**没有被真正占住**；但一堆 0–2★ 单日弃坑说明的是**需求薄 + 维护成本高**，
而不是"别人做完了"。这两件事要分清。

### 2.3 官方**主动删除**了自己的项目脚手架（最关键的证据）

`.agents/notes/archived/simplification/2026-08-11-remove-sdk-project-toolchain.zh.md`
（Status: implemented，2026-09-04 归档）记载：官方删除了 `@deepseek-ai/create-sdk`、
`dsh-scripts`、`dsh-helper`、`dsh-telemetry` 四个包、两套命令产品、项目模板，
以及**一个仓库内的"项目创建 skill"**，理由是：

> "没有任何项目是通过公开发布版创建的，当前仓库和外部消费方也都不需要这套生命周期。"

并在"后果"中明确：

> "DeepSeek Harness **不再创建或管理独立的开发者 SDK 项目**。自动项目生成、
> 功能树配置、**本地插件脚手架**、项目本地的开发/构建/启动命令……**均有意不再提供**"；
> 重新引入"必须先有真实消费方"。

这条同时是**利好**与**警示**：

- 利好：仓外插件工程化是官方**主动的非目标**，第三方填补不会撞上即将发布的官方功能。
- 警示：官方曾用"零真实消费方"来论证删除 —— 说明**仓外脚手架的需求量在官方眼里不足**。

## 三、真正没被覆盖的空白（按价值排序）

官方与社区都**没有**解决的，只剩下面这些；前两项是硬空白：

1. **仓外客户端插件的构建器（最高价值、唯一硬门槛）**
   官方 `clientBundle` tsdown preset **未发布**；`docs/cookbook/adding-a-settings-card.md:60`
   直言"仓库外的包自行复现这套构建"。需要手搓：lazy-CJS factory
   （`window.__ModuleLoader__.load({id, factory})`，`packages/client/tsdown.client.ts:110-127`）、
   module-table externals、CSS Modules 内联、sourcemap。
   社区无人解决：devkit 只做**预览**不做构建；`dsh-io/dsh-dev` 是 0★ stub。
2. **仓外包契约的静态校验**
   反复踩、反复抄：`insert:` 包裹语义（裸 `- id/name` 是覆盖 → `patch: entry not found`）、
   `cordis.patch.yml` 必须进 `files`、显式 `config: {}`（zod object Config 缺省即 `invalid config`）、
   与 profile 手写 insert 并存会 `duplicate loader entry id`、client bundle 未预构建 →
   `MissingClientBundleError`、peer/dev 双声明、`allowBuilds`/`ERR_PNPM_IGNORED_BUILDS`。
   证据：本项目作者在 `~/yanqd0/dsh-mint/AGENTS.md` 的「架构事实（DSH 调研结论，写码前复核）」
   与 `notes/dsh-plugin-dev.md` 里**已经手工重抄过一遍** —— 这就是"固化"的真实需求来源。
3. **仓外 dev 循环编排与失败归因**（HMR 失效、client bundle 404、插件 PENDING 静默无报错）。
4. **发布流程**（npm/GitHub Packages 双发、tarball、git + `prepare` + `allowBuilds`）。

**已被占位、不要重复做的**：运行时探针（官方 `tool-cordis`，社区 devkit 做了增强版）、
插件管理 UI（官方 `plugin_manager` + 社区 dshmarket）、诊断/修复（dsh-doctor，5★ 且在维护）、
又一份教学 skill（官方 3 个 + 社区 2 个）、又一个通用脚手架（多个 0★ 弃坑）。

**反面教材**：`@ddtcorex/dsh-maestro-devkit` 已 npm 弃用，理由自陈
"duplicated DSH core, CDP, Supervisor, Govard, and skill capabilities **without completing a
demonstrated workflow**" —— 铺得广、没跑通，就是这个赛道的典型死法。

## 四、skill vs plugin：能力边界

skill 的数据模型只有 `name` / `description`（必填）、`whenToUse`、`user-invocable`、
`disable-model-invocation`、`metadata`，加一段 Markdown body；**没有** tools / scripts / 参数 / 触发词字段
（`packages/skill/skill-filesystem/src/index.ts:797-840`）。body 是纯指令，**skill 自身不执行代码**
（`packages/skill/skill-office/README.md:30`）。加载：`tool-skill` 在 `agent/pre-step` 注入
name+description 目录，模型用 `skill({name})` 取 body（`packages/skill/tool-skill/src/index.ts:213-251`）。

| 能力                                           | skill                 | plugin      | 备注                    |
| ---------------------------------------------- | --------------------- | ----------- | ----------------------- |
| 知识注入 / 流程编排                            | ✅ 唯一强项           | 可但更重    | 官方已占用知识位        |
| **跨宿主复用**（Claude Code / Codex / Cursor） | ✅ 只有 skill 能做到  | ❌ 绑死 dsh | 这是 skill 不可替代之处 |
| 脚手架/校验的**确定性执行**                    | ❌ 只能"让模型照着写" | ✅ 注册工具 |                         |
| 读取上游源码                                   | ✅ 通用 read/grep     | ✅ 可加索引 |                         |
| GUI 面板 / slot                                | ❌                    | ✅ 必须     |                         |
| 拦截 agent（guard/waterfall）                  | ❌                    | ✅ 必须     |                         |
| 后台任务 / RPC / 启动期自检                    | ❌                    | ✅ 必须     |                         |

→ **纯 skill 覆盖不了第 3 节里的任何一项硬空白**（都不能执行）；
**纯 plugin 又丢了跨宿主复用**，且知识随版本漂移的维护成本更高。

## 五、建议

### 5.1 定位（把话说窄）

不是"把 dsh 开发方法固化成 skill/plugin"（已由官方内置），而是：

> **面向仓外、可发布、带客户端面的 dsh 插件项目：一个可验证的构建与契约工具链。**

### 5.2 形态：skill + plugin 混合，且 plugin 要窄

- **skill（薄）**：只做两件事 —— ① 路由与检索（明确指向官方 creator skills、`docs/user/develop`、
  `cordis_inspect`，**不复制**它们的内容，避免过时）；② 固化官方不讲的仓外契约与踩坑清单
  （即第三节能被文字表达的部分）。跨宿主可复用于 Claude Code/Codex。
- **plugin（窄而硬）**：只做官方与社区都没做的确定性能力，建议按此顺序：
  1. `dsh-client-bundle` 构建 preset —— 把未发布的 `packages/client/tsdown.client.ts` 提炼成
     可发布的第三方 preset。**这是唯一有护城河、也最难被官方顺手覆盖的一块。**
  2. 一个 `check` 工具/命令：静态校验仓外包契约（patch 语法与 `insert:` 语义、`files` 清单、
     Config 必填、peer/dev 双声明、client bundle 存在性、与 profile 手写 insert 冲突检测）。
     对照 `dsh-mint` 的 `src/package-manifest.test.ts` 思路，做成通用版。
  3. （可选）`dsh --dump-config` 归因与 PENDING 静默失败的诊断封装。

### 5.3 明确不做

运行时 API 探针、插件市场/管理 UI、诊断修复（dsh-doctor 已占）、
又一份教学 skill、又一个通用脚手架。**宁可少做一个模块，也不要重演 maestro-devkit。**

### 5.4 起步（建议 MVP）

先只做 5.2-1（client bundle preset）+ 5.2-2（check），用一个真实消费方验收 ——
就用你已有的 `@yanqd0/dsh-mint`（已有 host+client 面、`dist/`、`dsh.client`）或
`dsh-covtrim` 作为第一个下游。skill 等二者跑通后再补，避免先写一堆会过时的文档。

## 六、风险

| 风险                                         | 严重度 | 缓解                                                                                                                       |
| -------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| dsh 是 developer preview，**明确会破坏兼容** | 高     | 只依赖稳定缝隙（package.json 契约、`dsh plugin` CLI）；构建 preset 与 dsh 版本绑定并声明 `engines.dsh`（学 devkit 的做法） |
| 需求薄：官方曾以"零消费方"删除同类工具链     | 高     | 不追社区采用率，先以"自己 2–3 个插件仓库"为验收标准                                                                        |
| 客户端插件私有格式变动，preset 需跟改        | 中     | 该格式本就是"必须抄源码"的门槛，跟改成本即护城河成本                                                                       |
| 官方随时可能自己补上脚手架                   | 中     | 官方注记要求"先有真实消费方"，短期内不会；且构建 preset 比脚手架更难被顺手做完                                             |
| 又一次"铺得广没跑通"                         | 中     | 按 5.3 严格限缩模块数                                                                                                      |

## 七、待确认（已定，见第八节）

- 自用/团队用 vs 对外发布；两者决定是否值得为"跨宿主 skill"和发布流程投入。
- 是否接受把 client bundle preset 作为**主**产品（而非附带能力）——它是最有价值也最重的部分。

## 八、决策与修订（2026-09-27）

**决策**：项目启动；先自用，发布验证后再做社区推广。**先做第 5.2-1（仓外 client bundle preset）**。
定位为正常 public 项目，但验收标准是自有插件仓库跑通，不依赖社区采用率。

### 8.1 修订一：消费方是"多仓库"，需求薄的风险消解

原评估把"官方曾以零消费方删除同类工具链"列为高危。该风险由本项目自身的 dogfooding 消解：

- 现有消费方：`@yanqd0/dsh-mint`、`dsh-covtrim`、`dsh-dev-dsh` 本身。
- 未来：作者将持续开发更多 dsh 插件。
- 含义：验收不依赖外部采用率；但也意味着**工具必须一开始就按"多消费方"设计**
  （可复用包 + 版本化契约），而不是为单个插件定制。

### 8.2 修订二：新增第三支柱——dsh 版本差分知识库

原评估低估了这条。dsh 在高速迭代中，**破坏性变更直接杀死仓外插件**（已有实证：
`graph-memory` 因 V4 拒 `kind:"plugin"` 而整轮失败；`dsh-calculator` 因 peer 范围与
`dsh-client-runtime` 移除而被门禁拒绝）。已观察到的版本线：

| 版本                          | 关键状态                                                          |
| ----------------------------- | ----------------------------------------------------------------- |
| 0.1.3                         | 早期固化文档所依据的稳定版                                        |
| 0.1.5                         | 稳定版；message format **v3**                                     |
| 0.1.7-rc.2（当前 agent 版本） | message format **v4**、旧 completion API 废弃、启用 peer 兼容门禁 |

→ 需要的不只是"文档"，而是**可执行、可版本化的差分知识**：
关键版本的 breaking changes 清单 + 针对插件源码/清单的**检测**（哪些写法在新版会被拒）。
这条与第三支柱（check）天然合流：**check 的规则集应按 dsh 版本分档**。

### 8.3 修订后的三支柱

1. **仓外 client bundle 构建 preset**（起手项）：把未发布的官方 `clientBundle` 提炼为可发布 preset。
2. **仓外包契约静态校验**：规则按 dsh 版本分档，覆盖 patch 语义、`files`、Config、peer/dev、
   client bundle 预构建、与 profile 手写 insert 冲突。
3. **版本差分知识库**：breaking changes 的持续固化 + 面向消费方的升级检测与迁移提示。

### 8.4 验收方式（dogfooding）

每个支柱都必须由至少一个**真实插件仓库**跑通验收，而不是只写测试：
以 `@yanqd0/dsh-mint`（已有 host + client 双面、`dist/`、`dsh.client`）作为第一个消费方，
`dsh-covtrim` 与 `dsh-dev-dsh` 作为后续回归消费方。

### 8.5 版本规划（定案）

计划在 mint 中维护（milestone + plan + issue），不以本文档为计划真源；此处只记决策要点。

| 版本       | 范围                                                                                                                       | 说明                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **0.1.0**  | ① dsh 0.1.7 的 skill；② skill 随插件安装；③ npm 首版                                                                       | 收窄到"知识 + 交付"，不含客户端构建 |
| **0.2.0+** | 逐步补齐插件细分门类（客户端/UI、MCP、skill 型、preset、工具与 hooks）；仓外包契约静态校验；持续维护 0.1.7 之后的 dsh 变化 | 节奏跟随官方迭代，慢慢开发          |

> 8.3 的"起手项 = client bundle preset"已被 0.1.0 的实际范围取代：客户端构建属 0.2.0 门类。
> 该 preset 曾短暂实现并验证（6 项测试通过），但按"不在 0.1.0 前预留大块无用内容、
> 仓库只保留**一个** package"的决定已从仓库与 git 历史中移除。其调研结论（产物契约、
> 外部化基线、构建管线、腐坏风险）压缩保存在 mint issue #6，供 0.2.0 重启时复用，
> 无需重新考古。

**关键约束**：0.1.0 不含客户端/UI 能力，因此 0.1.0 的 skill 只覆盖宿主面，
**不得**在 0.1.0 文档中承诺客户端插件构建——避免与 0.2.0 的实际能力错位。

### 8.6 skill 定位修订（2026-09-29，plan #5）

**决策**：skill 从「只补官方空白」升级为**外置 dsh 开发手册**——让 agent 不读 dsh 源码
就能开发插件、定位问题；源码降为最后手段（手册给出 `<repo>@<tag>` + 路径指针，默认不推荐读取）。
完整结构规范见 `notes/skill-design.md`。

- **内容模型**：① 插件分类与开发流程 ② dsh（含 cordis）架构 / 内置模块(plugin) / 业务流与数据流
  - 关键版本反 CHANGELOG ③ dogfood 与问题定位；未来可加大类。
- **结构**：L0 薄入口（版本无关，且只有它随 skill 首载进 context）+ 多级 `references/`；
  跨大类引用允许成环，整体是图不是树。
- **基准版本**：内容基准从 `dsh-v0.1.7-rc.2` 转为 **`dsh-v0.2.0-rc.1`**（与本机运行时一致），
  并要记 `0.1.7-rc.2 → 0.2.0-rc.1` 差分；现有 4 分册的重校归 0.2.0 外置手册 plan。
- **保鲜**：纯手写，不引生成脚本；每页声明 pin，台账自动复核一次只覆盖一个本地 checkout 版本。
- **取代关系**：本文 §5.1 的「只补官方空白 / 不复制官方内容」对本 skill 不再适用（对 plugin 侧仍然成立）；
  §8.5 把「持续维护 dsh 变化」列为 0.2.0+ 的说法，落地形式就是外置手册 plan。

### 8.7 基准推进到 0.2.0-rc.2、顶层先行与术语纪律（2026-09-30，plan #13）

**决策**：内容基准由 `dsh-v0.2.0-rc.1` 推进到运行时的 `dsh-v0.2.0-rc.2`（3rdp 快照与运行时一致），
差分写两页（`0.1.7-rc.2 → 0.2.0-rc.1`、`0.2.0-rc.1 → 0.2.0-rc.2`），现有分册 pin 重校到 rc.2。

- **顶层先行**：手册顶层（完整分层架构、插件模型、扩展点、设计原理、DDD 概念模型、官方领域词汇）
  归 plan #13，是 0.1.0 的核心；细节按机制拆到 #14（组装与启动）、#15（会话与持久化）、
  #16（模块与 plugin 索引）、#17（分类开发流程）、#18（dogfood 取证）、#19（版本差分与重校）。
- **版本叙述纪律**：基准会持续演进，所以「当前基准」只在 skill 的版本页声明一处，
  其它页只保留 provenance pin（理由与门禁见 `notes/skill-design.md` §4.1、§10）。
- **术语纪律**：领域概念术语以英文原词为准；中英对照只在 `skill/references/dsh/concept-model.md`
  维护，官方定义的权威仍在 `docs/glossary.zh.md` 与 `docs/i18n/terminology.md`（手册只索引、不照抄）。
- **不变**：0.1.0 仍不含客户端 / UI 构建能力（§8.5 的约束继续有效）；#6 / #7 的历史版本线不重开。

### 8.8 试验性子模块政策与宿主 `uv` 工具（2026-10-02，plan #22）

**决策**：本仓除「skill + 安装它的宿主插件」外，**长期承载试验性、不稳定的子模块**（小插件）：
先在仓内 dogfood、边界清楚后再剥离为独立插件项目。第一个子模块是 `src/uv/`——宿主 `uv` 工具，
用来消除 bash 沙箱对 uv 常规操作（写 `~/.cache/uv`）的逐次提权审批。

- **不重定向 uv 的 home 态目录**：`UV_CACHE_DIR` 等能把写入挪进工作区，但会让全局缓存退化为
  项目级缓存——每个项目各存一份、hardlink 去重失效、全局磁盘占用显著增大；且 `uv tool` 忽略
  项目级配置。取舍与备选（会话 `danger-full-access`、Auto review、自定义 sandbox provider、
  bash 提权自动放行门）的完整理由见 `notes/uv.md`。
- **默认关闭**：`uv.enabled: false`，由 profile 覆盖行显式开启——子模块会改变执行的安全姿态，
  不能随包默认生效；开启后 `uv` 只经 `ctx.subprocess` 执行，风险操作按同会话首次询问。
- **子模块纪律**（已写入 `AGENTS.md` 硬约束）：不得使 skill 同步或 profile 启动失败；
  默认关闭；边界清楚（`src/uv/` 可整目录搬走）。
- **不变**：skill 仍是核心交付物与单一真源；本子模块不进 skill 正文。
