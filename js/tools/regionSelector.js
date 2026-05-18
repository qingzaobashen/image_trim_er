/**
 * 框选工具模块
 * 用于框选图像区域进行局部处理
 */

import * as canvasUtils from '../utils/canvasUtils.js';

/**
 * 框选工具类
 */
export class RegionSelector {
    /**
     * 构造函数
     * @param {HTMLCanvasElement} overlayCanvas - 覆盖层Canvas
     * @param {HTMLCanvasElement} mainCanvas - 主Canvas
     */
    constructor(overlayCanvas, mainCanvas) {
        this.overlayCanvas = overlayCanvas;
        this.mainCanvas = mainCanvas;
        this.ctx = canvasUtils.getContext(overlayCanvas);
        
        this.isSelecting = false;
        this.startX = 0;
        this.startY = 0;
        this.currentX = 0;
        this.currentY = 0;
        
        this.onSelectionComplete = null;
    }

    /**
     * 开始框选
     * @param {number} x - 起始X坐标
     * @param {number} y - 起始Y坐标
     */
    startSelection(x, y) {
        this.isSelecting = true;
        this.startX = x;
        this.startY = y;
        this.currentX = x;
        this.currentY = y;
    }

    /**
     * 更新框选
     * @param {number} x - 当前X坐标
     * @param {number} y - 当前Y坐标
     */
    updateSelection(x, y) {
        if (!this.isSelecting) return;
        
        this.currentX = x;
        this.currentY = y;
        this.drawSelectionBox();
    }

    /**
     * 结束框选
     * @returns {Object|null} 框选区域，{x, y, width, height} 或 null
     */
    endSelection() {
        if (!this.isSelecting) return null;
        
        this.isSelecting = false;
        
        const rect = this.getSelectionRect();
        
        if (rect.width > 5 && rect.height > 5) {
            this.onSelectionComplete && this.onSelectionComplete(rect);
            return rect;
        }
        
        this.clearSelection();
        return null;
    }

    /**
     * 获取框选矩形区域
     * @returns {Object} {x, y, width, height}
     */
    getSelectionRect() {
        const x = Math.min(this.startX, this.currentX);
        const y = Math.min(this.startY, this.currentY);
        const width = Math.abs(this.currentX - this.startX);
        const height = Math.abs(this.currentY - this.startY);
        
        return { x, y, width, height };
    }

    /**
     * 绘制框选矩形
     */
    drawSelectionBox() {
        canvasUtils.clearCanvas(this.overlayCanvas);
        
        const rect = this.getSelectionRect();
        
        if (rect.width < 5 || rect.height < 5) return;
        
        this.ctx.save();
        
        this.ctx.strokeStyle = 'rgba(99, 102, 241, 1)';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 5]);
        this.ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
        
        this.ctx.fillStyle = 'rgba(99, 102, 241, 0.1)';
        this.ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        
        const cornerSize = 8;
        this.ctx.setLineDash([]);
        this.ctx.lineWidth = 3;
        this.ctx.strokeStyle = 'rgba(99, 102, 241, 1)';
        
        this.ctx.beginPath();
        this.ctx.moveTo(rect.x, rect.y + cornerSize);
        this.ctx.lineTo(rect.x, rect.y);
        this.ctx.lineTo(rect.x + cornerSize, rect.y);
        this.ctx.stroke();
        
        this.ctx.beginPath();
        this.ctx.moveTo(rect.x + rect.width - cornerSize, rect.y);
        this.ctx.lineTo(rect.x + rect.width, rect.y);
        this.ctx.lineTo(rect.x + rect.width, rect.y + cornerSize);
        this.ctx.stroke();
        
        this.ctx.beginPath();
        this.ctx.moveTo(rect.x + rect.width, rect.y + rect.height - cornerSize);
        this.ctx.lineTo(rect.x + rect.width, rect.y + rect.height);
        this.ctx.lineTo(rect.x + rect.width - cornerSize, rect.y + rect.height);
        this.ctx.stroke();
        
        this.ctx.beginPath();
        this.ctx.moveTo(rect.x + cornerSize, rect.y + rect.height);
        this.ctx.lineTo(rect.x, rect.y + rect.height);
        this.ctx.lineTo(rect.x, rect.y + rect.height - cornerSize);
        this.ctx.stroke();
        
        this.ctx.font = '14px Arial';
        this.ctx.fillStyle = 'rgba(99, 102, 241, 1)';
        this.ctx.fillText(
            `${Math.round(rect.width)} × ${Math.round(rect.height)}`,
            rect.x + rect.width / 2 - 30,
            rect.y - 10
        );
        
        this.ctx.restore();
    }

    /**
     * 清除框选
     */
    clearSelection() {
        canvasUtils.clearCanvas(this.overlayCanvas);
    }

    /**
     * 判断点是否在框选区域内
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @returns {boolean}
     */
    isPointInSelection(x, y) {
        const rect = this.getSelectionRect();
        return x >= rect.x && x <= rect.x + rect.width &&
               y >= rect.y && y <= rect.y + rect.height;
    }

    /**
     * 销毁
     */
    destroy() {
        this.clearSelection();
        this.isSelecting = false;
        this.onSelectionComplete = null;
    }
}
