# scripts

本目录是 **离线工具** 与 **electron-builder 钩子**，不参与应用运行时。像素小人资源格式与同步逻辑见仓库根目录 `doc/像素小人插件.md`。

## 依赖

美术类脚本使用 **`pngjs`**（已在 `devDependencies`）。在项目根目录执行：

```bash
node scripts/<name>.cjs [args]
```

---

## 像素小人 / 内置 demo

| 脚本 | 作用 |
| --- | --- |
| `generate-builtin-pavatar-demo.cjs` | 在 `resources/pavatar-bundled/com.proactiveai.demo/1.0.0/` 生成 **色块占位** 的 `atlas.png`、`idle.sheet.png` 和配套 `manifest.json`（192px 网格）。**会覆盖该目录下同名文件**；仅用于重置占位或调尺寸，不要误跑掉真实美术资源。 |
| `make-transparent-sprites.cjs` | 把近黑背景抠成透明 PNG（`clean` / `shadow` 两种策略）。用于素材预处理。 |
| `normalize-idle-sheet.cjs` | 横向多帧 idle 条带 → 按帧对齐脚底与中心 → 裁方格 → 最近邻缩放到目标 tile，输出规范 `idle.sheet.png`。 |
| `make-idle-sheet-from-atlas.cjs` | 从大图 atlas 裁第一行若干格拼成横向 idle 条带（占位用）。 |

**npm 快捷方式**（仅第一项）：

```bash
npm run gen:pavatar-demo
```

改完资源后请自行提交 `resources/pavatar-bundled`；应用启动会把内置 demo **同步** 到用户 `userData/pavatar-packs`（见主进程 `pack-store`）。

---

## Windows 打包

| 脚本 | 作用 |
| --- | --- |
| `after-pack-win-icon.cjs` | **electron-builder `afterPack`**：在 Windows 上把 `build/icon.png` 转成 `.ico` 并写入产物 `.exe`（当前 `win.signAndEditExecutable` 为 `false` 时补图标）。非 Windows 或缺 `build/icon.png` 时跳过。 |
| `clean-electron-win-cache.cjs` | 删除 `%LOCALAPPDATA%\electron\Cache` 下 `electron-*-win32-x64.zip`，缓解下载损坏导致的打包失败。 |

**npm 快捷方式**：

```bash
npm run dist:win:fresh   # 清缓存后打 Windows 包
```

---

## 与 `package.json` 的对应关系

- `gen:pavatar-demo` → `generate-builtin-pavatar-demo.cjs`
- `dist:win:fresh` → `clean-electron-win-cache.cjs` 然后 `dist:win`
- `build.afterPack` → `after-pack-win-icon.cjs`
