/**
 * 智能抠图工具模块
 * 基于 @huggingface/transformers (Transformers.js) 实现深度学习背景移除
 * 使用 RMBG-1.4 模型作为默认 AI 抠图方案，支持 WebGPU 加速的 MODNet 模型
 * 保留传统算法（颜色聚类、边缘检测、人体分割）作为回退方案
 * 参考 bg-remove (https://github.com/addyosmani/bg-remove) 的实现方案
 */

import * as canvasUtils from '../utils/canvasUtils.js';
import { ModelManager } from '../utils/modelManager.js';
import { RawImage } from '@huggingface/transformers';

/**
 * 智能抠图类
 * 集成 Transformers.js AI 模型与传统抠图算法
 */
export class SmartCutTool {
    /**
     * 构造函数
     * @param {HTMLCanvasElement} mainCanvas - 主Canvas
     * @param {HTMLCanvasElement} overlayCanvas - 覆盖层Canvas
     */
    constructor(mainCanvas, overlayCanvas) {
        this.mainCanvas = mainCanvas;
        this.overlayCanvas = overlayCanvas;
        this.bodyPixModel = null;
        this.isBodyPixLoaded = false;

        /** 模型管理器实例 */
        this.modelManager = new ModelManager();

        /** AI 模型是否可用 */
        this.isAIModelAvailable = false;

        /** 当前使用的 AI 模型 ID */
        this.currentAIModel = ModelManager.getDefaultModel();
    }

    /**
     * 初始化 AI 模型（延迟加载，不阻塞应用启动）
     * @param {Function} onProgress - 进度回调函数
     * @param {Function} onStateChange - 状态变更回调函数
     * @returns {Promise<boolean>} 是否初始化成功
     */
    async initAIModel(onProgress, onStateChange) {
        // 绑定回调
        if (onProgress) {
            this.modelManager.onProgress = onProgress;
        }
        if (onStateChange) {
            this.modelManager.onStateChange = onStateChange;
        }

        try {
            const success = await this.modelManager.loadModel(ModelManager.getDefaultModel());
            if (success) {
                this.isAIModelAvailable = true;
                this.currentAIModel = ModelManager.getDefaultModel();
            }
            return success;
        } catch (error) {
            console.warn('AI 模型初始化失败，将使用传统算法作为回退:', error);
            this.isAIModelAvailable = false;
            return false;
        }
    }

    /**
     * 切换 AI 模型
     * @param {string} modelKey - 目标模型键，格式为 "模型ID:精度"
     * @returns {Promise<boolean>} 是否切换成功
     */
    async switchAIModel(modelKey) {
        // 记录切换前的状态，用于失败时回退
        const previousModelKey = this.currentAIModel;
        
        try {
            const success = await this.modelManager.loadModel(modelKey);
            if (success) {
                this.isAIModelAvailable = true;
                this.currentAIModel = modelKey;
                console.log(`[SmartCutTool] 模型切换成功: ${modelKey}`);
            }
            return success;
        } catch (error) {
            console.error(`切换 AI 模型 ${modelKey} 失败:`, error);
            
            // 检查模型管理器当前状态
            const isLoaded = this.modelManager.isModelLoaded();
            this.isAIModelAvailable = isLoaded;
            
            if (isLoaded) {
                // 如果回退逻辑成功加载了默认模型，同步更新当前模型记录
                this.currentAIModel = this.modelManager.getCurrentModelKey();
            } else {
                // 彻底失败，重置状态
                this.currentAIModel = null;
            }
            
            return false;
        }
    }

    /**
     * 获取当前 AI 模型 ID
     * @returns {string|null} 当前模型 ID
     */
    getCurrentAIModel() {
        return this.currentAIModel;
    }

    /**
     * 获取当前 AI 模型精度类型
     * @returns {string|null} 当前精度类型
     */
    getCurrentAIDtype() {
        return this.modelManager.getCurrentDtype();
    }

    /**
     * 检查 AI 模型是否已加载
     * @returns {boolean} 是否已加载
     */
    isAIModelReady() {
        return this.isAIModelAvailable && this.modelManager.isModelLoaded();
    }

    /**
     * 取消模型加载
     */
    cancelModelLoading() {
        this.modelManager.cancelLoading();
    }

    /**
     * 加载BodyPix模型（用于人体抠图，传统回退方案）
     * 按需动态导入 @tensorflow/tfjs 和 @tensorflow-models/body-pix
     * 避免在应用启动时预加载庞大的 TensorFlow.js 框架
     * @returns {Promise<void>}
     */
    async loadBodyPixModel() {
        if (this.isBodyPixLoaded) return;

        try {
            // 动态导入 TensorFlow.js 和 BodyPix，仅在需要时加载
            const tf = await import('@tensorflow/tfjs');
            const bodyPix = await import('@tensorflow-models/body-pix');

            this.bodyPixModel = await bodyPix.load({
                architecture: 'MobileNetV1',
                outputStride: 16,
                multiplier: 0.75,
                quantBytes: 2
            });
            this.isBodyPixLoaded = true;
            console.log('BodyPix模型加载成功');
        } catch (error) {
            console.error('BodyPix模型加载失败:', error);
            throw error;
        }
    }

    /**
     * 执行智能抠图
     * 直接使用 AI 模型抠图，失败时回退到传统算法
     * @returns {Promise<Uint8ClampedArray>} 选区蒙版（255=背景/要抠除，0=前景/要保留）
     */
    async apply() {
        // 优先使用 AI 模型
        if (this.isAIModelReady()) {
            try {
                return await this.applyAIRemoveBg();
            } catch (error) {
                console.warn('AI 模型抠图失败，回退到传统算法:', error);
            }
        }
        
        // 回退到传统算法
        return await this.applyAutoSegmentation();
    }

    /**
     * 使用 Transformers.js AI 模型移除背景
     * 基于 RMBG-1.4 / MODNet 模型，使用 AutoModel + AutoProcessor 进行推理
     * 流程：Canvas → RawImage → Processor 预处理 → Model 推理 → 蒙版提取
     * 
     * **Mask 逻辑说明**：
     * - AI 模型输出：alpha > 128 表示前景（要保留），alpha <= 128 表示背景（要抠除）
     * - 返回的 mask：255 表示背景（要抠除的区域），0 表示前景（要保留的区域）
     * - 这符合行业通用标准：mask 标记的是需要抠除的区域
     * 
     * @returns {Promise<Uint8ClampedArray>} 选区蒙版（255=背景/要抠除，0=前景/要保留）
     */
    async applyAIRemoveBg() {
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        let pixel_values = null;
        let outputTensor = null;

        try {
            const { model, processor } = this.modelManager.getModelAndProcessor();
            if (!model || !processor) {
                throw new Error('AI 模型未加载');
            }

            // 将 Canvas 转换为 Blob URL，再用 RawImage 加载
            const blob = await new Promise((resolve) => {
                this.mainCanvas.toBlob(resolve, 'image/png');
            });
            const imageUrl = URL.createObjectURL(blob);

            // 使用 RawImage 从 URL 加载图像
            const img = await RawImage.fromURL(imageUrl);
            URL.revokeObjectURL(imageUrl);

            // 预处理图像：获取像素值张量
            const processorResult = await processor(img);
            pixel_values = processorResult.pixel_values;

            // 动态获取模型期望的输入名：
            //   - U-2-Net（config.json 里有 input_name 字段）→ "input.1"
            //   - RMBG / ISNet / MODNet → "input"（Transformers.js 默认）
            //   - 兜底：使用 ONNX Session 报告的首个输入名
            const inputName =
                model.config?.input_name ||
                model.session?.inputNames?.[0] ||
                'input';
            const modelResult = await model({ [inputName]: pixel_values });

            // 动态获取模型输出张量：
            //   - U-2-Net：raw ONNX 模型返回 { "1959": Tensor, "1960": Tensor, ... }，
            //              主输出由 model.config.output_composite 指定（"1959"）
            //   - RMBG / ISNet / MODNet：自定义模型类把主输出封装到 .output
            //   - 兜底：result 里第一个是 Tensor 的字段
            const outputComposite = model.config?.output_composite;
            outputTensor =
                modelResult.output ||
                (outputComposite && modelResult[outputComposite]) ||
                Object.values(modelResult).find((v) => v && typeof v.mul === 'function');
            if (!outputTensor) {
                throw new Error(`无法解析模型输出，可用键: ${Object.keys(modelResult).join(', ')}`);
            }
            console.log(`[smartCut] 模型输出 shape:`, outputTensor.dims || outputTensor.shape);

            // 将输出张量缩放至 0-255 并调整回原始尺寸
            const maskData = (
                await RawImage.fromTensor(outputTensor[0].mul(255).to('uint8')).resize(
                    img.width,
                    img.height,
                )
            ).data;

            // 创建蒙版数组
            const mask = new Uint8ClampedArray(width * height);

            // 将蒙版数据映射到原始画布尺寸
            // **关键逻辑**：反转 mask，让 mask 标记背景（要抠除的区域）
            const scaleX = img.width / width;
            const scaleY = img.height / height;

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const srcX = Math.floor(x * scaleX);
                    const srcY = Math.floor(y * scaleY);
                    const srcIdx = srcY * img.width + srcX;
                    const alpha = maskData[srcIdx];
                    // alpha > 128 表示前景（要保留），mask 设为 0
                    // alpha <= 128 表示背景（要抠除），mask 设为 255
                    mask[y * width + x] = alpha > 128 ? 0 : 255;
                }
            }

            return mask;
        } catch (error) {
            console.error('AI 模型抠图失败，回退到传统算法:', error);
            this.isAIModelAvailable = false;
            // 回退到自动模式
            return await this.applyAutoSegmentation();
        } finally {
            // 显式释放张量内存，防止 WebGL / WASM 内存泄漏
            if (pixel_values && typeof pixel_values.dispose === 'function') {
                try { pixel_values.dispose(); } catch (e) { /* ignore */ }
            }
            if (outputTensor && typeof outputTensor.dispose === 'function') {
                try { outputTensor.dispose(); } catch (e) { /* ignore */ }
            }
        }
    }

    /**
     * 自动选择最佳抠图方法
     * 优先使用 AI 模型，失败时回退到传统算法
     * @returns {Promise<Uint8ClampedArray>} 选区蒙版
     */
    async applyAutoSegmentation() {
        // 优先尝试 AI 模型
        if (this.isAIModelReady()) {
            try {
                console.log('使用 AI 模型抠图');
                return await this.applyAIRemoveBg();
            } catch (error) {
                console.warn('AI 模型抠图失败，回退到传统算法:', error);
            }
        }

        // 回退到传统算法
        const imageData = canvasUtils.getImageData(this.mainCanvas);
        
        const colorMask = this.applyColorBasedSegmentation();
        const colorScore = this.evaluateMask(colorMask);
        
        const edgeMask = this.applyEdgeBasedSegmentation();
        const edgeScore = this.evaluateMask(edgeMask);
        
        if (colorScore > edgeScore && colorScore > 0.3) {
            console.log('使用颜色聚类抠图');
            return colorMask;
        } else if (edgeScore > 0.3) {
            console.log('使用边缘检测抠图');
            return edgeMask;
        }
        
        try {
            console.log('尝试人体分割');
            return await this.applyPersonSegmentation();
        } catch (error) {
            console.log('人体分割不可用，使用颜色聚类');
        }
        
        return colorMask;
    }

    /**
     * 人体分割抠图
     * 
     * **Mask 逻辑说明**：
     * - BodyPix 输出：segmentation.data[i] === 1 表示人体（前景）
     * - 返回的 mask：255 表示背景（要抠除的区域），0 表示前景（要保留的区域）
     * 
     * @returns {Promise<Uint8ClampedArray>} 选区蒙版（255=背景/要抠除，0=前景/要保留）
     */
    async applyPersonSegmentation() {
        if (!this.isBodyPixLoaded) {
            await this.loadBodyPixModel();
        }

        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;

        const segmentation = await this.bodyPixModel.segmentPerson(this.mainCanvas, {
            flipHorizontal: false,
            internalResolution: 'medium',
            segmentationThreshold: 0.7
        });

        const mask = new Uint8ClampedArray(width * height);
        
        // **关键逻辑**：反转 mask，让 mask 标记背景（要抠除的区域）
        for (let i = 0; i < segmentation.data.length; i++) {
            // segmentation.data[i] === 1 表示人体（前景），mask 设为 0（不抠除）
            // segmentation.data[i] === 0 表示背景，mask 设为 255（要抠除）
            mask[i] = segmentation.data[i] === 1 ? 0 : 255;
        }

        return mask;
    }

    /**
     * 基于颜色聚类的抠图
     * 
     * **Mask 逻辑说明**：
     * - 返回的 mask：255 表示背景（要抠除的区域），0 表示前景（要保留的区域）
     * 
     * @returns {Uint8ClampedArray} 选区蒙版（255=背景/要抠除，0=前景/要保留）
     */
    applyColorBasedSegmentation() {
        const imageData = canvasUtils.getImageData(this.mainCanvas);
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        
        const bgColor = this.detectBackgroundColor(imageData);
        const fgColor = this.detectForegroundColor(imageData, bgColor);
        
        const tolerance = this.calculateOptimalTolerance(imageData, bgColor, fgColor);
        
        const mask = new Uint8ClampedArray(width * height);
        
        // **关键逻辑**：反转 mask，让 mask 标记背景（要抠除的区域）
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const pixelColor = canvasUtils.getPixelColor(imageData, x, y);
                const bgDistance = canvasUtils.colorDistance(pixelColor, bgColor);
                const fgDistance = canvasUtils.colorDistance(pixelColor, fgColor);
                
                // fgDistance < bgDistance 表示前景（要保留），mask 设为 0
                // bgDistance <= fgDistance 表示背景（要抠除），mask 设为 255
                if (fgDistance < bgDistance) {
                    mask[y * width + x] = 0;  // 前景，不抠除
                } else {
                    const ratio = bgDistance / (bgDistance + fgDistance);
                    mask[y * width + x] = ratio > 0.6 ? 0 : 255;  // 背景概率高则抠除
                }
            }
        }
        
        this.removeSmallRegions(mask, width, height, 100);
        
        return mask;
    }

    /**
     * 基于边缘检测的抠图
     * 
     * **Mask 逻辑说明**：
     * - 返回的 mask：255 表示背景（要抠除的区域），0 表示前景（要保留的区域）
     * 
     * @returns {Uint8ClampedArray} 选区蒙版（255=背景/要抠除，0=前景/要保留）
     */
    applyEdgeBasedSegmentation() {
        const imageData = canvasUtils.getImageData(this.mainCanvas);
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        
        const edges = this.detectEdges(imageData);
        
        // floodFillFromCenter 返回的是前景区域（255=前景）
        const foregroundMask = this.floodFillFromCenter(edges, width, height);
        
        // **关键逻辑**：反转 mask，让 mask 标记背景（要抠除的区域）
        const mask = new Uint8ClampedArray(width * height);
        for (let i = 0; i < foregroundMask.length; i++) {
            mask[i] = foregroundMask[i] > 0 ? 0 : 255;  // 前景设为0，背景设为255
        }
        
        this.removeSmallRegions(mask, width, height, 100);
        
        return mask;
    }

    /**
     * 检测背景颜色
     * @param {ImageData} imageData - 图像数据
     * @returns {Object} 背景颜色
     */
    detectBackgroundColor(imageData) {
        const width = imageData.width;
        const height = imageData.height;
        const colors = [];
        
        const sampleSize = Math.min(50, Math.floor(width / 4), Math.floor(height / 4));
        
        for (let i = 0; i < sampleSize; i++) {
            colors.push(canvasUtils.getPixelColor(imageData, i, 0));
            colors.push(canvasUtils.getPixelColor(imageData, width - 1 - i, 0));
            colors.push(canvasUtils.getPixelColor(imageData, 0, i));
            colors.push(canvasUtils.getPixelColor(imageData, 0, height - 1 - i));
        }
        
        const avgColor = { r: 0, g: 0, b: 0 };
        colors.forEach(color => {
            avgColor.r += color.r;
            avgColor.g += color.g;
            avgColor.b += color.b;
        });
        
        avgColor.r = Math.floor(avgColor.r / colors.length);
        avgColor.g = Math.floor(avgColor.g / colors.length);
        avgColor.b = Math.floor(avgColor.b / colors.length);
        
        return avgColor;
    }

    /**
     * 检测前景颜色
     * @param {ImageData} imageData - 图像数据
     * @param {Object} bgColor - 背景颜色
     * @returns {Object} 前景颜色
     */
    detectForegroundColor(imageData, bgColor) {
        const width = imageData.width;
        const height = imageData.height;
        
        const centerX = Math.floor(width / 2);
        const centerY = Math.floor(height / 2);
        
        const samplePoints = [
            { x: centerX, y: centerY },
            { x: centerX - 50, y: centerY - 50 },
            { x: centerX + 50, y: centerY - 50 },
            { x: centerX - 50, y: centerY + 50 },
            { x: centerX + 50, y: centerY + 50 }
        ];
        
        const colors = [];
        samplePoints.forEach(point => {
            if (point.x >= 0 && point.x < width && point.y >= 0 && point.y < height) {
                const color = canvasUtils.getPixelColor(imageData, point.x, point.y);
                const distance = canvasUtils.colorDistance(color, bgColor);
                if (distance > 30) {
                    colors.push(color);
                }
            }
        });
        
        if (colors.length === 0) {
            return { r: 128, g: 128, b: 128 };
        }
        
        const avgColor = { r: 0, g: 0, b: 0 };
        colors.forEach(color => {
            avgColor.r += color.r;
            avgColor.g += color.g;
            avgColor.b += color.b;
        });
        
        avgColor.r = Math.floor(avgColor.r / colors.length);
        avgColor.g = Math.floor(avgColor.g / colors.length);
        avgColor.b = Math.floor(avgColor.b / colors.length);
        
        return avgColor;
    }

    /**
     * 计算最优容差值
     * @param {ImageData} imageData - 图像数据
     * @param {Object} bgColor - 背景颜色
     * @param {Object} fgColor - 前景颜色
     * @returns {number} 容差值
     */
    calculateOptimalTolerance(imageData, bgColor, fgColor) {
        const distance = canvasUtils.colorDistance(bgColor, fgColor);
        return Math.max(30, Math.min(100, distance * 0.4));
    }

    /**
     * 检测边缘
     * @param {ImageData} imageData - 图像数据
     * @returns {Uint8ClampedArray} 边缘图
     */
    detectEdges(imageData) {
        const width = imageData.width;
        const height = imageData.height;
        const edges = new Uint8ClampedArray(width * height);
        
        const sobelX = [
            [-1, 0, 1],
            [-2, 0, 2],
            [-1, 0, 1]
        ];
        
        const sobelY = [
            [-1, -2, -1],
            [0, 0, 0],
            [1, 2, 1]
        ];
        
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                let gx = 0;
                let gy = 0;
                
                for (let j = -1; j <= 1; j++) {
                    for (let i = -1; i <= 1; i++) {
                        const idx = ((y + j) * width + (x + i)) * 4;
                        const gray = (imageData.data[idx] + imageData.data[idx + 1] + imageData.data[idx + 2]) / 3;
                        
                        gx += gray * sobelX[j + 1][i + 1];
                        gy += gray * sobelY[j + 1][i + 1];
                    }
                }
                
                const magnitude = Math.sqrt(gx * gx + gy * gy);
                edges[y * width + x] = magnitude > 50 ? 1 : 0;
            }
        }
        
        return edges;
    }

    /**
     * 从中心开始洪水填充
     * @param {Uint8ClampedArray} edges - 边缘图
     * @param {number} width - 宽度
     * @param {number} height - 高度
     * @returns {Uint8ClampedArray} 填充蒙版
     */
    floodFillFromCenter(edges, width, height) {
        const mask = new Uint8ClampedArray(width * height);
        const visited = new Uint8ClampedArray(width * height);
        
        const centerX = Math.floor(width / 2);
        const centerY = Math.floor(height / 2);
        
        const stack = [[centerX, centerY]];
        
        while (stack.length > 0) {
            const [x, y] = stack.pop();
            
            if (x < 0 || x >= width || y < 0 || y >= height) continue;
            
            const idx = y * width + x;
            if (visited[idx] || edges[idx]) continue;
            
            visited[idx] = 1;
            mask[idx] = 255;
            
            stack.push([x + 1, y]);
            stack.push([x - 1, y]);
            stack.push([x, y + 1]);
            stack.push([x, y - 1]);
        }
        
        return mask;
    }

    /**
     * 评估蒙版质量
     * @param {Uint8ClampedArray} mask - 蒙版
     * @returns {number} 质量分数 (0-1)
     */
    evaluateMask(mask) {
        let foregroundCount = 0;
        const total = mask.length;
        
        for (let i = 0; i < mask.length; i++) {
            if (mask[i] > 0) foregroundCount++;
        }
        
        const ratio = foregroundCount / total;
        
        if (ratio < 0.1 || ratio > 0.9) return 0;
        
        return 1 - Math.abs(ratio - 0.5) * 2;
    }

    /**
     * 移除小区域
     * @param {Uint8ClampedArray} mask - 蒙版
     * @param {number} width - 宽度
     * @param {number} height - 高度
     * @param {number} minSize - 最小区域大小
     */
    removeSmallRegions(mask, width, height, minSize) {
        const visited = new Uint8ClampedArray(width * height);
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (visited[idx] || mask[idx] === 0) continue;
                
                const region = [];
                const stack = [[x, y]];
                
                while (stack.length > 0) {
                    const [cx, cy] = stack.pop();
                    const cidx = cy * width + cx;
                    
                    if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;
                    if (visited[cidx] || mask[cidx] === 0) continue;
                    
                    visited[cidx] = 1;
                    region.push(cidx);
                    
                    stack.push([cx + 1, cy]);
                    stack.push([cx - 1, cy]);
                    stack.push([cx, cy + 1]);
                    stack.push([cx, cy - 1]);
                }
                
                if (region.length < minSize) {
                    region.forEach(i => mask[i] = 0);
                }
            }
        }
    }
}
