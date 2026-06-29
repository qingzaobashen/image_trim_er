# 项目长期记忆

## 项目概述
- 项目名：pictureProcess（抠白底图工具）
- 定位：在线图片处理工具，支持AI智能抠图、魔术棒、画笔、形状抠图、阴影处理、图片压缩、图片裁剪
- 部署：GitHub Pages，Supabase Storage 存储模型文件

## 技术栈
- 构建：Vite v6, pnpm
- 前端：原生 JavaScript ES6 Module（无框架）
- 样式：原生 CSS3，暗色主题，CSS 变量体系
- 字体：Google Fonts (Noto Sans SC + Space Grotesk)
- AI：Transformers.js (HuggingFace)，TensorFlow.js, OpenCV.js
- 国际化：自研 i18n 引擎 (ES6 Module 单例)

## 项目架构
- 表现层：index.html + style.css / pages.css
- 控制层：main.js (App 类)
- 业务层：imageProcessor.js（核心调度器）
- 工具层：src/js/tools/ 下各工具模块
- 基础设施：src/js/utils/ (CanvasUtils, ZoomManager, UndoRedoManager)
- 独立页面：pages/*.html，通过 Vite 多页面配置自动构建

## 代码规范
- 一个文件一个类，职责单一
- JSDoc 注释（所有公共方法）
- 驼峰命名 (camelCase)，类大驼峰 (PascalCase)
- 私有方法 `_` 前缀
- 事件委托模式，data-tool 属性识别
- 子页面使用 pages.css 共享样式，通过 CSS 变量保持主题一致

## 添加新功能页面指南
1. 创建 `pages/new-feature.html`（继承 page-nav 导航 + page-main 布局）
2. 创建 `src/js/new-feature.js`（ES6 Module，导入 i18n 单例）
3. 在 zh-CN.js 和 en-US.js 添加翻译（nav.xxx + xxxPage 命名空间）
4. 在所有页面的导航栏（.page-nav > .nav-links）添加新入口链接
5. Vite 自动扫描 pages/*.html 作为多页面入口

## 图片裁剪功能 (2026-06-28)
- 页面：pages/crop.html
- 逻辑：src/js/crop.js (CropApp 类)
- 特性：四种形状（矩形/圆形/椭圆/多边形），宫格模式（1x2~自定义10x10），实时拖拽交互，独立单元格导出
- 协作：通过 sessionStorage 的 crop-restore-blob 键从主应用传递图片
