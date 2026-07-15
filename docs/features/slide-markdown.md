# CCLink Studio Slide Markdown — 轻量幻灯片格式方案

> 状态：📋 方案讨论
> 优先级：Phase 6（文档编辑器增强 / AI 生成 PPT 基础设施）
> 目标：基于 Markdown + CSS + 轻量布局状态，构建一种新的轻量版 PPT 替代格式。

## 背景

CCLink Studio 已经具备 Markdown 文档编辑基础能力。下一步如果要支持“做 PPT”，不一定要复刻 PowerPoint 的完整文件格式和交互模型，而可以设计一种更适合 AI 生成、用户轻量编辑、文本可读、跨端渲染的新格式。

这个方向不是“Markdown 转 PPT”，也不是“Web 版 PowerPoint”，而是：

**Markdown 内容 + CSS 版式 + 块级拖拽编辑 = 轻量幻灯片。**

## 核心判断

### PPT 和 Web 布局模型不同

PowerPoint 更像一个固定尺寸画布：

- 每一页是固定比例的画布，例如 16:9。
- 页面上放置对象：文本框、图片、形状、图表、表格。
- 每个对象有边界框、层级、旋转、样式和动画。
- 编辑体验强调自由摆放和视觉微调。

HTML/CSS 更像文档和界面布局系统：

- 内容根据容器和屏幕尺寸流动。
- `flex`、`grid`、`position` 等机制负责排版。
- CSS 擅长响应式、主题、组件化和自动布局。
- CSS 没有原生的“幻灯片对象模型”，需要产品自己定义一层抽象。

因此，很多基于 Web 技术复刻 PPT 的产品体验不够好，根本原因不是 CSS 不够强，而是直接用网页布局模型模拟 PPT 的画布对象模型，容易在文本度量、拖拽编辑、导出、动画、图片裁剪等地方出现落差。

### Markdown 不应该承载样式细节

Markdown 的精神是描述内容和结构，而不是描述像素级样式。

不推荐把布局坐标写进 Markdown：

```md
# 标题 {.box x=80 y=60 w=900 h=120}
```

这种写法虽然接近 PPT，但会让 Markdown 变成低配 CSS/PPTX，破坏可读性，也不利于普通用户和 AI 长期维护。

更合理的边界是：

- Markdown 负责内容。
- 少量扩展语法负责语义块。
- CSS 负责主题和默认版式。
- 编辑器保存轻量拖拽后的布局状态。

## 产品定义

CCLink Studio Slide Markdown 是一种内容驱动的幻灯片格式。

它的目标不是替代所有 PowerPoint 场景，而是覆盖 70% 的结构化演示需求：

- 产品介绍
- 项目汇报
- 周报月报
- 融资路演初稿
- 教学课件
- 技术分享
- AI 自动生成演示稿
- 文档一键转演示

它不优先覆盖：

- 像素级商业发布会 PPT
- 大量复杂动画
- 任意元素旋转和自由叠放
- Office 母版体系深度兼容
- SmartArt / Excel 图表联动等复杂对象

## 格式组成

推荐将一个幻灯片文档保存为目录包或压缩包：

```txt
deck.dslide/
├── content.md
├── theme.css
├── layout.json
└── assets/
```

也可以在早期阶段先使用普通 Markdown 文件：

```txt
demo.slide.md
```

但长期看，目录包更适合保存图片、主题、布局状态和导出缓存。

## 三层模型

### 1. Markdown Content

Markdown 只描述内容本身：

```md
---
title: CCLink Studio
theme: deepink-dark
size: 16:9
---

# CCLink Studio

下一代一站式 AI 桌面服务。

## 核心能力

- 写文档
- 做表格
- 做 PPT
- 浏览网页
- 操控手机 App

![产品界面](./assets/app.png)
```

### 2. Semantic Blocks

在必要时，用少量块级扩展描述内容角色，而不是描述样式：

```md
:::hero
# CCLink Studio

下一代一站式 AI 桌面服务。
:::

:::features
- AI 文档
- 浏览器 Agent
- Android Agent
- AI 协作
:::

:::media
![产品界面](./assets/app.png)
:::
```

这些语法表示“这块内容是什么”，不表示“它的 x/y/w/h 是多少”。

### 3. Layout State

用户在 WYSIWYG 编辑器里进行轻量拖拽、分栏、图片裁剪、块顺序调整时，状态写入 `layout.json`：

```json
{
  "version": 1,
  "slides": [
    {
      "id": "slide-1",
      "layout": "product-intro",
      "blocks": {
        "hero-1": {
          "area": "top",
          "size": "large"
        },
        "features-1": {
          "area": "left"
        },
        "media-1": {
          "area": "right",
          "fit": "cover"
        }
      }
    }
  ]
}
```

这里保存的是轻量布局意图，不是暴露给用户手写的 Markdown 样式。

## CSS 的角色

CSS 适合作为渲染层和主题层，而不是让用户直接写布局细节。

示例：

```css
.slide[data-layout="product-intro"] {
  display: grid;
  grid-template:
    "hero media" 180px
    "body media" 1fr
    / 1fr 460px;
  gap: 32px;
}

.slide-block[data-role="hero"] {
  grid-area: hero;
}

.slide-block[data-role="features"] {
  grid-area: body;
}

.slide-block[data-role="media"] {
  grid-area: media;
}
```

这意味着：

- Markdown 不写 CSS。
- 用户不用理解 CSS。
- 主题作者可以写 CSS。
- CCLink Studio 可以内置一批稳定版式。
- AI 可以选择合适版式，而不是计算像素坐标。

## 编辑体验

编辑器应该采用“块级自由布局”，而不是完整自由画布。

用户可以操作：

- 移动标题块、文本块、图片块、表格块、卡片块。
- 切换版式，例如大图右侧、双栏、卡片网格、引用页。
- 调整图片裁剪和焦点。
- 调整块的强调级别，例如普通、强调、大标题。
- 拖动块顺序，或把块移动到另一页。

用户不需要直接操作：

- 绝对坐标。
- CSS 属性。
- 复杂母版。
- 每个元素的像素级尺寸。

这样既保留了“轻量自由发挥”，又避免陷入传统 PPT 的复杂度。

## 与传统 PPT 的差异

| 维度 | 传统 PPT | CCLink Studio Slide Markdown |
|------|----------|------------------------|
| 核心模型 | 画布对象 | 内容块 + 语义版式 |
| 源文件 | 二进制/复杂 XML | Markdown + JSON + CSS |
| 编辑方式 | 像素级拖拽 | 块级拖拽 |
| AI 友好度 | 较低 | 高 |
| 版本管理 | 差 | 好 |
| 导出 | PPTX/PDF 原生强 | 先 HTML/PDF，后 PPTX |
| 适合场景 | 精修商业演示 | 快速生成、汇报、课程、结构化演示 |

## 与普通 Markdown 的差异

普通 Markdown 是线性文档。Slide Markdown 增加：

- 幻灯片分页。
- 内容角色块。
- 主题系统。
- 默认版式选择。
- 轻量布局状态。
- 演示和导出能力。

但它仍然保留 Markdown 的核心优点：

- 可读。
- 可复制。
- 可被 AI 稳定生成和修改。
- 可作为源码保存。
- 不把样式细节暴露到正文里。

## 推荐 MVP

### 文件格式

- 支持 `.slide.md`。
- 支持 frontmatter：`title`、`theme`、`size`、`layout`。
- 支持 `---` 分页。
- 支持少量语义块：`hero`、`features`、`columns`、`media`、`quote`、`compare`、`notes`。

### 渲染能力

- React Slide Renderer。
- 16:9 固定画布。
- CSS Grid / Flex 默认版式。
- 深色和浅色主题。
- HTML 演示模式。
- PDF 导出。

### 编辑能力

- Markdown 源码编辑。
- 所见即所得幻灯片预览。
- 块级选择、拖拽排序。
- 切换版式。
- 图片替换和裁剪。
- 保存 `layout.json`。

### AI 能力

- 从普通文档生成 slide markdown。
- 根据主题生成完整演示稿。
- 自动选择版式。
- 根据用户反馈改写某一页。
- 将长页拆分为多页。
- 将 bullet 转为 cards / compare / timeline。

## PPTX 导出策略

Slide Markdown 的主格式不是 PPTX，PPTX 是面向外部协作和交付的兼容导出格式。

推荐采用三档导出能力逐步实现。

### 1. 截图式 PPTX

将每一页先通过 React Renderer + CSS Theme 渲染成图片，再把图片铺满 PPTX 页面。

优点：

- 视觉保真度最高。
- 实现成本低。
- 能作为所有复杂页面的导出兜底。
- PowerPoint / Keynote / WPS 都能打开播放。

缺点：

- 导出的 PPT 里文字和图片不可编辑。
- 文件体积可能较大。
- 更像“PPT 容器里的图片演示”。

### 2. 对象式 PPTX

将 Slide AST / Render Model 中的块转换为真正的 PPTX 对象。

映射关系：

```txt
title / text / quote  → addText
list / features       → addText + bullet
image / media         → addImage
table / compare       → addTable
background / decor    → shape 或 image
```

优点：

- 导出的 PPT 可继续编辑。
- 文件更轻。
- 更接近真正的 PowerPoint 文档。

缺点：

- CSS 无法完整映射到 PPTX。
- 字体、行高、换行、图片裁剪可能存在差异。
- 需要维护 Render Model 到 PPTX 坐标和样式的转换。

### 3. 混合式 PPTX（推荐）

普通内容块导出为可编辑 PPTX 对象，复杂视觉层导出为图片。

建议规则：

- 标题、正文、列表、引用：优先导出为可编辑文本对象。
- 图片：优先导出为可编辑图片对象，保留裁剪策略。
- 表格：简单表格导出为 PPTX 表格，复杂表格导出为图片。
- 代码块、复杂卡片、特殊装饰：优先导出为图片。
- 背景、纹理、CSS 特效：合成为背景图。

这样可以在“视觉保真”和“可编辑”之间取得平衡。

长期技术路线：

```txt
content.md
   ↓ Markdown Parser
Slide AST
   ↓ Layout Resolver
Render Model
   ├→ React Renderer + CSS Theme
   ├→ PDF Export
   └→ PPTX Export
        ├→ editable objects
        └→ image fallback
```

关键原则：

- 不从 Markdown 直接导出 PPTX。
- PPTX 导出必须基于 Render Model。
- 每个 block 决定自己的导出策略：editable / image / hybrid。
- 第一版先做截图式兜底，再逐步提高对象式覆盖率。

## 示例语法

```md
---
title: CCLink Studio 产品介绍
theme: deepink-dark
size: 16:9
---

:::hero
# CCLink Studio

下一代一站式 AI 桌面服务。
:::

:::features
- AI 文档编辑
- 内嵌浏览器 Agent
- Android 自动化
- AI-Native IM
:::

:::media
![CCLink Studio 主界面](./assets/app.png)
:::

---

:::quote
不是 AI 助手，不是 AI 工具，是 AI 时代的工作入口。
:::

:::notes
这一页用于解释产品定位，重点强调 CCLink Studio 是工作入口，而不是单点 AI 工具。
:::
```

## 技术路线

```txt
content.md
   ↓ Markdown Parser
Slide AST
   ↓ Layout Resolver
Render Model
   ↓ React Renderer + CSS Theme
WYSIWYG Editor / Presentation / PDF Export / PPTX Export
```

### Slide AST

```typescript
interface SlideDeck {
  meta: {
    title?: string
    theme: string
    size: '16:9' | '4:3'
  }
  slides: Slide[]
}

interface Slide {
  id: string
  layout?: string
  blocks: SlideBlock[]
  notes?: string
}

interface SlideBlock {
  id: string
  role: 'hero' | 'text' | 'features' | 'media' | 'quote' | 'compare' | 'columns'
  content: unknown
}
```

### Layout Resolver

Layout Resolver 负责把语义块映射到渲染位置：

```txt
Slide AST + theme.css + layout.json
   ↓
Render Model
```

它需要处理：

- 默认版式推断。
- 用户布局状态覆盖。
- 图片裁剪策略。
- 文本溢出处理。
- 页面拆分建议。

## 设计原则

1. Markdown 只写内容和语义，不写像素级样式。
2. CSS 是主题和版式系统，不是用户正文的一部分。
3. 编辑器提供轻量拖拽，但不追求完整自由画布。
4. AI 操作 Slide AST，而不是直接操作 PPTX。
5. 优先 HTML/PDF 导出，同时保留混合式 PPTX 导出路径。
6. 先做结构化演示，不做复杂动画和高精度商业模板。

## 试验计划

第一轮试验目标不是完整编辑器，而是验证“Markdown → Slide AST → CSS 渲染 → PPTX 导出”这条链路是否可控。

### 试验 1：静态渲染闭环

- 新建 `demo.slide.md` 示例文件。
- 实现最小 `slide-parser.ts`：frontmatter、`---` 分页、标题/段落/列表/图片/引用识别。
- 实现 `SlideCanvas`：固定 16:9 页面、自动缩放、5 个默认版式。
- 在 Workbench 中用 `SlideEditor` 打开 `.slide.md`。

验收标准：

- 可以从一个 Markdown 文件渲染出多页漂亮幻灯片。
- 不需要用户写坐标或 CSS。
- 页面尺寸变化时幻灯片等比缩放。

### 试验 2：截图式 PPTX 导出

- 使用浏览器渲染每一页 slide。
- 将每页导出为图片。
- 用 PPTX 生成库把图片铺满每一页。

验收标准：

- 导出的 PPTX 可以在 PowerPoint / Keynote / WPS 打开。
- 视觉效果与 CCLink Studio 内部预览基本一致。
- 先不要求 PPT 内部元素可编辑。

### 试验 3：混合式 PPTX 导出

- 为 Render Model 增加 `exportMode` 字段。
- 标题、正文、列表导出为 PPTX 文本对象。
- 图片导出为 PPTX 图片对象。
- 复杂 block 继续使用图片 fallback。

验收标准：

- 普通文字在 PPTX 中可编辑。
- 复杂页面仍能保持视觉保真。
- 同一份 `.slide.md` 可以稳定导出 HTML/PDF/PPTX。

## 后续问题

- `.slide.md` 和 `.dslide` 是否同时支持？
- 语义块集合第一版应该控制在多少个？
- 用户拖拽布局状态是否必须可读，还是只需要稳定可恢复？
- CSS 主题是否开放给用户自定义？
- PPTX 导出默认采用截图式、对象式还是混合式？
- 是否将 Slide Markdown 纳入现有 Tiptap 编辑器，还是独立成 SlideEditor？
