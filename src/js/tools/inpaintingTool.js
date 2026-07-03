/**
 * 图像修复工具模块
 * 用于抹除图片上的水印、杂物、污渍等不需要的元素
 * 使用纯JavaScript实现修复算法，不依赖特定的OpenCV构建
 * 
 * 操作流程：
 * 1. 用户选择修复工具
 * 2. 使用画笔涂抹需要修复的区域
 * 3. 点击应用修复按钮
 * 4. 使用修复算法填充修复区域
 * 
 * 支持两种修复算法：
 * - 快速修复：基于周围像素加权插值，速度快
 * - 高质量修复：基于纹理合成和方向插值，效果更好
 */

import * as canvasUtils from '../utils/canvasUtils.js';

/**
 * 图像修复工具类
 */
export class InpaintingTool {
    /**
     * 构造函数
     * @param {HTMLCanvasElement} mainCanvas - 主Canvas
     * @param {HTMLCanvasElement} overlayCanvas - 覆盖层Canvas
     */
    constructor(mainCanvas, overlayCanvas) {
        this.mainCanvas = mainCanvas;
        this.overlayCanvas = overlayCanvas;
        this.ctx = canvasUtils.getContext(overlayCanvas);

        this.brushCanvas = document.createElement('canvas');
        this.brushCanvas.width = overlayCanvas.width;
        this.brushCanvas.height = overlayCanvas.height;
        this.brushCtx = this.brushCanvas.getContext('2d');

        this.size = 20;
        this.hardness = 50;
        this.isDrawing = false;
        this.lastX = 0;
        this.lastY = 0;
        this.inpaintMask = null;
        
        this.currentAlgorithm = 'fast';
    }

    /**
     * 同步内部画笔画布尺寸
     */
    syncBrushCanvasSize() {
        if (this.brushCanvas.width !== this.overlayCanvas.width ||
            this.brushCanvas.height !== this.overlayCanvas.height) {
            this.brushCanvas.width = this.overlayCanvas.width;
            this.brushCanvas.height = this.overlayCanvas.height;
        }
    }

    /**
     * 设置画笔大小
     * @param {number} value - 大小值 (5-100)
     */
    setSize(value) {
        this.size = value;
    }

    /**
     * 设置画笔硬度
     * @param {number} value - 硬度值 (0-100)
     */
    setHardness(value) {
        this.hardness = value;
    }

    /**
     * 设置修复算法
     * @param {string} algorithm - 'fast' 或 'highQuality'
     */
    setAlgorithm(algorithm) {
        this.currentAlgorithm = algorithm;
    }

    /**
     * 开始绘制修复区域
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @param {number} scale - 当前缩放比例
     */
    startDrawing(x, y, scale = 1) {
        this.isDrawing = true;
        this.lastX = x;
        this.lastY = y;

        this.syncBrushCanvasSize();
        canvasUtils.clearCanvas(this.brushCanvas);

        const canvasSize = this.size / scale;
        this.draw(x, y, canvasSize);
    }

    /**
     * 绘制修复区域
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @param {number} scale - 当前缩放比例
     */
    draw(x, y, scale = 1) {
        if (!this.isDrawing) return;

        const canvasSize = this.size / scale;

        const style = 'rgba(239, 68, 68, 0.6)';

        this._drawOnContext(this.ctx, x, y, canvasSize, style);

        this._drawOnContext(this.brushCtx, x, y, canvasSize, 'rgba(255, 0, 0, 1)');

        this.lastX = x;
        this.lastY = y;
    }

    /**
     * 在指定上下文上执行绘制
     * @param {CanvasRenderingContext2D} context - 目标上下文
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @param {number} size - 画笔大小
     * @param {string} style - 颜色样式
     * @private
     */
    _drawOnContext(context, x, y, size, style) {
        context.save();

        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.lineWidth = size;
        context.strokeStyle = style;
        context.fillStyle = style;

        if (this.hardness < 100) {
            const blur = (100 - this.hardness) / 100;
            context.filter = `blur(${size * blur * 0.3}px)`;
        }

        context.beginPath();
        context.moveTo(this.lastX, this.lastY);
        context.lineTo(x, y);
        context.stroke();

        context.beginPath();
        context.arc(x, y, size / 2, 0, Math.PI * 2);
        context.fill();

        context.restore();
    }

    /**
     * 停止绘制
     */
    stopDrawing() {
        this.isDrawing = false;
    }

    /**
     * 获取修复蒙版
     * @returns {Uint8ClampedArray} 修复蒙版
     */
    getInpaintMask() {
        const imageData = canvasUtils.getImageData(this.brushCanvas);
        const width = this.brushCanvas.width;
        const height = this.brushCanvas.height;
        const mask = new Uint8ClampedArray(width * height);

        for (let i = 0; i < width * height; i++) {
            const index = i * 4;
            const a = imageData.data[index + 3];
            if (a > 50) {
                mask[i] = 255;
            }
        }

        this.inpaintMask = mask;
        return mask;
    }

    /**
     * 应用修复
     * @param {Uint8ClampedArray} mask - 修复蒙版（255=需要修复的区域）
     * @returns {Promise<boolean>} 是否成功
     */
    async applyInpainting(mask) {
        if (!mask || mask.every(v => v === 0)) {
            return false;
        }

        if (this.currentAlgorithm === 'fast') {
            this._applyFastInpainting(mask);
        } else {
            await this._applyHighQualityInpainting(mask);
        }

        return true;
    }

    /**
     * 快速修复算法
     * 基于周围像素的加权插值，速度快但效果一般
     * @param {Uint8ClampedArray} mask - 修复蒙版
     * @private
     */
    _applyFastInpainting(mask) {
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        const imageData = canvasUtils.getImageData(this.mainCanvas);
        const resultData = new Uint8ClampedArray(imageData.data);

        const searchRadius = 20;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (mask[idx] === 0) continue;

                let rSum = 0, gSum = 0, bSum = 0, weightSum = 0;

                for (let dy = -searchRadius; dy <= searchRadius; dy++) {
                    for (let dx = -searchRadius; dx <= searchRadius; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;

                        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

                        const nidx = ny * width + nx;
                        if (mask[nidx] > 0) continue;

                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist === 0) continue;

                        const weight = 1 / (dist * dist);

                        const pixelIdx = nidx * 4;
                        rSum += imageData.data[pixelIdx] * weight;
                        gSum += imageData.data[pixelIdx + 1] * weight;
                        bSum += imageData.data[pixelIdx + 2] * weight;
                        weightSum += weight;
                    }
                }

                if (weightSum > 0) {
                    const pixelIdx = idx * 4;
                    resultData[pixelIdx] = Math.round(rSum / weightSum);
                    resultData[pixelIdx + 1] = Math.round(gSum / weightSum);
                    resultData[pixelIdx + 2] = Math.round(bSum / weightSum);
                }
            }
        }

        const resultImageData = new ImageData(resultData, width, height);
        canvasUtils.putImageData(this.mainCanvas, resultImageData);
    }

    /**
     * 高质量修复算法
     * 基于纹理合成和方向插值，效果更好但速度较慢
     * 使用多次迭代和方向感知的修复策略
     * @param {Uint8ClampedArray} mask - 修复蒙版
     * @private
     */
    async _applyHighQualityInpainting(mask) {
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        const imageData = canvasUtils.getImageData(this.mainCanvas);
        const resultData = new Uint8ClampedArray(imageData.data);

        const iterations = 3;
        const searchRadius = 30;

        for (let iter = 0; iter < iterations; iter++) {
            const tempData = new Uint8ClampedArray(resultData);

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = y * width + x;
                    if (mask[idx] === 0) continue;

                    const gradients = this._computeGradients(tempData, width, height, x, y);
                    
                    let bestR = 0, bestG = 0, bestB = 0;
                    let bestWeight = 0;

                    for (let dy = -searchRadius; dy <= searchRadius; dy++) {
                        for (let dx = -searchRadius; dx <= searchRadius; dx++) {
                            const nx = x + dx;
                            const ny = y + dy;

                            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

                            const nidx = ny * width + nx;
                            if (mask[nidx] > 0) continue;

                            const dist = Math.sqrt(dx * dx + dy * dy);
                            if (dist === 0) continue;

                            const neighborGradients = this._computeGradients(tempData, width, height, nx, ny);
                            
                            const gradSimilarity = this._gradientSimilarity(gradients, neighborGradients);
                            const distWeight = 1 / (dist * dist);
                            
                            const weight = distWeight * (0.5 + 0.5 * gradSimilarity);

                            const pixelIdx = nidx * 4;
                            bestR += tempData[pixelIdx] * weight;
                            bestG += tempData[pixelIdx + 1] * weight;
                            bestB += tempData[pixelIdx + 2] * weight;
                            bestWeight += weight;
                        }
                    }

                    if (bestWeight > 0) {
                        const pixelIdx = idx * 4;
                        resultData[pixelIdx] = Math.round(bestR / bestWeight);
                        resultData[pixelIdx + 1] = Math.round(bestG / bestWeight);
                        resultData[pixelIdx + 2] = Math.round(bestB / bestWeight);
                    }
                }
            }

            await new Promise(resolve => setTimeout(resolve, 0));
        }

        this._smoothEdges(resultData, mask, width, height);

        const resultImageData = new ImageData(resultData, width, height);
        canvasUtils.putImageData(this.mainCanvas, resultImageData);
    }

    /**
     * 计算像素的梯度值
     * @param {Uint8ClampedArray} data - 图像数据
     * @param {number} width - 图像宽度
     * @param {number} height - 图像高度
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @returns {Object} 梯度信息
     * @private
     */
    _computeGradients(data, width, height, x, y) {
        const idx = y * width + x;
        const pixelIdx = idx * 4;

        const leftX = Math.max(0, x - 1);
        const rightX = Math.min(width - 1, x + 1);
        const topY = Math.max(0, y - 1);
        const bottomY = Math.min(height - 1, y + 1);

        const leftIdx = (y * width + leftX) * 4;
        const rightIdx = (y * width + rightX) * 4;
        const topIdx = (topY * width + x) * 4;
        const bottomIdx = (bottomY * width + x) * 4;

        const dxR = data[rightIdx] - data[leftIdx];
        const dxG = data[rightIdx + 1] - data[leftIdx + 1];
        const dxB = data[rightIdx + 2] - data[leftIdx + 2];

        const dyR = data[bottomIdx] - data[topIdx];
        const dyG = data[bottomIdx + 1] - data[topIdx + 1];
        const dyB = data[bottomIdx + 2] - data[topIdx + 2];

        const magnitude = Math.sqrt(dxR * dxR + dxG * dxG + dxB * dxB + dyR * dyR + dyG * dyG + dyB * dyB);

        return { dxR, dxG, dxB, dyR, dyG, dyB, magnitude };
    }

    /**
     * 计算两个梯度的相似度
     * @param {Object} g1 - 梯度1
     * @param {Object} g2 - 梯度2
     * @returns {number} 相似度 (0-1)
     * @private
     */
    _gradientSimilarity(g1, g2) {
        const dot = g1.dxR * g2.dxR + g1.dxG * g2.dxG + g1.dxB * g2.dxB +
                    g1.dyR * g2.dyR + g1.dyG * g2.dyG + g1.dyB * g2.dyB;
        
        const mag1 = Math.sqrt(g1.dxR * g1.dxR + g1.dxG * g1.dxG + g1.dxB * g1.dxB +
                               g1.dyR * g1.dyR + g1.dyG * g1.dyG + g1.dyB * g1.dyB);
        const mag2 = Math.sqrt(g2.dxR * g2.dxR + g2.dxG * g2.dxG + g2.dxB * g2.dxB +
                               g2.dyR * g2.dyR + g2.dyG * g2.dyG + g2.dyB * g2.dyB);

        if (mag1 === 0 || mag2 === 0) return 1;
        
        return Math.max(0, Math.min(1, dot / (mag1 * mag2)));
    }

    /**
     * 平滑修复区域的边缘
     * @param {Uint8ClampedArray} data - 图像数据
     * @param {Uint8ClampedArray} mask - 修复蒙版
     * @param {number} width - 图像宽度
     * @param {number} height - 图像高度
     * @private
     */
    _smoothEdges(data, mask, width, height) {
        const tempData = new Uint8ClampedArray(data);
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (mask[idx] === 0) continue;

                let isEdge = false;
                for (let dy = -1; dy <= 1 && !isEdge; dy++) {
                    for (let dx = -1; dx <= 1 && !isEdge; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            if (mask[ny * width + nx] === 0) {
                                isEdge = true;
                            }
                        }
                    }
                }

                if (isEdge) {
                    let rSum = 0, gSum = 0, bSum = 0, count = 0;

                    for (let dy = -2; dy <= 2; dy++) {
                        for (let dx = -2; dx <= 2; dx++) {
                            const nx = x + dx;
                            const ny = y + dy;

                            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                                const nidx = (ny * width + nx) * 4;
                                rSum += tempData[nidx];
                                gSum += tempData[nidx + 1];
                                bSum += tempData[nidx + 2];
                                count++;
                            }
                        }
                    }

                    if (count > 0) {
                        const pixelIdx = idx * 4;
                        data[pixelIdx] = Math.round(rSum / count);
                        data[pixelIdx + 1] = Math.round(gSum / count);
                        data[pixelIdx + 2] = Math.round(bSum / count);
                    }
                }
            }
        }
    }

    /**
     * 清除绘制
     */
    clear() {
        canvasUtils.clearCanvas(this.overlayCanvas);
        canvasUtils.clearCanvas(this.brushCanvas);
        this.inpaintMask = null;
    }

    /**
     * 绘制光标
     * @param {CanvasRenderingContext2D} ctx - Canvas上下文
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @param {number} scale - 当前缩放比例
     */
    drawCursor(ctx, x, y, scale = 1) {
        const canvasSize = this.size / scale;
        
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, canvasSize / 2, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(239, 68, 68, 1)';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(x, y, canvasSize / 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.restore();
    }

    /**
     * 检查OpenCV.js是否已加载（始终返回false，因为不再使用OpenCV）
     * @returns {boolean}
     */
    isOpenCVReady() {
        return false;
    }
}
