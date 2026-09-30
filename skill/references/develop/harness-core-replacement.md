# harness 核心替换：接管一个 core service

本文是 `references/develop/index.md` 的子页，回答「怎样用仓外包替换 dsh 的核心服务或驱动器，并且与官方包同权」。
**事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`。上游权威：`docs/architecture.zh.md`（一切皆插件、无 privileged core）、
`docs/glossary.zh.md`（Service Definition 的定义）、`packages/bundle/base/cordis.patch.yml`（官方行 id）。

patch 语义、层序、`files` / peer 门禁见 `references/develop/mounting-and-manifest.md`；
能替换 / 不能碰的边界见 `references/dsh/modules/boot-bundle.md`；挂载链路与启动审计见
`references/dsh/composition-and-boot.md`；`ctx.llm` / agent loop 的模块归属见 `references/dsh/modules/kernel.md` 与
`references/dsh/modules/model.md`。

## 1. 判据

- dsh 的一切都是插件，**包括 agent loop、模型适配器、工具注册表、会话日志**，官方文档明说没有 privileged core
  可供打补丁（`docs/architecture.zh.md`）。
- 「替换」在本平台的唯一合法形态是：**先禁用官方那一行，再插入你自己的行**。
- 只想加一个 provider（如新的模型厂商）而保留官方 `ctx.llm`：那是**适配器注册**，不是替换，
  见 `references/develop/peripheral-extensions.md` 与 `docs/user/develop/practice/llm-adapter.zh.md`。

## 2. 接缝

| 面                 | 形态                                                                                                   | 权威路径                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Service 基类       | `abstract class Service`，构造器内注册服务名                                                           | `vendor/cordis/src/service.ts`                                           |
| 服务名唯一性       | 同隔离域重复 `provide` 直接抛错（这就是必须先禁用官方行的原因）                                        | `vendor/cordis/src/reflect.ts:290`                                       |
| Service Definition | 官方形态：`abstract class ShellExecutor extends Service` / `abstract class FileSystem extends Service` | `packages/shell/shell/src/index.ts:64`、`packages/fs/fs/src/index.ts:87` |
| 官方驱动器         | `class AgentLoop extends Service implements AgentFactory`                                              | `packages/core/agent-loop/src/index.ts:330`                              |
| 官方行 id          | base 层的 `llm` / `agent-loop` / `llm-deepseek` / `fs-sandbox`                                         | `packages/bundle/base/cordis.patch.yml`                                  |
| patch 里的 `name`  | 只作断言，不参与改名；不符时 `warn + skip`                                                             | `vendor/include/src/index.ts:116`                                        |

替换写法（官方先例：`packages/experimental/agent-team-profile/cordis.patch.yml`）：

```yaml
- id: fs-sandbox # 官方 base 行
  disabled: true
- insert:
    - id: my-fs
      name: dsh-my-fs
      config: {}
```

显式 `disabled` 的行不进「失败集」，所以「禁官方 + 自己提供」本身不会触发启动审计；
真正会卡住的是 required 行（`agent-loop` / `webserver` / `modules` / …）被禁却没有等价提供者。

## 3. 最小示例

```ts
import { Context } from '@deepseek-ai/cordis';
import { FileSystem } from '@deepseek-ai/dsh-fs';

export default class MyFs extends FileSystem {
  // 继承即声明 super(ctx, 'fs')
  // 实现 FileSystem 的 abstract 成员
}
```

`package.json` 关键字段：`type: "module"`、`exports` 含 `./package.json`、`files` 含入口与 patch、
`dsh.bundle.patch` 指向 patch、与运行时同代的 `peerDependencies`（`@deepseek-ai/cordis` 与所继承的服务包）。

function-plugin 路线也可行：`ctx.provide('fs', impl)`。但模型适配器不要换 service，
走 `ctx.llm.registerAdapter`。

## 4. 失败面

| 看到的串                                                                                                                     | 成因                                                          | 修法                                       |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------ |
| `service "llm" has been registered at <fiber>`                                                                               | 没禁官方行就插入同 service name 的实现                        | 加 `- id: <官方行>` + `disabled: true`     |
| `dsh: warning: N entries did not activate` + `<id> (<name>): <detail>`                                                       | 你的行不是 required，激活失败只算警告 ⇒ **换了个寂寞**        | 看 `--dump-config` 确认官方行真的 disabled |
| `dsh: startup failed: 1 required plugin did not activate` + `agent-loop (required)` 行                                       | 禁了 required 行却没有等价提供者                              | 提供等价实现，或别禁该行                   |
| `dsh: disabling profile plugin row "<id>": Plugin <name>@<version> is incompatible with dsh <runtime>: peerDependencies {…}` | 替换行自己的 peer 范围与运行时不符，admission 直接置 disabled | 对齐 peer 范围                             |
| `patch: name mismatch for "<id>" (expected "<a>", got "<b>"), skipping`                                                      | 想用 patch 改已有行的 `name`                                  | 改名只能禁旧行 + insert 新行               |
| `cannot get required service "llm" in inactive context`                                                                      | 消费者读取时提供者未激活                                      | 检查提供者行的激活与 `inject`              |

来源：`vendor/cordis/src/reflect.ts`、`vendor/include/src/index.ts`、
`packages/boot/app-boot/src/index.ts`、`packages/boot/app-boot/src/compatibility-preflight.ts`。

## 5. 验收

- `dsh --profile <p> --dump-config`：官方行必须显示 `disabled: true`；你的行出现在 `# == <你的包名>` 段；
  被上层改过的行标成 `# == <origin>, patched by <label>`。未命中的 patch 打到 stderr。
- `dsh --profile <p> --dump-config-schema` 会导入插件读 `static Config`——能报出你的 schema 就说明模块解析成立。
- 真启动看激活审计：`dsh: warning: N entries did not activate` vs `dsh: startup failed: …`。
- 服务真的被换掉的旁证：适配器拓扑变化发 `llm/adapters-updated`；`ctx.provide("<name>")` 是该 effect 的名字。

> 三种 `--dump-*` 互斥；flag 定义见 `apps/cli/src/args.ts`，实现见 `packages/boot/app-boot/src/index.ts`。

## 6. 源码最后手段

`deepseek-harness@dsh-v0.2.0-rc.2:vendor/cordis/src/reflect.ts`（provide / set / mixin 的精确语义）、
`packages/boot/app-boot/src/index.ts`（required 行集合与审计矩阵）。默认不读。
