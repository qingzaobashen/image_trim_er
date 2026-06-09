/**
 * 画笔涂抹工具模块
 * 用于精细调整选区边缘
 */

import * as canvasUtils from '../utils/canvasUtils.js';

/**
 * 画笔涂抹工具类
 *
 * 实现说明：
 * 为避免已有选区蒙版（紫色/粉色）干扰画笔轨迹识别，本类内部维护一个
 * 独立的 brushCanvas，仅用于记录画笔轨迹。用户看到的绘制仍发生在
 * overlayCanvas 上（与选区叠加显示），但 getBrushMask 从 brushCanvas
 * 读取，确保只提取真实画笔轨迹，不依赖颜色距离判断。
 */
export class BrushTool {
    /**
     * 构造函数
     * @param {HTMLCanvasElement} overlayCanvas - 覆盖层Canvas
     */
    constructor(overlayCanvas) {
        this.overlayCanvas = overlayCanvas;
        this.ctx = canvasUtils.getContext(overlayCanvas);

        // 内部画笔轨迹画布，与 overlayCanvas 尺寸同步
        this.brushCanvas = document.createElement('canvas');
        this.brushCanvas.width = overlayCanvas.width;
        this.brushCanvas.height = overlayCanvas.height;
        this.brushCtx = this.brushCanvas.getContext('2d');

        this.size = 20;
        this.hardness = 50;
        this.isDrawing = false;
        this.lastX = 0;
        this.lastY = 0;
        this.mode = 'add';
    }

    /**
     * 同步内部画笔画布尺寸与 overlayCanvas 保持一致
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
     * 设置画笔模式
     * @param {string} mode - 模式 ('add' 或 'subtract')
     */
    setMode(mode) {
        this.mode = mode;
    }

    /**
     * 开始绘制
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     */
    startDrawing(x, y) {
        this.isDrawing = true;
        this.lastX = x;
        this.lastY = y;

        // 确保内部画布尺寸正确并清空，准备记录新的画笔轨迹
        this.syncBrushCanvasSize();
        canvasUtils.clearCanvas(this.brushCanvas);

        this.draw(x, y);
    }

    /**
     * 绘制
     * 同时绘制到 overlayCanvas（用户可见）和内部 brushCanvas（轨迹提取）
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     */
    draw(x, y) {
        if (!this.isDrawing) return;

        // 统一绘制样式
        const style = this.mode === 'add'
            ? 'rgba(99, 102, 241, 0.5)'
            : 'rgba(239, 68, 68, 0.5)';

        // 绘制到 overlayCanvas（用户可见）
        this._drawOnContext(this.ctx, x, y, style);

        // 绘制到内部 brushCanvas（用于蒙版提取）
        this._drawOnContext(this.brushCtx, x, y, style);

        this.lastX = x;
        this.lastY = y;
    }

    /**
     * 在指定上下文上执行绘制
     * @param {CanvasRenderingContext2D} context - 目标上下文
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @param {string} style - 颜色样式
     * @private
     */
    _drawOnContext(context, x, y, style) {
        context.save();

        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.lineWidth = this.size;
        context.strokeStyle = style;
        context.fillStyle = style;

        if (this.hardness < 100) {
            const blur = (100 - this.hardness) / 100;
            context.filter = `blur(${this.size * blur * 0.5}px)`;
        }

        context.beginPath();
        context.moveTo(this.lastX, this.lastY);
        context.lineTo(x, y);
        context.stroke();

        context.beginPath();
        context.arc(x, y, this.size / 2, 0, Math.PI * 2);
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
     * 从内部画笔画布获取画笔蒙版
     * 直接基于 alpha 阈值判断，不再依赖颜色距离，避免与选区蒙版颜色冲突
     * @returns {Uint8ClampedArray} 画笔蒙版
     */
    getBrushMask() {
        const imageData = canvasUtils.getImageData(this.brushCanvas);
        const width = this.brushCanvas.width;
        const height = this.brushCanvas.height;
        const mask = new Uint8ClampedArray(width * height);

        for (let i = 0; i < width * height; i++) {
            const index = i * 4;
            const a = imageData.data[index + 3];
            // alpha 大于阈值即认为是画笔涂抹过的像素
            if (a > 50) {
                mask[i] = 255;
            }
        }

        return mask;
    }

    /**
     * 应用画笔到选区
     * 根据当前画笔模式（add/subtract）决定是添加还是减去选区
     * @param {Uint8ClampedArray} existingMask - 现有蒙版
     * @param {Uint8ClampedArray} brushMask - 画笔蒙版（可选，如果不提供则自动获取）
     * @returns {Uint8ClampedArray} 更新后的蒙版
     */
    applyToMask(existingMask, brushMask = null) {
        if (!brushMask) {
            brushMask = this.getBrushMask();
        }

        const width = this.overlayCanvas.width;
        const height = this.overlayCanvas.height;

        if (!existingMask || existingMask.length !== width * height) {
            existingMask = new Uint8ClampedArray(width * height);
        }

        for (let i = 0; i < width * height; i++) {
            if (brushMask[i] === 255) {
                if (this.mode === 'add') {
                    existingMask[i] = 255;
                } else {
                    existingMask[i] = 0;
                }
            }
        }

        return existingMask;
    }

    /**
     * 清除画笔绘制（清除 overlayCanvas 和内部 brushCanvas）
     */
    clear() {
        canvasUtils.clearCanvas(this.overlayCanvas);
        canvasUtils.clearCanvas(this.brushCanvas);
    }

    /**
     * 绘制圆形光标
     * @param {CanvasRenderingContext2D} ctx - Canvas上下文
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     */
    drawCursor(ctx, x, y) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, this.size / 2, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = this.mode === 'add' ? 'rgba(99, 102, 241, 1)' : 'rgba(239, 68, 68, 1)';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(x, y, this.size / 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.restore();
    }
}

/**
 * 橡皮擦工具类
 */
export class EraserTool {
    /**
     * 构造函数
     * @param {HTMLCanvasElement} overlayCanvas - 覆盖层Canvas
     */
    constructor(overlayCanvas) {
        this.overlayCanvas = overlayCanvas;
        this.ctx = canvasUtils.getContext(overlayCanvas);
        this.size = 20;
        this.hardness = 50;
        this.isDrawing = false;
        this.lastX = 0;
        this.lastY = 0;
    }

    /**
     * 设置橡皮擦大小
     * @param {number} value - 大小值 (5-100)
     */
    setSize(value) {
        this.size = value;
    }

    /**
     * 设置橡皮擦硬度
     * @param {number} value - 硬度值 (0-100)
     */
    setHardness(value) {
        this.hardness = value;
    }

    /**
     * 开始擦除
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     */
    startErasing(x, y) {
        this.isDrawing = true;
        this.lastX = x;
        this.lastY = y;
        this.erase(x, y);
    }

    /**
     * 擦除
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     */
    erase(x, y) {
        if (!this.isDrawing) return;

        this.ctx.save();

        this.ctx.globalCompositeOperation = 'destination-out';
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.lineWidth = this.size;

        this.ctx.beginPath();
        this.ctx.moveTo(this.lastX, this.lastY);
        this.ctx.lineTo(x, y);
        this.ctx.stroke();

        this.ctx.beginPath();
        this.ctx.arc(x, y, this.size / 2, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.restore();

        this.lastX = x;
        this.lastY = y;
    }

    /**
     * 停止擦除
     */
    stopErasing() {
        this.isDrawing = false;
    }
}
