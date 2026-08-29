# 修仙模拟器插件 — UI 概念文档

## 目的

用修仙模拟器插件的 UI 构想，验证 `widget-system` 的最小原子集是否满足真实插件场景的需求，避免过度设计。

## 插件 UI 效果

LLM 以旁白形式驱动剧情，右侧栏分三块区域：

| 区域 | 内容 | 数据来源 |
|---|---|---|
| **PlayerStatus** | 玩家当前属性（姓名/修为/生命/境界） | 插件上下文中的状态数据 |
| **StorySummary** | 当前剧情旁白的裁剪版（完整版在聊天区渲染） | LLM 返回的剧情文本 |
| **ChoiceCardList** | 若干可点击选项卡片，每张包含标题和描述 | LLM 返回的剧情分支 |

用户交互流程：

```
剧情推进 → 右侧栏显示 StorySummary + ChoiceCardList
  → 用户点击选项卡片
  → 新剧情生成 → 聊天区追加完整旁白
  → 右侧栏更新 Summary + Choices
```

## Widget 树结构

以当前 `widget-system` 的 5 个组件（Row / Column / Text / Button / Divider）构建：

```
Column
├── Text           ← 玩家名称 "林逸"
├── Text           ← 修为 "筑基三层 · 经验 2400/5000"
├── Text           ← 生命 "HP 78/100"
├── Divider
├── Text           ← 剧情摘要（3-5 行裁剪版）
├── Divider
└── Column
    ├── Button     ← 选项 1：前往灵矿探险
    ├── Button     ← 选项 2：原地打坐修炼
    └── Button     ← 选项 3：御剑前往坊市
```

## 组件用量审计

| WidgetNodeType | 用途 | 出现次数 |
|---|---|---|
| `Column` | 整体布局 + 选项列表容器 | 2 |
| `Text` | 玩家状态 ×3 + 剧情摘要 ×1 | 4 |
| `Divider` | 区域分隔 | 2 |
| `Button` | 玩家选项 | 3 |
| `Row` | 未使用（Column 在此场景下够用） | 0 |

## 结论

5 个原子组件（Row / Column / Text / Button / Divider）足够支撑插件的 UI 呈现需求。被删除的 5 个组件（Stack / Circle / Icon / Badge / Image）在此场景中无一需要，它们依赖插件侧自行用 Text 和 CSS 替代。
