# AI图像修复（抹除水印/杂物/污渍）功能方案

## 一、需求分析

用户希望新增一个AI图像修复功能，可以：
- 抹除图片上的水印、杂物、污渍等不需要的元素
- 修复后背景保持完整，不受到伤害
- 与现有工具集融合

## 二、技术方案对比

### 方案1：基于 LaMa 模型的浏览器端推理（推荐）

**原理**：LaMa（Large Mask Inpainting）是一种基于傅里叶卷积的图像修复模型，在处理大掩码时表现出色。

**优点**：
- 修复质量高，能处理各种复杂场景
- 支持大尺寸掩码（适合大面积水印）
- 已有ONNX转换方案

**缺点**：
- 模型较大（约300MB+），加载时间长
- 浏览器端推理速度较慢（尤其是无WebGPU设备）

**技术可行性**：
- 可通过 PyTorch → ONNX → Transformers.js 流程在浏览器运行
- 需要修改 `modelManager.js` 添加新模型支持

### 方案2：基于 Moebius 轻量级模型

**原理**：Moebius 是一个0.2B参数的轻量级图像修复模型。

**优点**：
- 模型小，加载快（约50-100MB）
- 已有成功在浏览器运行的案例（simonw.github.io/moebius-web/）

**缺点**：
- 修复质量略低于LaMa
- 社区支持相对较少

### 方案3：基于 OpenCV.js 的传统修复算法（基础方案）

**原理**：OpenCV提供了 `inpaint` 函数，使用Telea或Navier-Stokes算法进行图像修复。

**优点**：
- 无需额外模型下载（OpenCV.js已在项目中）
- 响应速度快，实时处理
- 实现简单，风险低

**缺点**：
- 修复质量有限，复杂场景效果差
- 无法处理大面积或复杂纹理区域

### 方案4：混合方案（推荐实现）

**策略**：
1. **默认方案**：使用OpenCV.js的 `inpaint` 作为基础修复方案，无需模型下载
2. **增强方案**：提供AI模型加载选项，加载后使用LaMa/Moebius进行高质量修复
3. **用户选择**：让用户决定使用哪种方案

**优点**：
- 保证基础功能可用，无需等待模型下载
- 提供高质量选项，满足专业需求
- 渐进式增强，用户体验好

## 三、推荐方案：方案4（混合方案）

### 3.1 功能设计

**工具入口**：
- 在左侧工具栏添加新工具"AI修复"或"污点修复"
- 图标建议：橡皮擦+魔法效果

**操作流程**：
1. 用户选择"AI修复"工具
2. 使用画笔涂抹需要修复的区域（类似现有画笔工具）
3. 点击"应用修复"按钮
4. 系统根据配置使用基础或AI方案进行修复

**参数配置**：
- 画笔大小/硬度（复用现有画笔参数）
- 修复算法选择（基础/AI）
- AI模型选择（如果已加载）

### 3.2 技术架构

**新增文件**：
1. `src/js/tools/inpaintingTool.js` - 修复工具类
2. 修改 `src/js/imageProcessor.js` - 添加修复方法
3. 修改 `src/js/main.js` - 添加工具入口和事件处理
4. 修改 `index.html` - 添加工具按钮和参数面板
5. 修改 `src/js/i18n/locales/zh-CN.js` 和 `en-US.js` - 添加国际化文本

**核心流程**：
```
用户涂抹区域 → 生成修复蒙版 → 选择修复算法 → 执行修复 → 更新画布
```

### 3.3 实现步骤

#### 阶段1：基础修复功能（OpenCV.js）

**文件修改**：

1. **新增 `src/js/tools/inpaintingTool.js`**：
   - 继承现有画笔工具逻辑
   - 使用 OpenCV.js 的 `cv.inpaint()` 实现基础修复
   - 支持 Telea 和 Navier-Stokes 两种算法

2. **修改 `src/js/imageProcessor.js`**：
   - 添加 `startInpaintingBrush()` 方法
   - 添加 `inpaintBrushDraw()` 方法
   - 添加 `stopInpaintingBrush()` 方法
   - 添加 `applyInpainting()` 核心修复方法

3. **修改 `src/js/main.js`**：
   - 添加工具按钮事件监听
   - 添加参数面板切换逻辑
   - 添加修复应用按钮事件

4. **修改 `index.html`**：
   - 在工具栏添加"AI修复"按钮
   - 添加修复参数面板（算法选择、画笔设置）

5. **修改国际化文件**：
   - 添加工具名称、描述、参数等文本

#### 阶段2：AI修复增强（可选）

**文件修改**：

1. **修改 `src/js/utils/modelManager.js`**：
   - 添加 LaMa 或 Moebius 模型配置
   - 添加模型加载和推理方法

2. **修改 `src/js/tools/inpaintingTool.js`**：
   - 添加 AI 模型推理方法
   - 实现 Canvas → Tensor → 推理 → Canvas 的流程

3. **修改 `index.html`**：
   - 添加 AI 模型状态指示器
   - 添加模型加载按钮

### 3.4 关键技术实现

**OpenCV.js修复调用示例**：
```javascript
// 基础修复实现
applyBasicInpainting(mask) {
    const src = cv.imread(this.mainCanvas);
    const maskMat = cv.matFromArray(height, width, cv.CV_8UC1, mask);
    
    const dst = new cv.Mat();
    // 使用 Telea 算法（快速）或 Navier-Stokes 算法（质量更好）
    cv.inpaint(src, maskMat, dst, 3, cv.INPAINT_TELEA);
    
    cv.imshow(this.mainCanvas, dst);
    
    src.delete();
    maskMat.delete();
    dst.delete();
}
```

**AI模型修复调用示例**（基于Transformers.js）：
```javascript
// AI修复实现（LaMa/Moebius）
async applyAIInpainting(mask) {
    const { model, processor } = this.modelManager.getModelAndProcessor();
    if (!model || !processor) {
        throw new Error('AI模型未加载');
    }
    
    // 将Canvas转换为RawImage
    const img = RawImage.fromCanvas(this.mainCanvas);
    
    // 预处理：将mask转换为模型输入格式
    const inputs = await processor(img, mask);
    
    // 推理
    const output = await model(inputs);
    
    // 将输出转换回Canvas
    const resultImage = RawImage.fromTensor(output.image);
    const ctx = this.mainCanvas.getContext('2d');
    ctx.drawImage(resultImage.toCanvas(), 0, 0);
}
```

### 3.5 风险与注意事项

**性能风险**：
- AI模型推理时间可能较长（5-30秒），需要显示加载提示
- 大尺寸图像可能导致内存不足，需要限制图像尺寸

**兼容性风险**：
- OpenCV.js 在某些浏览器上可能有兼容性问题
- WebGPU 并非所有浏览器都支持，需要 WASM 回退方案

**模型管理**：
- 修复模型与背景移除模型需要独立管理
- 需要提供模型下载进度和取消功能

## 四、实施计划

### 第一阶段：基础修复功能（1-2天）
- 创建 `inpaintingTool.js`
- 修改 `imageProcessor.js` 添加修复方法
- 修改 `main.js` 添加工具入口
- 修改 `index.html` 添加UI元素
- 添加国际化文本

### 第二阶段：AI模型集成（3-5天）
- 准备 LaMa/Moebius ONNX 模型文件
- 修改 `modelManager.js` 添加新模型支持
- 修改 `inpaintingTool.js` 添加AI推理逻辑
- 添加模型状态管理UI

### 第三阶段：测试与优化（1-2天）
- 测试各种修复场景（水印、杂物、污渍）
- 优化修复效果和性能
- 添加撤销/重做支持
- 完善用户体验

## 五、预期效果

**基础方案（OpenCV.js）**：
- 简单水印和小面积污渍：良好
- 复杂纹理区域：一般
- 大面积修复：较差

**AI方案（LaMa）**：
- 简单水印和小面积污渍：优秀
- 复杂纹理区域：良好
- 大面积修复：优秀

## 六、参考资源

1. OpenCV inpaint 文档：https://docs.opencv.org/4.x/df/d3d/tutorial_py_inpainting.html
2. LaMa 项目：https://github.com/advimman/lama
3. Moebius 项目：https://github.com/hustvl/Moebius
4. Transformers.js 文档：https://huggingface.co/docs/transformers.js
