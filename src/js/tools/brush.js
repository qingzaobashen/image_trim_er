/**
 * 画笔涂抹工具模块
 * 用于精细调整选区边缘
 */

import * as canvasUtils from '../utils/canvasUtils.js';

/**
 * 画笔涂抹工具类
 */
export class BrushTool {
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
        this.mode = 'add';
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
        this.draw(x, y);
    }

    /**
     * 绘制
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     */
    draw(x, y) {
        if (!this.isDrawing) return;

        this.ctx.save();
        
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.lineWidth = this.size;
        
        if (this.mode === 'add') {
            this.ctx.strokeStyle = 'rgba(99, 102, 241, 0.5)';
            this.ctx.fillStyle = 'rgba(99, 102, 241, 0.5)';
        } else {
            this.ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
            this.ctx.fillStyle = 'rgba(239, 68, 68, 0.5)';
        }

        if (this.hardness < 100) {
            const blur = (100 - this.hardness) / 100;
            this.ctx.filter = `blur(${this.size * blur * 0.5}px)`;
        }

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
     * 停止绘制
     */
    stopDrawing() {
        this.isDrawing = false;
    }

    /**
     * 从覆盖层获取画笔蒙版
     * @returns {Uint8ClampedArray} 画笔蒙版
     */
    getBrushMask() {
        const imageData = canvasUtils.getImageData(this.overlayCanvas);
        const width = this.overlayCanvas.width;
        const height = this.overlayCanvas.height;
        const mask = new Uint8ClampedArray(width * height);

        for (let i = 0; i < width * height; i++) {
            const index = i * 4;
            const r = imageData.data[index];
            const g = imageData.data[index + 1];
            const b = imageData.data[index + 2];
            const a = imageData.data[index + 3];

            if (a > 50) {
                const distToAdd = Math.sqrt(
                    Math.pow(r - 99, 2) + 
                    Math.pow(g - 102, 2) + 
                    Math.pow(b - 241, 2)
                );
                
                const distToSubtract = Math.sqrt(
                    Math.pow(r - 239, 2) + 
                    Math.pow(g - 68, 2) + 
                    Math.pow(b - 68, 2)
                );
                
                if (distToAdd < distToSubtract && distToAdd < 100) {
                    mask[i] = 255;
                } else if (distToSubtract < distToAdd && distToSubtract < 100) {
                    mask[i] = 128;
                }
            }
        }

        return mask;
    }

    /**
     * 应用画笔到选区
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
                existingMask[i] = 255;
            } else if (brushMask[i] === 128) {
                existingMask[i] = 0;
            }
        }

        return existingMask;
    }

    /**
     * 清除画笔绘制
     */
    clear() {
        canvasUtils.clearCanvas(this.overlayCanvas);
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
