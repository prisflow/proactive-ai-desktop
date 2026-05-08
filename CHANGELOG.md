# 更新日志（Changelog）

本项目遵循语义化版本（SemVer）：`MAJOR.MINOR.PATCH`。

## v1.1.0 (2026-04-27)

- **虚拟形象资源包**
  - 新增资源包扫描与 `plugin-asset://` 自定义协议（渲染层通过 URL 加载资源）
  - 内置演示包随应用分发，并在启动时同步到 `userData/plugin-asset-packs`
  - 内置示例插件通过 system prompt 协议 `[[AVATAR:...]]` 驱动表情；渲染侧新增 AvatarWidget + worker 负责展示与节奏

- **聊天与 Markdown**
  - Markdown 渲染增强：代码高亮（highlight.js）、复制按钮、Mermaid 预览/源码切换
  - 相关基础样式与滚动条样式补全

- **插件与文档**
  - 插件 IPC（`plugins:list` / `plugins:setEnabled` 等）与设置页插件区对齐
  - 同步更新插件/主进程/资源包相关文档与脚本说明

