# preset / 组合包：装配一组插件与配置层

本文是 `references/develop/index.md` 的子页，回答「怎么把一组插件与配置打成一个可发布、可挂载的组合包」。
**事实 pin**：`deepseek-harness@dsh-v0.2.0-rc.2`。上游权威：`docs/user/develop/basic/publish.zh.md`（bundle / profile 契约）、
`packages/util/package-manifest/src/types.ts`（`package.json.dsh` 字段形状）、`packages/boot/app-boot/src/profile.ts`（层序与读取者）。

patch 语义、`files` / `exports`、层序与 `add` 的 reconcile 细节在 `references/develop/mounting-and-manifest.md`，
本页不复述；对外清单见 `references/dsh/modules/boot-bundle.md`，挂载链路见 `references/dsh/composition-and-boot.md`，
运行期启停见 `references/dsh/plugin-management.md`。

## 1. 判据：先分清三种「组合」

- **组合包（bundle）**：包只提供一个配置层（patch 文件），本身不跑代码——`packages/bundle/base/src/index.ts`
  就是一行 `export {}`。用于「把一批插件与配置装配起来」。
- **普通插件**：包有自己的 `apply`，可能顺便带 patch；那是宿主插件，见 `references/develop/host-entry-and-di.md`。
- **agent preset**：dsh 里的第二种 preset 语义——一个**会话组合模板**，注册在 `ctx.agentPresets` 上，
  与 `dsh.profile` 无关（见 §4）。
- 一个包**不能同时**是 bundle 与 profile：`docs/user/develop/basic/publish.zh.md` 明说二者互斥，
  写错的那一侧只是没有读取者（实现上没有互斥校验）。

## 2. `package.json.dsh` 三个字段的分工

| 字段      | 形状                                             | 读取者                                           | 用途                                                |
| --------- | ------------------------------------------------ | ------------------------------------------------ | --------------------------------------------------- |
| `bundle`  | `{ patch: string \| string[] }`（唯一必填）      | `packages/boot/app-boot/src/profile.ts`          | 声明本包提供的配置层                                |
| `profile` | `{ bundles?: string[] }`                         | 只从 `<profileDir>/package.json` 读              | 有序的层列表（**不要手写**，见 §5）                 |
| `client`  | `{ platform, inject?, immediately?, external? }` | `packages/client/modules/src/client/manifest.ts` | 客户端面，见 `references/develop/web-ui-plugins.md` |

`patch` 是**相对包根**的路径；数组表示同一层里按顺序应用的多份 patch。写 `patch` 的文件必须进 npm `files`，
否则是启动失败而不是警告（细节见 `references/develop/mounting-and-manifest.md`）。

## 3. 组合包最小骨架

上游最小真实样例是 `packages/experimental/schedule-bundle`：

```json
{
  "name": "my-composition",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./index.js",
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "dependencies": { "@example/dsh-my-feature": "…" },
  "peerDependencies": { "@deepseek-ai/cordis": "…" }
}
```

```yaml
- insert:
    - id: time-context
      name: '@example/dsh-time-context'
    - id: my-feature
      name: '@example/dsh-my-feature'
      config: { mode: standard }
```

要停用 / 覆盖已有层，加裸条目 `- id: <已有行>` + `disabled: true`（或整份替换 `config`）；
组合包本身不写 `apply`。挂载：`dsh plugin --profile <p> add ./my-composition`。

## 4. agent preset 形态

```yaml
- insert:
    - id: preset-mine
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: mine
        order: 9
        plugins:
          - id: tool-fs
            name: '@deepseek-ai/dsh-tool-fs'
          - id: planning
            name: cordis:group
            group: true
            isolate: { planMode: true }
            config:
              - id: plan-mode
                name: '@deepseek-ai/dsh-plan-mode'
```

`@deepseek-ai/dsh-agent-preset` 在 `Service.init` 里 `ctx.agentPresets.register(config)`
（`packages/preset/agent-preset/src/index.ts`）；内部行用 `cordis:group` + `isolate` 才能把服务限制在 preset 的 scope 内。
官方声明载体见 `packages/bundle/web-app/presets/cordis.patch.yml`。

## 5. 层序与「组合包能覆盖 base」

层序固定为：**bundle 层（按 `bundles` 顺序）→ profile 自己的 patch → `$DSH_HOME/cordis.patch.yml` → `--patch`**。
`dsh plugin add` 成功后把新 bundle **追加到 `bundles` 末尾**，所以组合包能覆盖 base，但会被用户层覆盖。
`dsh.profile.bundles` 由 plugin manager 维护，手工改它属于乱用；运行期用 `setBundle` / `setPluginEnabled` 做等价操作。

## 6. 失败面

| 看到的串                                                                                             | 成因                                        | 修法                                            |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------- |
| `dsh.bundle.patch must be a file path or a list of file paths`                                       | `patch` 类型不对                            | 改成字符串或字符串数组                          |
| `dsh: failed to read overlay <file>: <error>`                                                        | patch 没进 `files` / 路径写错               | 把 patch 加进 `files`（这是启动失败）           |
| `dsh: skipping profile bundle "<name>": <reason>`                                                    | 解析不到、无 `dsh.bundle`、或自身 peer 不符 | 修包声明（**跳过不是启动失败**）                |
| `dsh: warning: <name> declares no dsh.bundle — installed as a plain dependency, not a profile layer` | 装了个没声明 bundle 的包                    | 补 `dsh.bundle.patch`                           |
| `patch: entry "<id>" not found` / `patch insert: entry "<id>" is not a group`                        | 覆盖没命中，或对非 group 行做嵌套 insert    | 核对行 id 与 `insert:` 用法                     |
| `Plugin <name>@<version> is incompatible with dsh <runtime>: peerDependencies {…}`                   | bundle 或行自带 peer 与运行时不符           | 对齐 peer 范围                                  |
| `Duplicate agent preset: <id>` / `Preset id must not be empty`                                       | preset id 重复或为空                        | 换唯一 id                                       |
| `Preset services require isolate realms: <names>` / `agent-preset: mounting requires a scope`        | preset 行把服务发布到 root realm / 缺 scope | 用 `cordis:group` + `isolate`，并禁 base 同名行 |

来源：`packages/boot/app-boot/src/profile.ts`、`packages/boot/plugin-manager/src/operations.ts`、
`vendor/include/src/index.ts`、`packages/preset/agent-preset-registry/src/mount.ts`。

## 7. 验收

- `dsh --profile <p> --dump-config`：层序按段打印（段头 `# == <来源>`）；被上层改过的行标 `# == <origin>, patched by <label>`；
  未命中的 patch 打到 stderr。
- `--dump-default-config` 只看 bundle 层；`--dump-config-schema` 会导入插件读 `static Config`。三种 dump 互斥
  （flag 定义见 `apps/cli/src/args.ts`）。
- 组合包是否真的成为一层：看 `<profileDir>/package.json` 的 `dsh.profile.bundles`（只有 `add` 退出码 0 才追加）。
- 行级是否真的激活：启动审计（非 required 行失败只 warning）+ `--dump-config-schema`。

## 8. 源码最后手段

`deepseek-harness@dsh-v0.2.0-rc.2:packages/boot/app-boot/src/profile.ts`（读取者与层序）、
`packages/boot/plugin-manager/src/operations.ts`（安装与 reconcile）。默认不读。
