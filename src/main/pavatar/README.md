# `main/pavatar`

本目录下的模块 **仅服务于内置插件 `com.proactiveai.pavatar`（像素小人 / 2D 虚拟形象）**，负责主进程侧资源包与自定义协议，不包含通用插件运行时逻辑。

| 文件 | 职责 |
| --- | --- |
| `pack-store.ts` | `userData/pavatar-packs` 目录、内置 demo 同步、`manifest.json` 校验、扫描、`getActivePAvatarPackResolved`、`pavatar://` 协议注册 |
| `debug-log.ts` | 可选调试日志（环境变量开关） |

业务钩子（`onSystemPromptBuild` / `onMessageReceive`、dispatch）在 **`../plugins/builtin/pavatar.ts`**。协议与目录约定详见仓库 **`doc/像素小人插件.md`**。
