# 智能抠图工具 — 项目架构设计文档

> 版本：1.0  
> 更新日期：2026-05-28  
> 项目名称：智能抠图工具（pictureProcess）

---

## 目录

1. [系统总体架构](#1-系统总体架构)
2. [模块划分与职责说明](#2-模块划分与职责说明)
3. [核心业务流程](#3-核心业务流程)
4. [技术栈选型及理由](#4-技术栈选型及理由)
5. [数据模型设计](#5-数据模型设计)
6. [接口规范](#6-接口规范)
7. [安全策略](#7-安全策略)
8. [性能优化方案](#8-性能优化方案)
9. [扩展性设计](#9-扩展性设计)
10. [部署架构](#10-部署架构)

---

## 1. 系统总体架构

### 1.1 架构概述

本系统采用**纯前端单页应用（SPA）**架构，所有图像处理逻辑均在浏览器端完成，无需后端服务器参与计算。系统基于 Canvas API 构建图像处理管线，采用分层架构将 UI 交互、业务逻辑和底层算法解耦。

### 1.2 架构分层图

```
┌─────────────────────────────────────────────────────────┐
│                     表现层 (Presentation)                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │ index.   │  │ style.   │  │  SVG     │  │ Google  │ │
│  │ html     │  │ css      │  │  Icons   │  │ Fonts   │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘ │
├─────────────────────────────────────────────────────────┤
│                    应用控制层 (Application)               │
│  ┌──────────────────────────────────────────────────────┐│
│  │                    App (main.js)                      ││
│  │  事件分发 │ 工具切换 │ 状态管理 │ UI更新 │ 快捷键    ││
│  └──────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────┤
│                    业务逻辑层 (Business)                  │
│  ┌──────────────────────────────────────────────────────┐│
│  │              ImageProcessor (核心调度器)               ││
│  │  选区管理 │ 历史记录 │ 图像导出 │ 后处理协调         ││
│  └──────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────┤
│                    工具算法层 (Tools)                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │
│  │SmartCut  │ │MagicWand │ │ Brush    │ │ ShapeCut  │  │
│  │智能抠图  │ │魔术棒    │ │ 画笔涂抹 │ │ 形状抠图  │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                │
│  │EdgeSmooth│ │Shadow    │ │Region    │                │
│  │边缘光滑  │ │阴影处理  │ │框选工具  │                │
│  └──────────┘ └──────────┘ └──────────┘                │
├─────────────────────────────────────────────────────────┤
│                    基础设施层 (Infrastructure)            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │
│  │Canvas    │ │Selection │ │Zoom      │ │Selection  │  │
│  │Utils     │ │History   │ │Manager   │ │Transform  │  │
│  │Canvas工具│ │选区历史  │ │缩放管理  │ │选区变换   │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────┘  │
├─────────────────────────────────────────────────────────┤
│                    外部依赖层 (External)                  │
│  ┌──────────────────────┐  ┌─────────────────────────┐  │
│  │   Canvas API         │  │  TensorFlow.js +        │  │
│  │   (浏览器原生)       │  │  BodyPix (AI人体分割)   │  │
│  └──────────────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 1.3 数据流向图

```
用户操作
  │
  ▼
┌─────────┐   事件    ┌──────────────┐   方法调用   ┌────────────────┐
│  UI 事件 │ ───────▶ │  App 控制器   │ ──────────▶ │ ImageProcessor │
│ (DOM)   │          │  (main.js)   │             │  (核心调度器)   │
└─────────┘          └──────────────┘             └───────┬────────┘
                                                          │
                                    ┌─────────────────────┼────────────────────┐
                                    │                     │                    │
                                    ▼                     ▼                    ▼
                              ┌──────────┐         ┌──────────┐         ┌──────────┐
                              │ 工具模块  │         │ 后处理   │         │ 历史管理  │
                              │(smartCut │         │(edgeSmooth│         │(selection│
                              │magicWand │         │shadow)   │         │History)  │
                              │brush...) │         │          │         │          │
                              └────┬─────┘         └────┬─────┘         └──────────┘
                                   │                    │
                                   ▼                    ▼
                              ┌──────────────────────────────┐
                              │       Canvas API              │
                              │  mainCanvas  │ overlayCanvas  │
                              │  (图像数据)   │ (选区可视化)    │
                              └──────────────────────────────┘
```

---

## 2. 模块划分与职责说明

### 2.1 项目文件结构

```
pictureProcess/
├── index.html                    # 应用入口页面
├── css/
│   └── style.css                 # 全局样式（CSS变量 + 组件样式）
├── js/
│   ├── main.js                   # 应用控制层 - App 类
│   ├── imageProcessor.js         # 业务逻辑层 - ImageProcessor 类
│   ├── tools/                    # 工具算法层
│   │   ├── smartCut.js           # 智能抠图工具
│   │   ├── magicWand.js          # 魔术棒工具
│   │   ├── brush.js              # 画笔涂抹工具（含橡皮擦）
│   │   ├── shapeCut.js           # 形状抠图工具
│   │   ├── edgeSmoother.js       # 边缘光滑处理
│   │   ├── shadowProcessor.js    # 阴影处理工具
│   │   ├── regionSelector.js     # 框选工具
│   │   └── selectionTransform.js # 选区变换管理器
│   └── utils/                    # 基础设施层
│       ├── canvasUtils.js        # Canvas 通用工具函数
│       ├── selectionHistory.js   # 选区历史管理器
│       └── zoomManager.js        # 缩放/平移管理器
├── docs/                         # 算法参考文档
├── TestCase/                     # 测试用例截图
├── doc/                          # 架构设计文档
└── README.md                     # 项目说明
```

### 2.2 各模块职责详述

#### 2.2.1 表现层

| 文件 | 职责 |
|------|------|
| `index.html` | 定义页面结构，包含双 Canvas 架构（mainCanvas + overlayCanvas）、工具栏、参数面板、缩放控件等 DOM 元素 |
| `style.css` | 基于 CSS 变量的主题系统（暗色主题）、组件样式、响应式布局、动画效果 |

#### 2.2.2 应用控制层 — `App` 类（main.js）

| 职责 | 说明 |
|------|------|
| DOM 引用管理 | 缓存所有需要操作的 DOM 元素引用 |
| 事件绑定与分发 | 绑定 UI 事件（按钮点击、Canvas 交互、键盘快捷键），分发到对应处理器 |
| 工具状态管理 | 维护当前选中工具（smartCut / magicWand / brush / shapeCut / regionSelect / shadowProcess） |
| 画笔模式管理 | 维护画笔添加/取消模式，支持 Alt 键临时切换 |
| 加载状态管理 | 控制加载遮罩层的显示/隐藏 |
| 通知系统 | 提供内联通知消息（success / warning / error / info） |
| 文件处理 | 图片上传、格式验证、图片信息展示 |
| 缩放操作代理 | 代理 ZoomManager 的缩放操作到 UI 按钮 |

#### 2.2.3 业务逻辑层 — `ImageProcessor` 类（imageProcessor.js）

| 职责 | 说明 |
|------|------|
| 图像生命周期管理 | 加载图片、重置图片、导出/下载图片 |
| 选区蒙版管理 | 维护 `currentMask`（Uint8ClampedArray），支持选区的添加、减去、反选、清除 |
| 工具调度 | 协调各工具模块的调用，传递参数并收集结果 |
| 历史记录管理 | 维护操作历史栈（最多 50 步），支持撤销/重做 |
| 选区渲染 | 将蒙版数据渲染到 overlayCanvas（紫色半透明覆盖） |
| 后处理协调 | 协调选区降噪、框选去噪、全图去噪、边缘光滑、阴影处理等后处理操作 |
| 删除动画 | 执行选区删除前的闪烁确认动画 |

#### 2.2.4 工具算法层

| 模块 | 类名 | 职责 |
|------|------|------|
| `smartCut.js` | `SmartCutTool` | 智能抠图核心算法：自动选择、颜色聚类、边缘检测、人体分割（BodyPix） |
| `magicWand.js` | `MagicWandTool` | 魔术棒选择：基于颜色相似度的洪水填充 / 全局相似色选择 |
| `brush.js` | `BrushTool` / `EraserTool` | 画笔涂抹：支持大小/硬度/模式调节，实时绘制到 overlayCanvas |
| `shapeCut.js` | `ShapeCutTool` | 形状抠图：矩形、圆形、椭圆、花瓣、星形、心形，含选区变换 |
| `edgeSmoother.js` | `EdgeSmoother` | 边缘光滑：基于边缘检测 + 高斯模糊的混合平滑 |
| `shadowProcessor.js` | `ShadowProcessor` | 阴影处理：白底图阴影识别、距离图计算、半透明 alpha 蒙版生成 |
| `regionSelector.js` | `RegionSelector` | 框选工具：矩形区域选择，用于局部去噪 |
| `selectionTransform.js` | `SelectionTransformManager` | 选区变换：8 个控制点的缩放/平移操作，光标样式管理 |

#### 2.2.5 基础设施层

| 模块 | 类名/类型 | 职责 |
|------|-----------|------|
| `canvasUtils.js` | 工具函数集 | Canvas 上下文获取、尺寸设置、图像绘制/读取、像素颜色操作、颜色距离计算、临时 Canvas 创建等 |
| `selectionHistory.js` | `SelectionHistory` | 选区操作历史管理：记录每次选区操作的蒙版和元数据，支持撤销/重做/累积计算 |
| `zoomManager.js` | `ZoomManager` | 缩放与平移管理：鼠标滚轮缩放、触摸板手势识别、坐标转换（屏幕↔Canvas）、适应窗口 |

---

## 3. 核心业务流程

### 3.1 图片加载流程

```
用户点击上传按钮
      │
      ▼
fileInput.click() 触发文件选择
      │
      ▼
handleFileSelect(e)
      │
      ├── 验证文件类型（image/*）
      │
      ▼
ImageProcessor.loadImage(file)
      │
      ├── FileReader.readAsDataURL(file)
      │
      ├── new Image() 加载 DataURL
      │
      ├── 设置 mainCanvas / overlayCanvas 尺寸
      │
      ├── 绘制图片到 mainCanvas
      │
      ├── 初始化 currentMask（全零 Uint8ClampedArray）
      │
      ├── 保存初始状态到历史记录
      │
      └── 备份原始图像数据到 deletedPixelsRGB
      │
      ▼
App 更新 UI（图片信息、按钮状态）
      │
      ▼
ZoomManager.fitToWindow() 自适应窗口
```

### 3.2 智能抠图流程

```
用户选择抠图模式 → 点击"应用智能抠图"
      │
      ▼
App.handleApplySmartCut()
      │
      ├── 显示加载遮罩
      │
      ├── 设置 SmartCutTool 模式
      │
      ▼
SmartCutTool.apply()
      │
      ├── mode='auto'  → applyAutoSegmentation()
      │     ├── 检测背景色（边缘采样）
      │     ├── 计算背景一致性
      │     ├── 高一致性 → applyColorBasedSegmentation()
      │     └── 低一致性 → applyEdgeBasedSegmentation()
      │
      ├── mode='color' → applyColorBasedSegmentation()
      │     ├── 检测背景色
      │     ├── K-Means 颜色聚类
      │     ├── 生成前景/背景蒙版
      │     └── 边缘平滑处理
      │
      ├── mode='edge'  → applyEdgeBasedSegmentation()
      │     ├── Sobel 算子边缘检测
      │     ├── 中心点洪水填充
      │     └── 边缘平滑处理
      │
      └── mode='person' → applyPersonSegmentation()
            ├── 加载 BodyPix 模型（首次约 4MB）
            ├── 人体语义分割
            └── 蒙版后处理
      │
      ▼
ImageProcessor.applySmartCut(smoothness)
      │
      ├── 设置平滑度参数
      │
      ├── 调用 SmartCutTool.apply() 获取蒙版
      │
      ├── 更新 currentMask
      │
      ├── renderSelection() 渲染选区覆盖层
      │
      └── saveToHistory() 保存到历史记录
```

### 3.3 魔术棒选择流程

```
用户点击画布（魔术棒工具激活）
      │
      ▼
App.handleCanvasClick(e)
      │
      ├── 坐标转换：屏幕坐标 → Canvas 坐标
      │     (ZoomManager.screenToCanvas)
      │
      ├── 判断修饰键：
      │     ├── Shift+点击 → addToSelection (添加到选区)
      │     ├── Alt+点击   → subtractFromSelection (从选区减去)
      │     └── 普通点击   → magicWandSelect (累加选择)
      │
      ▼
MagicWandTool.select(x, y)
      │
      ├── 更新图像数据（getImageData）
      │
      ├── 获取目标像素颜色
      │
      ├── contiguous=true  → floodFill() 洪水填充
      │     └── BFS 遍历相邻像素，颜色距离 ≤ tolerance 则选中
      │
      └── contiguous=false → selectSimilar() 全局选择
            └── 遍历全部像素，颜色距离 ≤ tolerance 则选中
      │
      ▼
ImageProcessor 合并蒙版 → renderSelection() → saveToHistory()
```

### 3.4 画笔涂抹流程

```
用户在画布上拖动（画笔工具激活）
      │
      ▼
App.handleCanvasMouseDown(e)
      │
      ├── 坐标转换
      │
      ├── Alt 键判断：临时反转画笔模式
      │
      ├── 计算画笔实际大小（size / scale）
      │
      ▼
ImageProcessor.startBrushDrawing(x, y, size, hardness, mode, scale)
      │
      ▼
BrushTool.startDrawing(x, y)
      │
      ├── 设置画笔样式（颜色、模糊度）
      │     ├── add 模式 → 紫色半透明 (rgba(99,102,241,0.5))
      │     └── subtract 模式 → 红色半透明 (rgba(239,68,68,0.5))
      │
      └── 绘制到 overlayCanvas
      │
      ▼ (鼠标移动)
BrushTool.draw(x, y) → 连续线段绘制
      │
      ▼ (鼠标抬起)
ImageProcessor.stopBrushDrawing()
      │
      ├── 获取画笔蒙版（BrushTool.getBrushMask）
      │
      ├── 记录到 SelectionHistory
      │
      ├── 合并画笔蒙版到 currentMask
      │
      ├── 清除画笔临时绘制
      │
      ├── renderSelection() 重新渲染选区
      │
      └── saveToHistory()
```

### 3.5 形状抠图流程

```
用户选择形状 → 在画布上拖动绘制
      │
      ▼
ShapeCutTool.startDrawing(x, y)
      │
      ▼ (鼠标移动)
ShapeCutTool.updateDrawing(x, y)
      │
      ├── 清除 overlayCanvas
      │
      ├── 绘制形状预览（虚线轮廓）
      │
      └── 显示尺寸标注
      │
      ▼ (鼠标抬起)
ShapeCutTool.finishDrawing()
      │
      ├── 计算选区边界 bounds
      │
      ├── 生成形状蒙版（根据 shapeType）
      │     ├── rectangle → 矩形蒙版
      │     ├── circle    → 圆形蒙版
      │     ├── ellipse   → 椭圆蒙版
      │     ├── petal     → 花瓣蒙版（极坐标方程）
      │     ├── star      → 星形蒙版（极坐标方程）
      │     └── heart     → 心形蒙版（参数方程）
      │
      ├── 显示 SelectionTransformManager 控制框
      │     └── 8 个控制点 + 移动手柄
      │
      └── 返回 { mask, bounds }
      │
      ▼
用户可拖动控制点调整选区 → updateShapeMaskFromBounds()
      │
      ▼
确认选区 → 删除/导出
```

### 3.6 后处理流程

```
抠图完成后 → 后处理操作
      │
      ├── 选区降噪（抠图前）
      │     └── removeSmallRegionsFromSelection(minArea)
      │           ├── BFS 分析已选区域中的小未选噪点 → 清除
      │           └── BFS 分析未选区域中的小已选噪点 → 填充
      │
      ├── 框选去噪（局部）
      │     └── RegionSelector 框选 → removeSmallRegionsInArea(minArea, region)
      │
      ├── 全图去噪（抠图后）
      │     └── removeSmallRegions(minArea)
      │           ├── 移除小的不透明噪点（透明化）
      │           └── 移除小的透明噪点（恢复原始像素）
      │
      ├── 边缘光滑
      │     └── EdgeSmoother.smooth(strength)
      │           ├── Sobel 边缘检测 → edgeMask
      │           ├── 高斯模糊 → blurredData
      │           └── 边缘区域混合（原始 × (1-blend) + 模糊 × blend）
      │
      └── 阴影处理
            └── ShadowProcessor.process(mask, options)
                  ├── 检测背景色
                  ├── 计算前景边缘距离图
                  ├── 识别阴影区域（颜色差异 + 距离约束）
                  └── 生成半透明 alpha 蒙版 → 应用到 Canvas
```

---

## 4. 技术栈选型及理由

### 4.1 技术栈总览

| 层次 | 技术 | 版本要求 | 选型理由 |
|------|------|----------|----------|
| 页面结构 | HTML5 | - | 语义化标签、Canvas 支持、File API |
| 样式系统 | CSS3 + CSS Variables | - | 原生主题变量、Flexbox/Grid 布局、动画 |
| 编程语言 | JavaScript (ES6+) | ES2020+ | 原生模块化（import/export）、async/await、Uint8ClampedArray |
| 图像处理 | Canvas 2D API | - | 浏览器原生、像素级操作、高性能位图处理 |
| AI 推理 | TensorFlow.js + BodyPix | MobileNetV1 | 浏览器端人体分割、无需服务端、模型体积可控 |
| 字体 | Google Fonts (Noto Sans SC + Space Grotesk) | - | 中文优化 + 现代西文显示字体 |
| 模块化 | ES Modules (native) | - | 零构建依赖、浏览器原生支持、清晰依赖关系 |

### 4.2 关键技术选型分析

#### 4.2.1 为什么选择原生 JavaScript 而非框架

| 对比项 | 原生 JS | React/Vue |
|--------|---------|-----------|
| 构建依赖 | 无需构建工具 | 需要 Webpack/Vite 等 |
| 包体积 | 0 KB 额外开销 | 40KB+ 运行时 |
| Canvas 集成 | 直接操作，无虚拟 DOM 开销 | 需 ref 桥接，性能损耗 |
| 部署复杂度 | 静态文件直接部署 | 需构建流水线 |
| 适用场景 | 图像处理等重计算型应用 | 数据驱动的 CRUD 应用 |

**结论**：本项目核心是 Canvas 像素操作，UI 状态相对简单，原生 JS 直接操作 DOM 和 Canvas 效率最高。

#### 4.2.2 为什么选择 Canvas API 而非 WebGL

| 对比项 | Canvas 2D | WebGL |
|--------|-----------|-------|
| 开发复杂度 | 低，API 简洁 | 高，需着色器编程 |
| 像素操作 | getImageData/putImageData 直接操作 | 需纹理上传/下载 |
| 兼容性 | 所有现代浏览器 | 需 GPU 支持 |
| 性能上限 | 适合中低分辨率 | 适合高分辨率实时处理 |

**结论**：当前图片处理场景（建议 2000×2000 以下）Canvas 2D 性能足够，开发效率远高于 WebGL。若未来需要实时视频处理，可引入 WebGL 加速。

#### 4.2.3 为什么选择 BodyPix 而非其他人体分割模型

| 对比项 | BodyPix | MediaPipe | Selfie Segmentation |
|--------|---------|-----------|---------------------|
| 模型体积 | ~4MB | ~10MB+ | ~3MB |
| 推理速度 | 中等 | 快 | 快 |
| API 复杂度 | 简单 | 复杂 | 中等 |
| 浏览器兼容 | 广泛 | 需 WASM | 需 WASM |

**结论**：BodyPix 模型体积适中、API 简洁、兼容性好，适合本项目按需加载的使用模式。

---

## 5. 数据模型设计

### 5.1 核心数据结构

#### 5.1.1 选区蒙版（currentMask）

```
┌────────────────────────────────────────────┐
│          currentMask: Uint8ClampedArray     │
│          长度 = imageWidth × imageHeight    │
│                                            │
│   每个像素对应一个字节：                     │
│     0   → 未选中（背景）                    │
│     255 → 已选中（前景）                    │
│                                            │
│   索引计算：index = y × imageWidth + x      │
│                                            │
│   ┌───┬───┬───┬───┬───┐                    │
│   │ 0 │ 0 │255│255│ 0 │  ← 第 0 行         │
│   ├───┼───┼───┼───┼───┤                    │
│   │ 0 │255│255│255│ 0 │  ← 第 1 行         │
│   ├───┼───┼───┼───┼───┤                    │
│   │ 0 │ 0 │255│ 0 │ 0 │  ← 第 2 行         │
│   └───┴───┴───┴───┴───┘                    │
└────────────────────────────────────────────┘
```

#### 5.1.2 图像历史状态（History State）

```javascript
{
    imageData: ImageData,           // mainCanvas 完整图像数据（含 RGBA）
    mask: Uint8ClampedArray         // 对应的选区蒙版
}
```

历史栈结构：

```
historyIndex: 3
history: [state0, state1, state2, state3, state4]
                              ↑ 当前位置

撤销 → historyIndex--  →  恢复 state2
重做 → historyIndex++  →  恢复 state4
新操作 → 截断 history[4] 之后 → 追加新 state
```

#### 5.1.3 选区操作记录（Selection Record）

```javascript
{
    mask: Uint8ClampedArray,        // 本次操作的蒙版快照
    operationType: string,          // 操作类型：'add' | 'subtract' | 'magicWand' | 'brush'
    metadata: {                     // 操作元数据
        x: number,                  // 点击坐标 X
        y: number,                  // 点击坐标 Y
        tolerance: number,          // 容差值（魔术棒）
        contiguous: boolean,        // 是否连续（魔术棒）
        size: number,               // 画笔大小
        hardness: number            // 画笔硬度
    },
    timestamp: number               // 操作时间戳
}
```

#### 5.1.4 选区变换边界（Selection Bounds）

```javascript
{
    x: number,                      // 左上角 X
    y: number,                      // 左上角 Y
    width: number,                  // 宽度
    height: number                  // 高度
}
```

### 5.2 Canvas 双缓冲架构

```
┌─────────────────────────────────────────────┐
│              canvasWrapper                   │
│  ┌─────────────────────────────────────┐    │
│  │         mainCanvas                  │    │
│  │  ┌─────────────────────────────┐    │    │
│  │  │  原始/处理后的图像数据       │    │    │
│  │  │  (RGBA 像素，含透明通道)     │    │    │
│  │  └─────────────────────────────┘    │    │
│  └─────────────────────────────────────┘    │
│  ┌─────────────────────────────────────┐    │
│  │         overlayCanvas               │    │
│  │  ┌─────────────────────────────┐    │    │
│  │  │  选区可视化（紫色半透明）    │    │    │
│  │  │  画笔绘制轨迹               │    │    │
│  │  │  形状预览                    │    │    │
│  │  │  选区变换控制框              │    │    │
│  │  │  框选矩形                    │    │    │
│  │  └─────────────────────────────┘    │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘

mainCanvas：存储实际图像数据，所有像素操作的目标
overlayCanvas：存储临时可视化信息，不参与最终导出
```

### 5.3 缩放状态模型

```javascript
{
    scale: number,          // 当前缩放比例 (0.1 ~ 10)
    offsetX: number,        // X 方向平移偏移
    offsetY: number,        // Y 方向平移偏移
    minScale: 0.1,          // 最小缩放
    maxScale: 10,           // 最大缩放
    scaleStep: 0.1          // 滚轮缩放步长
}
```

坐标转换公式：

```
Canvas坐标 = (屏幕坐标 - 容器中心 - offset) / scale + Canvas中心
屏幕坐标 = (Canvas坐标 - Canvas中心) × scale + 容器中心 + offset
```

---

## 6. 接口规范

### 6.1 ImageProcessor 公共接口

| 方法 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `loadImage(file)` | `File` | `Promise<{width, height, size, type}>` | 加载图片文件 |
| `applySmartCut(smoothness)` | `number` | `Promise<void>` | 应用智能抠图 |
| `magicWandSelect(x, y, tolerance, contiguous, addToExisting)` | `number, number, number, boolean, boolean` | `void` | 魔术棒选择 |
| `addToSelection(x, y)` | `number, number` | `void` | 添加到选区 |
| `subtractFromSelection(x, y)` | `number, number` | `void` | 从选区减去 |
| `startBrushDrawing(x, y, size, hardness, mode, scale)` | `number, number, number, number, string, number` | `void` | 开始画笔绘制 |
| `brushDraw(x, y, scale)` | `number, number, number` | `void` | 画笔绘制中 |
| `stopBrushDrawing()` | - | `void` | 停止画笔绘制 |
| `setShapeType(shapeType)` | `string` | `void` | 设置形状类型 |
| `startShapeDrawing(x, y)` | `number, number` | `void` | 开始形状绘制 |
| `updateShapeDrawing(x, y)` | `number, number` | `void` | 更新形状绘制 |
| `finishShapeDrawing()` | - | `{mask, bounds} \| null` | 完成形状绘制 |
| `clearSelection()` | - | `void` | 清除选区 |
| `invertSelection()` | - | `void` | 反选 |
| `deleteSelection()` | - | `void` | 删除选中区域 |
| `removeSmallRegions(minArea)` | `number` | `{removedRegions, removedPixels, ...}` | 全图去噪 |
| `removeSmallRegionsInArea(minArea, region)` | `number, Object` | `{removedRegions, removedPixels, ...}` | 框选区域去噪 |
| `removeSmallRegionsFromSelection(minArea)` | `number` | `{removedRegions, removedPixels, ...}` | 选区降噪 |
| `smoothEdges(strength)` | `number` | `boolean` | 边缘光滑 |
| `processShadows(options)` | `Object` | `boolean` | 阴影处理 |
| `undoLastSelection()` | - | `boolean` | 撤销最后一次选择 |
| `confirmDeleteSelection()` | - | `Promise<boolean>` | 确认删除选区 |
| `undo()` | - | `boolean` | 撤销 |
| `redo()` | - | `boolean` | 重做 |
| `canUndo()` | - | `boolean` | 是否可撤销 |
| `canRedo()` | - | `boolean` | 是否可重做 |
| `exportImage(type, quality)` | `string, number` | `string (DataURL)` | 导出图片 |
| `downloadImage(filename)` | `string` | `void` | 下载图片 |
| `reset()` | - | `void` | 重置到原始图片 |

### 6.2 SmartCutTool 接口

| 方法 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `setSmoothness(value)` | `number (0-100)` | `void` | 设置边缘平滑度 |
| `setMode(mode)` | `'auto'\|'person'\|'color'\|'edge'` | `void` | 设置抠图模式 |
| `apply()` | - | `Promise<Uint8ClampedArray>` | 执行智能抠图 |
| `loadBodyPixModel()` | - | `Promise<void>` | 加载 BodyPix 模型 |

### 6.3 MagicWandTool 接口

| 方法 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `setTolerance(value)` | `number (1-100)` | `void` | 设置容差值 |
| `setContiguous(value)` | `boolean` | `void` | 设置连续区域模式 |
| `select(x, y)` | `number, number` | `Uint8ClampedArray` | 选择相似颜色区域 |
| `addToSelection(x, y, currentMask)` | `number, number, Uint8ClampedArray` | `Uint8ClampedArray` | 添加到现有选区 |
| `subtractFromSelection(x, y, currentMask)` | `number, number, Uint8ClampedArray` | `Uint8ClampedArray` | 从现有选区减去 |

### 6.4 BrushTool 接口

| 方法 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `setSize(value)` | `number (5-100)` | `void` | 设置画笔大小 |
| `setHardness(value)` | `number (0-100)` | `void` | 设置画笔硬度 |
| `setMode(mode)` | `'add'\|'subtract'` | `void` | 设置画笔模式 |
| `startDrawing(x, y)` | `number, number` | `void` | 开始绘制 |
| `draw(x, y)` | `number, number` | `void` | 绘制 |
| `stopDrawing()` | - | `void` | 停止绘制 |
| `getBrushMask()` | - | `Uint8ClampedArray` | 获取画笔蒙版 |
| `applyToMask(targetMask, brushMask)` | `Uint8ClampedArray, Uint8ClampedArray` | `Uint8ClampedArray` | 应用画笔到目标蒙版 |
| `clear()` | - | `void` | 清除画笔临时绘制 |

### 6.5 ZoomManager 接口

| 方法 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `screenToCanvas(screenX, screenY)` | `number, number` | `{x, y}` | 屏幕坐标转 Canvas 坐标 |
| `getScale()` | - | `number` | 获取当前缩放比例 |
| `zoomIn()` | - | `void` | 放大 |
| `zoomOut()` | - | `void` | 缩小 |
| `fitToWindow()` | - | `void` | 适应窗口 |
| `resetZoom()` | - | `void` | 重置缩放 |
| `reset()` | - | `void` | 完全重置 |
| `setOnZoomChange(callback)` | `Function` | `void` | 设置缩放变化回调 |

### 6.6 SelectionHistory 接口

| 方法 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `addSelection(mask, operationType, metadata)` | `Uint8ClampedArray, string, Object` | `void` | 添加选区记录 |
| `save(mask)` | `Uint8ClampedArray` | `void` | 保存完整蒙版快照 |
| `getCurrentSelection()` | - | `Uint8ClampedArray \| null` | 获取当前选区 |
| `getAccumulatedSelection()` | - | `Uint8ClampedArray` | 获取累积选区 |
| `undoLastSelection()` | - | `Uint8ClampedArray \| null` | 撤销最后一次选择 |
| `canUndo()` | - | `boolean` | 是否可撤销 |
| `clear()` | - | `void` | 清空历史 |

---

## 7. 安全策略

### 7.1 数据安全

| 策略 | 实现方式 | 说明 |
|------|----------|------|
| **纯客户端处理** | 所有图像处理在浏览器端完成 | 图片数据不上传到任何服务器，零数据泄露风险 |
| **无网络传输** | 除加载 BodyPix 模型和 Google Fonts 外无网络请求 | 核心功能可离线使用（模型缓存后） |
| **FileReader 本地读取** | 使用 `FileReader.readAsDataURL()` | 文件仅在本地内存中处理 |
| **无持久化存储** | 不使用 localStorage / IndexedDB 存储图像 | 关闭页面即清除所有数据 |

### 7.2 输入安全

| 策略 | 实现方式 | 说明 |
|------|----------|------|
| **文件类型验证** | `file.type.startsWith('image/')` | 拒绝非图片文件 |
| **Canvas 坐标边界检查** | `canvasUtils.isInBounds()` | 防止越界访问像素数据 |
| **参数范围限制** | HTML range input 的 min/max 属性 | 防止非法参数值 |
| **右键菜单禁用** | `canvasWrapper.contextmenu → preventDefault()` | 防止意外上下文菜单干扰操作 |

### 7.3 外部依赖安全

| 依赖 | 风险等级 | 缓解措施 |
|------|----------|----------|
| TensorFlow.js + BodyPix | 中 | 从官方 CDN 加载，模型文件有完整性校验 |
| Google Fonts | 低 | 使用 `preconnect` 优化，字体文件无执行风险 |
| 无后端 API | 无 | 不存在服务端攻击面 |

### 7.4 建议增强项

1. **CSP 策略**：部署时添加 Content-Security-Policy 头，限制脚本和样式来源
2. **Subresource Integrity**：为 CDN 资源添加 SRI 哈希校验
3. **HTTPS 强制**：生产环境强制 HTTPS，防止中间人攻击
4. **CORS 配置**：如需跨域加载图片，严格配置 CORS 策略

---

## 8. 性能优化方案

### 8.1 已实施的优化

#### 8.1.1 图像处理优化

| 优化项 | 实现方式 | 效果 |
|--------|----------|------|
| **Uint8ClampedArray 蒙版** | 使用一维 TypedArray 而非二维数组 | 内存连续，CPU 缓存友好，索引计算 O(1) |
| **BFS 洪水填充** | 使用栈/队列而非递归 | 避免调用栈溢出，大图安全 |
| **visited 数组去重** | 使用 Uint8ClampedArray 标记已访问 | 避免重复处理，O(1) 查找 |
| **按需加载 AI 模型** | BodyPix 仅在人体分割模式首次使用时加载 | 减少初始加载时间约 4MB |
| **异步处理 + Loading 遮罩** | `async/await` + UI 阻塞提示 | 防止界面冻结，提供用户反馈 |

#### 8.1.2 渲染优化

| 优化项 | 实现方式 | 效果 |
|--------|----------|------|
| **双 Canvas 架构** | mainCanvas（图像）+ overlayCanvas（选区）分离 | 选区更新无需重绘图像 |
| **CSS Transform 缩放** | 使用 `transform: scale()` 而非重绘 Canvas | GPU 加速，缩放流畅 |
| **画笔模糊优化** | 使用 `ctx.filter = 'blur()'` | 利用浏览器原生模糊，避免手动卷积 |

#### 8.1.3 内存优化

| 优化项 | 实现方式 | 效果 |
|--------|----------|------|
| **历史记录上限** | `maxHistory = 50` | 限制内存占用，50 步约占用 50 × 图片大小 |
| **蒙版轻量化** | 蒙版仅存储单通道（1 byte/pixel） | 相比 RGBA 图像数据节省 75% 内存 |
| **分支截断** | 新操作时截断未来历史 | 避免无效历史占用内存 |

### 8.2 性能瓶颈分析

```
图片尺寸      智能抠图(颜色)   智能抠图(边缘)   智能抠图(人体)   全图去噪
─────────────────────────────────────────────────────────────────────
500×500       < 100ms         < 100ms         ~2s(首次加载)    < 200ms
1000×1000     ~300ms          ~400ms          ~3s(首次加载)    ~500ms
2000×2000     ~1.2s           ~1.5s           ~5s(首次加载)    ~2s
4000×4000     ~5s             ~6s             ~10s+            ~8s
```

### 8.3 建议优化方向

| 优先级 | 优化项 | 预期效果 | 实现复杂度 |
|--------|--------|----------|------------|
| 高 | Web Worker 离线计算 | 主线程不阻塞，UI 流畅 | 中 |
| 高 | 大图自动降采样 | 处理速度提升 4-16 倍 | 低 |
| 中 | OffscreenCanvas | Worker 中直接操作 Canvas | 中 |
| 中 | WebAssembly 加速 | 像素级操作提速 5-10 倍 | 高 |
| 低 | WebGL 着色器 | 并行像素处理，GPU 加速 | 高 |
| 低 | 渐进式渲染 | 大图分块处理，逐步显示 | 中 |

---

## 9. 扩展性设计

### 9.1 工具扩展机制

当前架构采用**工具注册模式**，新增工具只需：

```
1. 在 js/tools/ 下创建新工具类
2. 实现 Canvas 操作接口
3. 在 ImageProcessor 中实例化并暴露方法
4. 在 App 中添加 UI 事件绑定
5. 在 index.html 中添加工具按钮和参数面板
```

扩展点示意：

```
┌──────────────────────────────────────────────┐
│              新增工具扩展流程                   │
│                                              │
│  ┌─────────┐    ┌──────────────┐             │
│  │ 新建     │    │ ImageProcessor│             │
│  │ Tool类   │───▶│ 中注册实例    │             │
│  └─────────┘    └──────────────┘             │
│                       │                      │
│  ┌─────────┐    ┌──────────────┐             │
│  │ App中    │◀───│ 暴露公共方法  │             │
│  │ 绑定事件 │    └──────────────┘             │
│  └─────────┘                                 │
│       │                                      │
│  ┌─────────┐                                 │
│  │ HTML中   │                                 │
│  │ 添加UI   │                                 │
│  └─────────┘                                 │
└──────────────────────────────────────────────┘
```

### 9.2 算法扩展点

| 扩展方向 | 当前实现 | 扩展方式 |
|----------|----------|----------|
| 新增抠图算法 | SmartCutTool 4 种模式 | 在 `apply()` 的 switch 中新增 case |
| 新增形状类型 | ShapeCutTool 6 种形状 | 在 `drawShape()` 中新增绘制逻辑 |
| 新增后处理 | 3 种去噪 + 边缘光滑 + 阴影 | 新建工具类，在 ImageProcessor 中协调 |
| 新增 AI 模型 | BodyPix | 新增模型加载和推理逻辑 |
| 新增导出格式 | PNG | 新增格式转换逻辑 |

### 9.3 主题扩展

当前使用 CSS Variables 实现暗色主题，扩展亮色主题只需：

```css
/* 新增亮色主题变量覆盖 */
[data-theme="light"] {
    --bg-primary: #ffffff;
    --bg-secondary: #f8fafc;
    --text-primary: #1e293b;
    /* ... */
}
```

### 9.4 未来扩展建议

| 方向 | 描述 | 优先级 |
|------|------|--------|
| **批量处理** | 支持多图片队列处理 | 高 |
| **撤销/重做可视化** | 历史记录面板，可点击跳转 | 中 |
| **预设模板** | 常用抠图场景一键配置 | 中 |
| **插件系统** | 第三方工具插件注册机制 | 低 |
| **协作功能** | WebSocket 实时协作编辑 | 低 |
| **视频抠图** | 逐帧处理 + 时间线编辑 | 低 |

---

## 10. 部署架构

### 10.1 当前部署方式

本项目为纯静态前端应用，部署仅需一个静态文件服务器：

```
┌─────────────────────────────────────────────┐
│              静态文件服务器                    │
│            (Nginx / Caddy / GitHub Pages)    │
│                                             │
│  /index.html          → 入口页面             │
│  /css/style.css       → 样式文件             │
│  /js/main.js          → 应用逻辑 (ES Module) │
│  /js/imageProcessor.js → 图像处理核心         │
│  /js/tools/*.js       → 工具模块             │
│  /js/utils/*.js       → 工具函数             │
│  /docs/*              → 文档资源             │
└─────────────────────────────────────────────┘
         │
         │  HTTPS
         ▼
┌─────────────────────┐
│    用户浏览器         │
│  ┌───────────────┐  │
│  │  应用运行时    │  │
│  │  Canvas API   │  │
│  │  TensorFlow.js│  │
│  └───────────────┘  │
└─────────────────────┘
```

### 10.2 本地开发部署

```bash
# 方式一：Python 内置服务器
python -m http.server 18080

# 方式二：Node.js http-server
npx http-server -p 18080 --cors

# 方式三：VS Code Live Server 插件
# 右键 index.html → Open with Live Server
```

> **注意**：由于使用 ES Modules，必须通过 HTTP 服务器访问，不能直接用 `file://` 协议打开。

### 10.3 生产部署建议

#### 10.3.1 静态托管方案

| 方案 | 适用场景 | 成本 |
|------|----------|------|
| GitHub Pages | 开源项目、个人项目 | 免费 |
| Vercel / Netlify | 团队项目、CI/CD | 免费额度 |
| Cloudflare Pages | 全球加速需求 | 免费额度 |
| OSS + CDN | 企业级、高流量 | 按量付费 |

#### 10.3.2 Nginx 配置参考

```nginx
server {
    listen 80;
    server_name example.com;
    root /var/www/pictureProcess;
    index index.html;

    # ES Modules 需要正确的 MIME 类型
    types {
        application/javascript js mjs;
        text/html html;
        text/css css;
        image/png png;
    }

    # 缓存策略
    location ~* \.(js|css|png|jpg|woff2)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # HTML 不缓存（确保更新）
    location ~* \.html$ {
        add_header Cache-Control "no-cache";
    }

    # SPA 路由回退
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 安全头
    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:";
}
```

### 10.4 CDN 外部依赖

| 资源 | CDN 地址 | 用途 |
|------|----------|------|
| TensorFlow.js | `https://cdn.jsdelivr.net/npm/@tensorflow/tfjs` | AI 推理运行时 |
| BodyPix | `https://cdn.jsdelivr.net/npm/@tensorflow-models/body-pix` | 人体分割模型 |
| Google Fonts | `https://fonts.googleapis.com/css2?...` | Noto Sans SC + Space Grotesk |

### 10.5 部署检查清单

- [ ] 配置 HTTPS 证书
- [ ] 设置正确的 MIME 类型（`.js` → `application/javascript`）
- [ ] 配置 CSP 安全头
- [ ] 启用 Gzip/Brotli 压缩
- [ ] 配置静态资源缓存策略
- [ ] 验证 ES Modules 跨域加载正常
- [ ] 测试 BodyPix 模型 CDN 可达性
- [ ] 验证 Google Fonts 加载正常

---

## 附录 A：快捷键映射表

| 快捷键 | 功能 | 处理模块 |
|--------|------|----------|
| `Ctrl + Z` | 撤销 | App → ImageProcessor.undo() |
| `Ctrl + Y` | 重做 | App → ImageProcessor.redo() |
| `Ctrl + S` | 下载图片 | App → ImageProcessor.downloadImage() |
| `Delete` | 删除选区 | App → ImageProcessor.deleteSelection() |
| `Ctrl + +` | 放大画布 | App → ZoomManager.zoomIn() |
| `Ctrl + -` | 缩小画布 | App → ZoomManager.zoomOut() |
| `Ctrl + 0` | 重置缩放 | App → ZoomManager.resetZoom() |
| `Shift + 点击` | 添加到选区（魔术棒） | App → ImageProcessor.addToSelection() |
| `Alt + 点击` | 从选区减去（魔术棒） | App → ImageProcessor.subtractFromSelection() |
| `Alt + 拖动` | 临时切换画笔模式 | App → BrushTool.setMode() |
| 右键点击 | 撤销最后一次选择 | App → ImageProcessor.undoLastSelection() |
| 中键点击 | 确认删除当前选区 | App → ImageProcessor.confirmDeleteSelection() |

## 附录 B：CSS 变量体系

```css
/* 主题色 */
--primary-color: #6366f1;       /* 主色调（靛蓝） */
--primary-hover: #4f46e5;
--primary-light: #818cf8;

/* 功能色 */
--success-color: #10b981;       /* 成功（绿） */
--warning-color: #f59e0b;       /* 警告（黄） */
--danger-color: #ef4444;        /* 危险（红） */

/* 背景色（暗色主题） */
--bg-primary: #0f172a;          /* 最深背景 */
--bg-secondary: #1e293b;        /* 次级背景 */
--bg-tertiary: #334155;         /* 三级背景 */

/* 文字色 */
--text-primary: #f1f5f9;        /* 主文字 */
--text-secondary: #94a3b8;      /* 次文字 */
--text-muted: #64748b;          /* 弱化文字 */

/* 圆角 */
--radius-sm: 6px;
--radius-md: 8px;
--radius-lg: 12px;

/* 过渡 */
--transition-fast: 150ms ease;
--transition-normal: 250ms ease;
```

## 附录 C：浏览器兼容性

| 浏览器 | 最低版本 | 限制说明 |
|--------|----------|----------|
| Chrome | 80+ | 完整支持 |
| Firefox | 75+ | 完整支持 |
| Safari | 13.1+ | Canvas filter 可能有限制 |
| Edge | 80+ | 完整支持（Chromium 内核） |
| IE | 不支持 | 不支持 ES Modules 和 Canvas API |
