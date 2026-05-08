# `main/plugin-assets`

本目录提供通用插件资源包能力：主进程资源包扫描、active 资源包解析与 `plugin-asset://` 协议注册，不绑定任何业务插件语义。

| 文件 | 职责 |
| --- | --- |
| `pack-store.ts` | `userData/plugin-asset-packs` 目录、内置 demo 同步、`manifest.json` 校验、扫描、`getActiveAssetPackResolved`、`plugin-asset://` 协议注册 |
| `debug-log.ts` | 可选调试日志（环境变量开关） |
