# dsh 插件模型：服务、事件与可逆副作用

> 本文是 `references/dsh/index.md` 的子页。
>
> **范围**：Cordis 的插件 / 服务 / 事件模型——读任何 dsh 代码或写任何插件都要先有的运行时原理。
> 层与平面见 `references/dsh/architecture.md`，可介入的扩展点见 `references/dsh/extension-points.md`。
> **事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`。本页写机制，不写会随版本改写的清单。
> 上游权威：`docs/cordis-primer.zh.md`（入门）、`docs/cordis-api/`（生成的核心 API）。

## 1. 五个核心概念

| 概念                 | 内容                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 插件（plugin）       | 实现 Service 的对象：带可选 `inject` 与 `apply(ctx)` 的函数，或 `Service` 子类；生命周期由 Cordis 挂到当前上下文 |
| 上下文（context）    | 服务的容器。一个服务占据稳定的 `ctx.<key>`（`ctx.tools`、`ctx.llm`、`ctx.sessions`…）                            |
| 依赖（`inject`）     | 声明所需服务，插件等待它们就绪才启动；启动顺序由服务依赖表达，而不是手动编排                                     |
| 类型化事件（event）  | 服务用 TypeScript 声明合并注册事件名，再按声明好的模式分发                                                       |
| 可逆副作用（effect） | 提示词片段、工具 schema、适配器、提供方、监听器都经 `ctx.effect()` / `ctx.on()` 安装，卸载时撤销                 |

一句话：**插件向共享上下文贡献服务、类型化事件与可逆副作用**；没有特权内核，扩展现有行为的方式是把自己的插件
挂到别的插件旁边（`docs/cordis-primer.zh.md`）。

## 2. 分发模式与 waterfall 语义

每个事件只有一种分发模式，只能通过对应方法分发；模式是事件公开约定的一部分（源码里用 `@mode` 标注，
生成的目录可交叉校验声明与调用点）。

| 模式        | await | 顺序                         | 返回值 |
| ----------- | ----- | ---------------------------- | ------ |
| `emit`      | 否    | 按注册顺序观察               | 否     |
| `waterfall` | 否    | 按注册顺序观察               | 是     |
| `parallel`  | 是    | 所有监听器并行观察           | 否     |
| `serial`    | 是    | 按注册顺序观察               | 是     |
| `bail`      | 否    | 按注册顺序，直到出现 bail 值 | 是     |

`waterfall` 是环绕中间件：监听器接收 `(...args, next)`，**必须调用 `next()` 才会委托下游**；不调用直接返回
即短路。下游返回值经 `next()` 回到当前包装层，可以再包装后向外返回。协作式监听器通常改一个共享的
请求 / 决策对象再委托；只有必须在普通注册之前运行才用 `prepend: true`。

对单决策事件，短路是设计意图：拥有决策权的策略监听器可以不调 `next()` 直接返回；
只做标注或观察的监听器必须委托下去。

## 3. 生命周期：挂载、激活、撤销

- **挂载**：插件被挂到某个上下文上；`inject` 声明的服务就绪后它才激活。加载顺序来自服务依赖，不来自调用顺序。
- **注册**：一切贡献都经 `ctx.effect()` 或 `ctx.on()`；注册表自己的 `register()` 返回 disposer。
- **撤销**：卸载 / reload 时按 effect 撤销。需要固定 teardown 顺序时，把相关工作放进**同一个 effect**。
- **归属**：effect 归**调用者**的上下文 / fiber，而不是被调用方的；因此插件卸载撤销的正是它自己注册的东西。

**对仓外插件的含义**：注册类贡献必须能证明可回收——卸载后副作用消失。这是 `0.1.0` 的硬要求，
也是「运行时自扩展」（动态挂载 Cordis 插件）能安全工作的前提。

## 4. 服务与类型化事件

- **服务查找取代 import**：跨包用服务 key 找人，不 import 别人的实现文件。服务的 `ctx.<key>` 是稳定接口。
- **Service Definition 不是 TS `interface`**：它可以是抽象类（`ShellExecutor`）或具体注册表（`WebRuntime`）；
  一个 capability seam 由 Service Definition / Provider / Consumer 三个角色组成，单一角色不算 seam
  （见 `references/dsh/extension-points.md`）。
- **类型化事件用声明合并**：事件名与载荷类型由声明合并扩展，`SessionEventMap` 这类 map 可按包扩展；
  事件 JSDoc 必须标 `@mode` 与载荷参数。新增模型可见输入就要新增会话事件（不变式见
  `references/dsh/design-principles.md`）。

## 5. Loader 与配置插值

- 配置文件是条目树：`profile` / `bundle` / patch 叠加的层序见 `references/dsh/architecture.md` §4。
- `vendor/include` 把 `!!js` 解析为表达式节点；loader 在**声明的注入激活后**基于该插件上下文插值条目的
  `config`，并在**每次挂载决策**时插值 `disabled`；其余条目元数据保持字面值。
- 用环境选择插件时用 overlay，不要写条件表达式。
- 条目定位与 patch 语义的实现细节见 `references/dsh/composition-and-boot.md`（层序与装载）与
  `references/develop/mounting-and-manifest.md`（patch 语法与警告串）。

## 6. 对仓外作者的含义

- 包形态：ESM（`"type": "module"`），跨包用包名 import；vendor 包以 `@deepseek-ai/` 命名（如 `@deepseek-ai/cordis`）。
- 导出形态：loader 会解包默认导出，函数插件与 `Service` 子类都能被识别；形态不对会在加载时报错。
- Config：由插件自己的 schema 校验（本仓宿主插件用 zod）。**缺省 config 即校验失败**，所以挂载声明里
  永远显式写 `config`（空对象也要写）。
- 不写死可调项：随部署变化的取值必须是经校验的 `Config` 字段，能从配置改。
- 失败面（插件形态、Config 校验、patch 定位、重复条目）与对应错误串归
  `references/develop/host-entry-and-di.md` 与 `references/develop/mounting-and-manifest.md`；
  跑起来之后的定位走 `references/dogfood/index.md`。

## 7. 源码最后手段

本页覆盖不到的细节才读上游源码：

- 只看一条事实：`git -C 3rdp/deepseek-harness show deepseek-harness@dsh-v0.2.0-rc.2:<path>`（只读，不切换工作树）。
- `vendor/cordis` 是框架本体，`vendor/loader` 是条目树加载，`vendor/include` 是 patch 语义；
  本页引用的每条上游路径都在 `src/facts.test.ts` 有台账条目。
