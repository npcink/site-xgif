# Visual baseline rules

## Purpose

The archived Next implementation is the visual reference for the homepage and image-detail dialog. The Astro site keeps that editorial visual language while adding accessible navigation, independent detail pages, and browser-history support.

## Required screenshot baselines

Run `npm run test:visual:linux` before merging changes that affect shared layout, typography, spacing, image treatment, or dialog behavior. This uses the same pinned Linux environment as CI.

The test suite compares these viewports:

- Desktop: 1440 x 900
- Mobile: 390 x 844

It covers the homepage, the `confused` image dialog, and this second discovery batch:

- Image library: default archive and the `无语` mood filter.
- Search: a populated `打工` result and the `不存在内容` empty state.
- Article detail: the direct `how-memes-speak` reading route.
- Tags: the complete tag index, plus separate article and related-image captures from the mixed-content `AI` result route.

Each is captured at both supported viewports. CI runs the suite in the pinned Playwright Linux image declared in `.github/workflows/verify.yml`.

The runner builds the site and serves its production preview on port 4322. It deliberately does not reuse a developer's `astro dev` process, so local baseline updates exercise the same static output as CI without taking over day-to-day development.

After an intentional visual change has been reviewed, regenerate the canonical screenshots from the same Linux environment:

```sh
npm run test:visual:update:linux
```

Then inspect and commit only the affected screenshots with the related CSS or component change. `npm run test:visual` remains useful for quick local iteration, but macOS-generated screenshots are not canonical because font rasterization can differ from Linux.

## What must match

- Desktop image dialog width, two-column ratio, image crop, and right-column padding.
- The source attribution stays at the bottom of the desktop image-dialog copy column.
- Mobile homepage hero and feature-panel first-screen rhythm uses a 560px minimum height.
- Image-library search, mood chips, grid rhythm, and filtered result count stay legible at both viewport sizes.
- Search result groups collapse when empty, while the intentional no-result state remains composed and actionable.
- Article details preserve their readable direct-page hierarchy, with metadata, summary, and source action above the reading grid.
- Tag index and tag-result pages keep their distinct discovery hierarchy, including the tag list, aggregate count, article grid, and related-image grid.
- The warm paper palette, Geist typography, sharp surfaces, and coral accent remain consistent with the archived baseline.

## What must not be reverted for pixel matching

- Native dialog semantics, keyboard close behavior, and browser-history integration.
- Independent article and image routes with complete content and structured data.
- Mobile navigation and the 40px close target.
- Viewport-safe sizing using `svh` on mobile.

## Review rule

2026-11-12：发布四条图片内容暴露了旧测试对首页 AI 入选数量、全站总数和情绪词顺序的固定假设。首页筛选预期改为读取当前精选图片的检索资料；截图额外遮罩全站搜索总数所在链接，并仅在拍照时隐藏数据生成的情绪文字，保留“全部情绪”、搜索框、按钮边界、筛选行为和页面布局检查。只更新首页、图片库默认及筛选态的六张 Linux 截图，不修改产品样式或内容措辞。

2026-11-12：统一多模态推荐后，像素图详情的桌面推荐区只保留达到图片相似度门槛的一张动漫图，移除两张较弱候选。这属于推荐正确性改进，保留原有三列网格、图片尺寸和弹窗布局，仅更新 `image-dialog-desktop.png`；移动端首屏没有受到影响。

Treat a screenshot diff as a design review item, not as a blind snapshot update. The reviewer must classify it as one of:

1. A required baseline match.
2. An approved responsive adaptation.
3. A functional or accessibility improvement that must remain.

When a change falls into the second or third category, update this document and the affected screenshot in the same change.

CI uploads `site-visual-diffs` when verification fails. Review those artifacts before deciding whether the implementation is wrong or the approved baseline should change.
