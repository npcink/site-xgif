# Next Design Baseline

这是 xgif.cn 旧版 vinext/Next 页面实现的只读设计档案，不参与当前 Astro 站点的构建、发布或内容生成。

## 保存内容

- `app/page.tsx`：旧版首页和图片详情弹层的 JSX 结构。
- `app/globals.css`：旧版页面和弹层的视觉规则。
- `app/layout.tsx`：旧版字体与页面元数据。
- `app/chatgpt-auth.ts`：旧版运行时辅助文件，保留以完整反映原有 `app/` 目录。
- `package.json`：旧版 vinext/Next 依赖快照。

## 设计基线

图片详情弹层以以下规则为基线：

1. 桌面端为左侧图片、右侧纸色信息栏的双栏布局。
2. 关闭按钮为右上角圆形 `x` 图标。
3. 图片不能侵入右侧文字栏；文字与标签不能覆盖图片。
4. 移动端切换为单列，图片在上、信息在下。

## 来源

该档案从 Git 提交 `ee13fad231804223f89f6e607c49e0eb3de38ba4` 的 `app/` 目录和 `package.json` 恢复。

当前运行中的站点是 Astro 实现。后续视觉调整应修改 `src/` 和 `public/scripts/`，并以本目录作为比对依据；不要将本目录重新接入当前构建流程。
