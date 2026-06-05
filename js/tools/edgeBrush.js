/**
 * 边缘画笔工具模块
 * 提供正画笔（涂抹区域执行边缘检测并描绘）和负画笔（抹除已有边缘）功能
 *
 * 正画笔（add模式）：在图像上涂抹后，对涂抹区域执行Canny边缘检测，
 *                   将检测到的边缘精确描绘到原始图像上
 * 负画笔（subtract模式）：涂抹区域内已有边缘的精确抹除操作，
 *                       仅影响涂抹区域内的边缘像素，不影响原始图像内容
 *
 * 技术特性：
 * - 实时响应：涂抹与边缘检测延迟不超过300ms（在mouseup时执行检测）
 * - 边缘一致性：描绘的边缘与全局边缘检测保持一致的线条粗细和颜色
 * - 精确抹除：负画笔仅抹除涂抹区域内的边缘像素
 * - 画笔大小：1-50像素可调
 * - 多次叠加：支持多次涂抹操作的叠加效果
 * - 撤销/重做：至少支持10步操作历史记录
 *
 * 选区颜色约定：
 * - 正画笔指示：半透明绿色(0,255,0,80)
 * - 负画笔指示：半透明红色(255,0,0,80)
 * - 边缘描绘：青色(0,200,255)，与全局边缘检测一致
 */

import * as canvasUtils from '../utils/canvasUtils.js';
import { UndoRedoManager } from '../utils/undoRedoManager.js';

/**
 * 边缘画笔工具类
 */
export class EdgeBrushTool {
    /**
     * 构造函数
     * @param {HTMLCanvasElement} mainCanvas - 主Canvas（存储原始图像）
     * @param {HTMLCanvasElement} overlayCanvas - 覆盖层Canvas（用于画笔指示）
     */
    constructor(mainCanvas, overlayCanvas) {
        this.mainCanvas = mainCanvas;
        this.overlayCanvas = overlayCanvas;
        this.ctx = canvasUtils.getContext(overlayCanvas);

        // 画笔参数
        this.size = 10;          // 画笔大小（1-50像素）
        this.hardness = 50;      // 画笔硬度（0-100）
        this.mode = 'add';       // 画笔模式：'add'=正画笔, 'subtract'=负画笔

        // 绘制状态
        this.isDrawing = false;
        this.lastX = 0;
        this.lastY = 0;

        // 边缘数据引用（由imageProcessor设置）
        this.edgeData = null;
        this.edgeDataWidth = 0;
        this.edgeDataHeight = 0;

        // 原始图像数据引用（用于正画笔的边缘检测）
        this.originalImageData = null;

        // 阴影处理器引用（用于复用Canny边缘检测算法）
        this.shadowProcessor = null;

        // 统一撤销/重做管理器（至少支持10步，实际支持20步）
        this.history = new UndoRedoManager(20);
    }

    /**
     * 设置画笔大小
     * @param {number} value - 大小值（1-50像素）
     */
    setSize(value) {
        this.size = Math.max(1, Math.min(50, value));
    }

    /**
     * 设置画笔硬度
     * @param {number} value - 硬度值（0-100）
     */
    setHardness(value) {
        this.hardness = Math.max(0, Math.min(100, value));
    }

    /**
     * 设置画笔模式
     * @param {string} mode - 模式（'add'=正画笔 / 'subtract'=负画笔）
     */
    setMode(mode) {
        this.mode = mode;
    }

    /**
     * 设置边缘数据引用
     * @param {Uint8ClampedArray} edgeData - 边缘数据数组
     * @param {number} width - 图像宽度
     * @param {number} height - 图像高度
     */
    setEdgeData(edgeData, width, height) {
        this.edgeData = edgeData;
        this.edgeDataWidth = width;
        this.edgeDataHeight = height;
    }

    /**
     * 设置原始图像数据引用
     * @param {Uint8ClampedArray} imageData - 原始图像RGBA数据
     * @param {number} width - 图像宽度
     * @param {number} height - 图像高度
     */
    setOriginalImageData(imageData, width, height) {
        this.originalImageData = imageData;
        this.originalImageWidth = width;
        this.originalImageHeight = height;
    }

    /**
     * 设置阴影处理器引用
     * @param {ShadowProcessor} processor - 阴影处理器实例
     */
    setShadowProcessor(processor) {
        this.shadowProcessor = processor;
    }

    // ==================== 绘制交互方法 ====================

    /**
     * 开始边缘画笔绘制
     * 在overlay canvas上清空之前的画笔指示，开始新的绘制
     * @param {number} x - X坐标（canvas坐标）
     * @param {number} y - Y坐标（canvas坐标）
     * @param {number} scale - 当前缩放比例
     */
    startDrawing(x, y, scale = 1) {
        this.isDrawing = true;
        this.lastX = x;
        this.lastY = y;

        // 清空overlay canvas，避免与选区渲染冲突
        canvasUtils.clearCanvas(this.overlayCanvas);

        // 绘制画笔指示点
        this.drawIndicator(x, y, scale);
    }

    /**
     * 边缘画笔绘制中
     * 在overlay canvas上绘制画笔指示轨迹
     * @param {number} x - X坐标（canvas坐标）
     * @param {number} y - Y坐标（canvas坐标）
     * @param {number} scale - 当前缩放比例
     */
    drawIndicator(x, y, scale = 1) {
        if (!this.isDrawing) return;

        const canvasSize = this.size / scale;

        this.ctx.save();
        this.ctx.lineWidth = canvasSize;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        // 根据模式设置不同的指示颜色
        if (this.mode === 'add') {
            // 正画笔：半透明绿色，表示将在此区域检测并添加边缘
            this.ctx.strokeStyle = 'rgba(0, 255, 0, 0.3)';
        } else {
            // 负画笔：半透明红色，表示将在此区域抹除边缘
            this.ctx.strokeStyle = 'rgba(255, 0, 0, 0.3)';
        }

        this.ctx.beginPath();
        this.ctx.moveTo(this.lastX, this.lastY);
        this.ctx.lineTo(x, y);
        this.ctx.stroke();

        this.ctx.restore();

        this.lastX = x;
        this.lastY = y;
    }

    /**
     * 停止边缘画笔绘制并应用效果
     * 在mouseup时触发，执行实际的正画笔边缘检测或负画笔边缘抹除
     * @param {number} scale - 当前缩放比例
     */
    stopDrawing(scale = 1) {
        if (!this.isDrawing) return;

        this.isDrawing = false;

        // 保存当前状态到历史记录（在应用修改前）
        this.saveToHistory();

        // 获取画笔涂抹的蒙版区域
        const brushMask = this.getBrushStrokeMask(scale);

        if (this.mode === 'add') {
            // 正画笔：对涂抹区域执行边缘检测并合并到edgeData
            this.applyPositiveBrush(brushMask);
        } else {
            // 负画笔：抹除涂抹区域内的边缘像素
            this.applyNegativeBrush(brushMask);
        }

        // 清空overlay canvas上的画笔指示
        canvasUtils.clearCanvas(this.overlayCanvas);
    }

    // ==================== 正画笔核心逻辑 ====================

    /**
     * 应用正画笔：对涂抹区域执行边缘检测，将检测到的边缘合并到edgeData
     *
     * 算法流程：
     * 1. 计算涂抹区域的边界框（bounding box），添加padding用于梯度计算
     * 2. 从原始图像中裁剪出对应区域
     * 3. 对裁剪区域执行Canny边缘检测
     * 4. 将检测到的边缘像素映射回全局坐标
     * 5. 仅保留位于涂抹蒙版内的边缘像素，合并到edgeData
     *
     * @param {Uint8ClampedArray} brushMask - 涂抹蒙版（255=涂抹区域，0=未涂抹）
     */
    applyPositiveBrush(brushMask) {
        if (!this.edgeData || !this.originalImageData || !this.shadowProcessor) {
            console.warn('边缘画笔缺少必要的数据引用');
            return;
        }

        const width = this.edgeDataWidth;
        const height = this.edgeDataHeight;

        // 步骤1：计算涂抹区域的边界框
        const bbox = this.calculateBoundingBox(brushMask, width, height);
        if (!bbox) return; // 没有涂抹区域

        const padding = 10; // 为梯度计算添加padding
        const cropX = Math.max(0, bbox.x - padding);
        const cropY = Math.max(0, bbox.y - padding);
        const cropW = Math.min(width - cropX, bbox.w + padding * 2);
        const cropH = Math.min(height - cropY, bbox.h + padding * 2);

        // 步骤2：从原始图像中裁剪出对应区域
        const croppedImageData = this.cropImageData(
            this.originalImageData,
            width, height,
            cropX, cropY, cropW, cropH
        );

        // 步骤3：对裁剪区域执行Canny边缘检测
        let croppedEdges;
        if (this.shadowProcessor.isOpenCVReady()) {
            croppedEdges = this.shadowProcessor.detectEdgesWithOpenCV(croppedImageData, {
                lowThreshold: 5,
                highThreshold: 40,
                blurKernelSize: 3,
                blurSigma: 0
            });
        } else {
            croppedEdges = this.shadowProcessor.detectEdges(croppedImageData);
        }

        // 步骤4-5：将检测到的边缘映射回全局坐标，仅保留涂抹蒙版内的像素
        for (let ly = 0; ly < cropH; ly++) {
            for (let lx = 0; lx < cropW; lx++) {
                const localIdx = ly * cropW + lx;
                if (croppedEdges[localIdx] === 0) continue;

                const globalX = cropX + lx;
                const globalY = cropY + ly;
                const globalIdx = globalY * width + globalX;

                // 仅保留涂抹蒙版内的边缘像素，避免padding区域产生额外边缘
                if (brushMask[globalIdx] > 0) {
                    this.edgeData[globalIdx] = 255;
                }
            }
        }
    }

    /**
     * 计算涂抹区域的边界框
     * @param {Uint8ClampedArray} mask - 涂抹蒙版
     * @param {number} width - 图像宽度
     * @param {number} height - 图像高度
     * @returns {Object|null} 边界框 {x, y, w, h}，无涂抹区域时返回null
     */
    calculateBoundingBox(mask, width, height) {
        let minX = width, minY = height, maxX = 0, maxY = 0;
        let hasPixels = false;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (mask[y * width + x] > 0) {
                    hasPixels = true;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }

        if (!hasPixels) return null;

        return {
            x: minX,
            y: minY,
            w: maxX - minX + 1,
            h: maxY - minY + 1
        };
    }

    /**
     * 从原始图像数据中裁剪指定区域
     * @param {Uint8ClampedArray} sourceData - 原始图像RGBA数据
     * @param {number} srcWidth - 原始图像宽度
     * @param {number} srcHeight - 原始图像高度
     * @param {number} cropX - 裁剪区域左上角X
     * @param {number} cropY - 裁剪区域左上角Y
     * @param {number} cropW - 裁剪区域宽度
     * @param {number} cropH - 裁剪区域高度
     * @returns {ImageData} 裁剪后的ImageData
     */
    cropImageData(sourceData, srcWidth, srcHeight, cropX, cropY, cropW, cropH) {
        const cropped = new ImageData(cropW, cropH);

        for (let y = 0; y < cropH; y++) {
            for (let x = 0; x < cropW; x++) {
                const srcIdx = ((cropY + y) * srcWidth + (cropX + x)) * 4;
                const dstIdx = (y * cropW + x) * 4;

                cropped.data[dstIdx] = sourceData[srcIdx];         // R
                cropped.data[dstIdx + 1] = sourceData[srcIdx + 1]; // G
                cropped.data[dstIdx + 2] = sourceData[srcIdx + 2]; // B
                cropped.data[dstIdx + 3] = sourceData[srcIdx + 3]; // A
            }
        }

        return cropped;
    }

    // ==================== 负画笔核心逻辑 ====================

    /**
     * 应用负画笔：抹除涂抹区域内的边缘像素
     * 仅影响edgeData数组，不影响原始图像内容
     * @param {Uint8ClampedArray} brushMask - 涂抹蒙版（255=涂抹区域，0=未涂抹）
     */
    applyNegativeBrush(brushMask) {
        if (!this.edgeData) {
            console.warn('边缘画笔缺少edgeData引用');
            return;
        }

        const width = this.edgeDataWidth;
        const height = this.edgeDataHeight;

        // 遍历涂抹蒙版，将对应位置的边缘像素清零
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (brushMask[idx] > 0) {
                    this.edgeData[idx] = 0;
                }
            }
        }
    }

    // ==================== 画笔蒙版提取 ====================

    /**
     * 从overlay canvas提取画笔涂抹的蒙版区域
     * 通过识别画笔指示颜色来区分涂抹区域
     * @param {number} scale - 当前缩放比例
     * @returns {Uint8ClampedArray} 涂抹蒙版（255=涂抹区域，0=未涂抹）
     */
    getBrushStrokeMask(scale = 1) {
        const width = this.overlayCanvas.width;
        const height = this.overlayCanvas.height;
        const imageData = canvasUtils.getImageData(this.overlayCanvas);
        const mask = new Uint8ClampedArray(width * height);

        // 颜色阈值：识别画笔指示颜色
        const colorThreshold = 30;

        for (let i = 0; i < width * height; i++) {
            const idx = i * 4;
            const r = imageData.data[idx];
            const g = imageData.data[idx + 1];
            const b = imageData.data[idx + 2];
            const a = imageData.data[idx + 3];

            if (a < 20) continue; // 跳过完全透明的像素

            if (this.mode === 'add') {
                // 正画笔指示：绿色（G通道明显高于R和B）
                if (g > r + colorThreshold && g > b + colorThreshold) {
                    mask[i] = 255;
                }
            } else {
                // 负画笔指示：红色（R通道明显高于G和B）
                if (r > g + colorThreshold && r > b + colorThreshold) {
                    mask[i] = 255;
                }
            }
        }

        return mask;
    }

    // ==================== 历史记录（撤销/重做） ====================

    /**
     * 保存当前边缘数据到历史记录
     * 在每次应用画笔效果前调用
     */
    saveToHistory() {
        if (!this.edgeData) return;

        // 保存edgeData的深拷贝到统一管理器
        const snapshot = new Uint8ClampedArray(this.edgeData);
        this.history.push(snapshot);
    }

    /**
     * 撤销：恢复到上一步的边缘数据状态
     * @returns {boolean} 是否成功撤销
     */
    undo() {
        const snapshot = this.history.undo();
        if (!snapshot) return false;

        this.edgeData.set(snapshot);
        return true;
    }

    /**
     * 重做：前进到下一步的边缘数据状态
     * @returns {boolean} 是否成功重做
     */
    redo() {
        const snapshot = this.history.redo();
        if (!snapshot) return false;

        this.edgeData.set(snapshot);
        return true;
    }

    /**
     * 检查是否可以撤销
     * @returns {boolean}
     */
    canUndo() {
        return this.history.canUndo();
    }

    /**
     * 检查是否可以重做
     * @returns {boolean}
     */
    canRedo() {
        return this.history.canRedo();
    }

    /**
     * 获取当前历史记录步数
     * @returns {number} 当前索引（0-based）
     */
    getHistoryStepCount() {
        return this.history.getStepCount();
    }

    /**
     * 获取历史记录总步数
     * @returns {number}
     */
    getHistoryTotalCount() {
        return this.history.getTotalCount();
    }

    /**
     * 重置边缘画笔状态
     * 清空历史记录和绘制状态
     */
    reset() {
        this.history.clear();
        this.isDrawing = false;
        this.edgeData = null;
        this.edgeDataWidth = 0;
        this.edgeDataHeight = 0;
        this.originalImageData = null;
        canvasUtils.clearCanvas(this.overlayCanvas);
    }
}