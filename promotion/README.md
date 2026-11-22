# CCLink Studio 宣传资料

这里集中保存 CCLink Studio 的四套宣传稿、真实界面截图和可编辑配图。先统一产品定位，再按公众号、开源社区、官网和社交媒体分别打磨。

打开 [图文总览](index.html)，按顺序查看四套稿件的排版预览。

| 顺序 | 场景 | 正文 | 排版预览 | 配图 |
| --- | --- | --- | --- | --- |
| 1 | 公众号与项目首发 | [公众号精修稿](01-wechat/article.md) | [图文预览](01-wechat/preview.html) | 专用封面、工作台导览、任务特写、浏览器特写、竖向协作图 |
| 2 | GitHub 与开源社区 | [社区精修稿](02-open-source/article.md) | [图文预览](02-open-source/preview.html) | 专用封面、真实工作台、源码职责图、上手顺序图 |
| 3 | 官网首页 | [首页文案](03-website/copy.md) | [文案预览](03-website/preview.html) | 横版封面、两张真实界面图 |
| 4 | 朋友圈与社交媒体 | [短文和配图顺序](04-social/copy.md) | [图文预览](04-social/preview.html) | 一张方形封面和三张竖版图卡 |

公众号与开源社区版已逐段精修，官网和社交媒体版仍为图文初稿，均已整理正文和本地图片，尚未公开发布。公众号的 [逐段修订说明](01-wechat/paragraph-review.md)、[初稿对照](01-wechat/preview-v1.html)，以及社区版的 [逐段修订说明](02-open-source/paragraph-review.md)、[初稿对照](02-open-source/preview-v1.html) 单独保存，方便继续审阅。

## 统一口径与配图依据

- [定位与读者](positioning.md)：一句话介绍、主要读者、核心价值和措辞边界。
- [事实与图片来源](sources.md)：每项能力的依据、截图采集方式和使用条件。
- [逐稿审阅](review/editorial-review.md)：每个版本的假设、验证结果和剩余问题。
- `assets/screenshots/`：当前真实 Studio 窗口截图。
- `assets/graphics/`：配图的 SVG 源文件与 PNG 发布文件。
- `01-wechat/images/`：公众号精修的五张专用配图与对应 SVG。
- `02-open-source/images/`：开源社区精修的四张专用配图与对应 SVG。
- `demo-materials/`：截图使用的原创演示文档和网页。

## 使用方式

Markdown 正文可以继续在编辑器中修改；`preview.html` 用于检查图文顺序和阅读效果。公众号正文中的图片已按顺序嵌入，但仍需在目标平台上传并检查平台排版。

社交媒体直接使用 [社交媒体正文](04-social/copy.md)中引用的四张 PNG，正文使用对应短文。原始 SVG 留在 `assets/graphics/`，方便调整标题、配色和尺寸。

本地预览：

```bash
node promotion/tools/serve.mjs
```

命令会输出仅监听本机的预览地址。图片与预览无需外部字体或第三方图床。
