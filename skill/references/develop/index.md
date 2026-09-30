# 插件开发：按插件分类的流程与方法

> 本文是 `SKILL.md` 的入口页（L1）。

dsh 的一切都是插件，但**不同分类的插件是完全不同的活**：接入的层、需要的构建面、会碰到的失败面都不同。
本类按分类组织：先认分类，再读该类的流程页。

## 怎么用

1. 先在下表定位你的插件属于哪一类（可跨类，按**主要接缝**归类）。
2. 读该类的流程页；页内会直引 `references/dsh/` 的原理页，或间接要求先读某个原理页。
3. 本类只补官方不写的**仓外工程面**：官方 creator skill 覆盖 profile 内开发，本类覆盖仓外仓库的
   构建、挂载、发布与验收。

## 分类轴（先认分类）

| 分类                  | 主要接缝                                          | 典型产物               | 流程页                                           |
| --------------------- | ------------------------------------------------- | ---------------------- | ------------------------------------------------ |
| 新增工具（tool）      | `ctx.tools` 注册 + 模型可见 schema                | 一个 `defineTool` 插件 | `references/develop/tool-plugins.md`             |
| 外围扩展（能力 seam） | 既有服务与事件（`fs/*`、`tools/*`、`llm/*`…）     | 策略、适配器、守卫     | `references/develop/peripheral-extensions.md`    |
| harness 核心替换      | 替换核心服务或驱动器（如 agent loop、模型适配器） | 与官方同权的替代实现   | `references/develop/harness-core-replacement.md` |
| web UI / 客户端插件   | 客户端 bundle + 插槽 / 路由                       | 面板、卡片、页面       | `references/develop/web-ui-plugins.md`           |
| skill 型插件          | 随包分发知识并按需安装同步                        | 知识包 + 同步逻辑      | `references/develop/skill-plugins.md`            |
| preset / 组合包       | `dsh.profile`、`dsh.bundle`                       | 一组插件的装配         | `references/develop/preset-and-composition.md`   |
| MCP                   | 外部 MCP 服务接入                                 | 工具 / 资源桥          | `references/develop/mcp-integration.md`          |
| hooks / 桥接          | 其它 agent 的桥接事件                             | 转译层                 | `references/develop/hook-bridges.md`             |

八类流程页各自从本表选一个入口；每页只补官方不写的仓外工程面，机制叙述一律路由到既有页面。

## 通用工程面（各类共用）

| 主题                                                 | 页面                                          |
| ---------------------------------------------------- | --------------------------------------------- |
| 包形态与挂载声明：patch 语义、层序、`files` 清单字段 | `references/develop/mounting-and-manifest.md` |
| 宿主入口与 DI：导出形态、Config 校验、工具注册、事件 | `references/develop/host-entry-and-di.md`     |
| 构建、发布与踩坑：仓外仓库的工程面                   | `references/develop/build-and-pitfalls.md`    |

> 原理在 `references/dsh/architecture.md`；插件跑起来之后怎么定位问题在 `references/dogfood/index.md`。
