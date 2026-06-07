# 网站内容优化修复计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 系统性修复智能抠图工具网站中存在的内容不一致、术语混用、信息矛盾、教程缺失等问题，提升内容质量和用户体验。

**Architecture:** 按优先级从高到低分4批次修复：P0严重问题 → P1重要问题 → P2一般问题 → P3优化建议。每批次内按文件维度批量修改，减少文件反复切换。

**Tech Stack:** HTML, JavaScript (i18n), CSS

---

## 批次一：P0 严重问题（信息矛盾/缺失）

### Task 1: 统一版权年份

**Files:**
- Modify: `js/i18n/locales/zh-CN.js:178` — `© 2025` → `© 2024-2025`
- Modify: `index.html` 页脚 — 确认为 `© 2025` 需改为 `© 2024-2025`

**Step 1: 修改 zh-CN.js 版权文本**

将 `footer.copyright` 的值从 `'© 2025 智能抠图工具. 保留所有权利.'` 改为 `'© 2024-2025 智能抠图工具. 保留所有权利.'`

**Step 2: 修改 en-US.js 版权文本**

将 `footer.copyright` 的值从 `'© 2025 Smart Cutout Tool. All rights reserved.'` 改为 `'© 2024-2025 Smart Cutout Tool. All rights reserved.'`

**Step 3: 修改 index.html 页脚**

将页脚 `<p class="footer-copyright">` 中的 `© 2025` 改为 `© 2024-2025`

**Step 4: 验证所有页面版权信息一致**

确认 tutorials.html、about.html、contact.html、privacy.html 页脚已是 `© 2024-2025`，无需修改。

---

### Task 2: 修正教程列表页阅读时间与文章页一致

**Files:**
- Modify: `pages/tutorials.html` — 5篇教程的阅读时间

**Step 1: 修改 tutorials.html 中5张教程卡片的阅读时间**

| 教程 | 当前列表页时间 | 文章页时间 | 修改为 |
|------|---------------|-----------|--------|
| 智能抠图 | 约15分钟 | 约20分钟 | 约20分钟 |
| 魔术棒 | 约12分钟 | 约18分钟 | 约18分钟 |
| 画笔涂抹 | 约10分钟 | 约22分钟 | 约22分钟 |
| 形状抠图 | 约10分钟 | 约16分钟 | 约16分钟 |
| 边缘处理 | 约18分钟 | 约18分钟 | 约18分钟（不变） |

---

### Task 3: 统一教程难度标签

**Files:**
- Modify: `pages/tutorials.html` — 形状抠图标签
- Modify: `pages/articles/article-shapecut.html` — 难度标签
- Modify: `pages/articles/article-edge.html` — 难度标签

**Step 1: 修改 tutorials.html 形状抠图标签**

将形状抠图卡片的 `<span class="tutorial-badge">进阶</span>` 改为 `<span class="tutorial-badge">入门</span>`

**Step 2: 修改 article-shapecut.html 难度标签**

将 `<span class="meta-item">入门教程</span>` 保持不变（已正确）

**Step 3: 修改 article-edge.html 难度标签**

将文章页的"进阶教程"改为"高级教程"，与列表页"高级"标签一致

---

### Task 4: 新增阴影处理教程文章

**Files:**
- Create: `pages/articles/article-shadow.html`
- Modify: `pages/tutorials.html` — 新增教程卡片
- Modify: `pages/articles/article-edge.html` — 修改"下一篇"导航

**Step 1: 创建 article-shadow.html**

创建完整的阴影处理教程文章，包含以下章节：
- 阴影处理概述
- 边缘检测功能详解（参数：模糊度、弱/强边缘灵敏度）
- 阴影检测功能详解（参数：最大阴影距离、阴影差异度）
- 阴影画笔工具（添加/抹除模式、大小、硬度）
- 阴影半透明度调节
- 完整操作流程（5步）
- 选区颜色说明（紫色/粉色/青色）
- 实战案例：带阴影的商品抠图
- 常见问题与解决方案

**Step 2: 在 tutorials.html 新增教程卡片**

在边缘处理卡片后添加阴影处理教程卡片：
- 标题：阴影识别与处理完全指南
- 描述：掌握边缘检测、阴影检测和阴影画笔的使用，实现带阴影物体的精准抠图，保留自然阴影效果。
- 难度：高级
- 阅读时间：约20分钟
- 日期：2025-05-28

**Step 3: 修改 article-edge.html 的"下一篇"导航**

将"下一篇"从无（当前为最后一篇）改为指向 `article-shadow.html`

---

### Task 5: 子页面接入 i18n 国际化（规划，暂不实施）

**说明：** 此任务工作量极大（需为6+个HTML文件添加 data-i18n 属性、引入i18n模块、添加语言切换器、翻译所有文本内容），建议作为独立迭代处理。当前仅记录问题，不在本批次实施。

**需要修改的文件清单：**
- `pages/tutorials.html`
- `pages/about.html`
- `pages/contact.html`
- `pages/privacy.html`
- `pages/articles/article-smartcut.html`
- `pages/articles/article-magicwand.html`
- `pages/articles/article-brush.html`
- `pages/articles/article-shapecut.html`
- `pages/articles/article-edge.html`
- `pages/articles/article-shadow.html`（新增）

**i18n 需新增的翻译键：** 需为每个页面的所有硬编码文本创建对应的 i18n 键。

---

## 批次二：P1 重要问题（术语不一致/表述含糊）

### Task 6: 统一"魔术棒"术语，消除"魔法棒"

**Files:**
- Modify: `js/i18n/locales/zh-CN.js:112` — `toolbar.shadowFlow1`

**Step 1: 修改 zh-CN.js**

将 `shadowFlow1: '1. 先用智能抠图/魔法棒确定紫色选区'` 改为 `shadowFlow1: '1. 先用智能抠图/魔术棒确定紫色选区'`

**Step 2: 修改 en-US.js**

将 `shadowFlow1: '1. Use Smart Cut / Magic Wand to create purple selection'` 保持不变（英文无此问题）

**Step 3: 检查 index.html 中阴影流程提示**

确认 index.html 中 `data-i18n="toolbar.shadowFlow1"` 的默认文本也使用"魔术棒"

---

### Task 7: 优化"删除选区"按钮命名

**Files:**
- Modify: `js/i18n/locales/zh-CN.js:153` — `toolbar.deleteSelection`
- Modify: `js/i18n/locales/en-US.js:153` — `toolbar.deleteSelection`
- Modify: `index.html` — 按钮默认文本和title

**Step 1: 修改 zh-CN.js**

将 `deleteSelection: '删除选区'` 改为 `deleteSelection: '抠除选区'`

**Step 2: 修改 en-US.js**

将 `deleteSelection: 'Delete Selection'` 改为 `deleteSelection: 'Cut Out Selection'`

**Step 3: 修改 index.html 按钮文本**

将删除选区按钮的 `<span data-i18n="toolbar.deleteSelection">删除选区</span>` 改为 `<span data-i18n="toolbar.deleteSelection">抠除选区</span>`
将 `data-i18n-title="toolbar.deleteSelection" title="删除选中区域"` 改为 `title="抠除选中区域"`

---

### Task 8: 画笔"取消"模式改名为"减去"

**Files:**
- Modify: `js/i18n/locales/zh-CN.js:90` — `toolbar.brushSubtract`
- Modify: `index.html` — 画笔模式按钮默认文本和title

**Step 1: 修改 zh-CN.js**

将 `brushSubtract: '取消'` 改为 `brushSubtract: '减去'`
将 `brushHintSubtract: '• 取消模式：涂抹取消选区'` 改为 `brushHintSubtract: '• 减去模式：涂抹减去选区'`

**Step 2: 修改 en-US.js**

保持 `brushSubtract: 'Subtract'` 不变（已准确）

**Step 3: 修改 index.html 画笔按钮**

将 `id="brushSubtractMode"` 按钮的 `<span data-i18n="toolbar.brushSubtract">取消</span>` 改为 `<span data-i18n="toolbar.brushSubtract">减去</span>`
将 `title="取消选区"` 改为 `title="减去选区"`

---

### Task 9: 统一图片尺寸建议

**Files:**
- Modify: `pages/articles/article-smartcut.html` — FAQ中图片尺寸建议

**Step 1: 修改 article-smartcut.html FAQ**

将 `建议将图片尺寸控制在 2000x2000 像素以内` 改为 `建议图片尺寸不超过 4000×4000 像素，以获得最佳处理速度和效果，推荐在 2000×2000 像素以内`

**Step 2: 验证 contact.html 无需修改**

contact.html FAQ 已为"不超过 4000×4000 像素"，无需修改。

---

### Task 10: 修正人体分割模型大小描述

**Files:**
- Modify: `pages/articles/article-smartcut.html` — 准备工作部分

**Step 1: 修改 article-smartcut.html 准备工作**

将 `稳定的网络连接（首次加载模型需要下载约 2MB 数据）` 改为 `稳定的网络连接（首次加载人体分割模型需要下载约 5-10MB 数据）`

---

### Task 11: 删除颜色聚类教程中"吸管工具"的提及

**Files:**
- Modify: `pages/articles/article-smartcut.html` — 颜色聚类模式操作步骤

**Step 1: 修改 article-smartcut.html**

将步骤2中 `或使用吸管工具在画布上精确选取颜色` 删除，改为 `系统会自动显示检测到的主要颜色群组，点击您想要去除的背景颜色即可。`

---

### Task 12: 明确区分"选区降噪"与"全图去噪"的描述

**Files:**
- Modify: `js/i18n/locales/zh-CN.js:107-108` — 后处理提示文本

**Step 1: 修改 zh-CN.js 后处理提示**

将：
```
postProcessHint1: '• 选区降噪：抠图前清理选区噪点',
postProcessHint2: '• 框选去噪：局部区域清理噪点',
postProcessHint3: '• 全图去噪：抠图后清理图像噪点',
```
改为：
```
postProcessHint1: '• 选区降噪：基于连通区域分析，清理选区蒙版中的孤立噪点和空洞',
postProcessHint2: '• 框选去噪：对指定矩形区域执行局部降噪，不影响其他区域',
postProcessHint3: '• 全图去噪：对整张图片的选区和未选区域同时执行降噪处理',
```

**Step 2: 修改 en-US.js 对应文本**

同步更新英文描述，使其更精确。

---

## 批次三：P2 一般问题（格式规范/一致性）

### Task 13: 修复 article 页脚缺 © 符号

**Files:**
- Modify: `pages/articles/article-magicwand.html` — 页脚
- Modify: `pages/articles/article-shapecut.html` — 页脚

**Step 1: 修改 article-magicwand.html 页脚**

将 `<p> 2025 智能抠图工具. 保留所有权利.</p>` 改为 `<p>&copy; 2024-2025 智能抠图工具. 保留所有权利.</p>`

**Step 2: 修改 article-shapecut.html 页脚**

同样修复。

---

### Task 14: 将中文按钮ID改为英文

**Files:**
- Modify: `index.html` — `id="框选去除噪点Btn"`

**Step 1: 修改 index.html**

将 `id="框选去除噪点Btn"` 改为 `id="boxDenoiseBtn"`

**Step 2: 搜索引用此ID的JS代码并同步修改**

在 `js/` 目录下搜索 `框选去除噪点Btn` 并替换为 `boxDenoiseBtn`

---

### Task 15: 统一英文产品名

**Files:**
- Modify: `js/i18n/locales/en-US.js:3` — `pageTitle`
- Modify: `js/i18n/locales/en-US.js:9` — `header.logoText`

**Step 1: 统一为 "Smart Cutout"**

将 `pageTitle: 'Smart Cutout Tool - Online Image Processing'` 保持不变
将 `header.logoText: 'Smart Cutout'` 保持不变
将 `toolbar.smartCut: 'Smart Cut'` 改为 `toolbar.smartCut: 'Smart Cutout'`（与产品名一致）

**Step 2: 检查其他英文出现处**

确认 footer.copyright 中已是 "Smart Cutout Tool"，无需修改。

---

### Task 16: 统一导航栏结构（规划，暂不实施）

**说明：** 此任务涉及重构所有子页面的导航栏HTML结构，工作量较大，建议作为独立迭代处理。当前仅记录问题。

**目标结构：** 所有页面统一使用 `<nav class="page-nav">` 结构，子页面添加语言切换器。

---

### Task 17: 统一页脚结构（规划，暂不实施）

**说明：** 同上，涉及所有页面重构，建议独立迭代。

**目标结构：** 所有页面统一使用四栏网格页脚。

---

## 批次四：P3 优化建议（可读性/体验提升）

### Task 18: 补充右侧面板使用说明步骤

**Files:**
- Modify: `js/i18n/locales/zh-CN.js` — infoPanel 部分
- Modify: `js/i18n/locales/en-US.js` — infoPanel 部分
- Modify: `index.html` — 信息面板说明

**Step 1: 在 zh-CN.js 中扩展说明步骤**

在 `infoPanel` 中新增 instruction5 和 instruction6：
```
instruction5: '使用形状抠图快速创建规则选区，或使用后处理工具优化边缘',
instruction6: '点击"抠除选区"移除背景，再点击"下载图片"保存结果'
```

**Step 2: 在 en-US.js 中同步新增**

**Step 3: 在 index.html 中添加对应的说明项**

---

### Task 19: 新增快捷键大全教程（规划，暂不实施）

**说明：** 需要新建完整的教程文章页面，工作量较大，建议独立迭代。

---

### Task 20: 联系表单添加"演示环境"标注

**Files:**
- Modify: `pages/contact.html` — 表单区域

**Step 1: 在表单标题下方添加提示**

在"在线留言"标题的 `<p>` 标签后添加：
```html
<div class="highlight-box" style="margin-top: 12px;">
    <p><strong>提示：</strong>当前表单为演示功能，暂未接入后端服务。如有紧急问题，请直接发送邮件至 contact@smartcut.example.com</p>
</div>
```

---

### Task 21: 更新"即将开通"的社交账号状态

**Files:**
- Modify: `pages/contact.html` — 社交媒体卡片

**Step 1: 为微信公众号和微博卡片添加"暂未开通"标识**

将 `<p>智能抠图工具（即将开通）</p>` 改为 `<p>智能抠图工具 <span style="color: var(--text-tertiary); font-size: 0.85em;">（暂未开通）</span></p>`
将 `<p>@智能抠图工具（即将开通）</p>` 改为 `<p>@智能抠图工具 <span style="color: var(--text-tertiary); font-size: 0.85em;">（暂未开通）</span></p>`

---

## 执行顺序总结

| 执行顺序 | Task | 内容 | 预计工作量 |
|---------|------|------|-----------|
| 1 | Task 1 | 统一版权年份 | 5分钟 |
| 2 | Task 2 | 修正教程阅读时间 | 5分钟 |
| 3 | Task 3 | 统一教程难度标签 | 5分钟 |
| 4 | Task 6 | 统一"魔术棒"术语 | 3分钟 |
| 5 | Task 7 | "删除选区"改名"抠除选区" | 5分钟 |
| 6 | Task 8 | 画笔"取消"改"减去" | 5分钟 |
| 7 | Task 9 | 统一图片尺寸建议 | 3分钟 |
| 8 | Task 10 | 修正模型大小描述 | 2分钟 |
| 9 | Task 11 | 删除"吸管工具"提及 | 2分钟 |
| 10 | Task 12 | 明确去噪功能描述 | 5分钟 |
| 11 | Task 13 | 修复页脚©符号 | 3分钟 |
| 12 | Task 14 | 中文按钮ID改英文 | 5分钟 |
| 13 | Task 15 | 统一英文产品名 | 3分钟 |
| 14 | Task 18 | 补充面板说明步骤 | 5分钟 |
| 15 | Task 20 | 联系表单演示标注 | 3分钟 |
| 16 | Task 21 | 更新社交账号状态 | 3分钟 |
| 17 | Task 4 | 新增阴影处理教程 | 30分钟 |
| — | Task 5 | 子页面i18n接入（规划） | 大 |
| — | Task 16 | 统一导航栏（规划） | 大 |
| — | Task 17 | 统一页脚（规划） | 大 |
| — | Task 19 | 快捷键教程（规划） | 大 |
