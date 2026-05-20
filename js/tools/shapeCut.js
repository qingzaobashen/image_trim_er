/**
 * 形状抠图工具模块
 * 提供多种几何形状的抠图功能
 */

import * as canvasUtils from '../utils/canvasUtils.js';

/**
 * 形状抠图类
 */
export class ShapeCutTool {
    /**
     * 构造函数
     * @param {HTMLCanvasElement} mainCanvas - 主Canvas
     * @param {HTMLCanvasElement} overlayCanvas - 覆盖层Canvas
     */
    constructor(mainCanvas, overlayCanvas) {
        this.mainCanvas = mainCanvas;
        this.overlayCanvas = overlayCanvas;
        this.ctx = canvasUtils.getContext(this.overlayCanvas);
        
        this.shapeType = 'rectangle';
        this.startX = 0;
        this.startY = 0;
        this.currentX = 0;
        this.currentY = 0;
        this.isDrawing = false;
    }

    /**
     * 设置形状类型
     * @param {string} type - 形状类型 ('rectangle', 'circle', 'ellipse', 'petal', 'star', 'heart')
     */
    setShapeType(type) {
        this.shapeType = type;
    }

    /**
     * 开始绘制形状
     * @param {number} x - 起始X坐标
     * @param {number} y - 起始Y坐标
     */
    startDrawing(x, y) {
        this.isDrawing = true;
        this.startX = x;
        this.startY = y;
        this.currentX = x;
        this.currentY = y;
    }

    /**
     * 更新绘制
     * @param {number} x - 当前X坐标
     * @param {number} y - 当前Y坐标
     */
    updateDrawing(x, y) {
        if (!this.isDrawing) return;
        
        this.currentX = x;
        this.currentY = y;
        this.drawPreview();
    }

    /**
     * 结束绘制并应用抠图
     * @returns {Uint8ClampedArray} 选区蒙版
     */
    finishDrawing() {
        if (!this.isDrawing) return null;
        
        this.isDrawing = false;
        canvasUtils.clearCanvas(this.overlayCanvas);
        
        const mask = this.createShapeMask();
        return mask;
    }

    /**
     * 取消绘制
     */
    cancelDrawing() {
        this.isDrawing = false;
        canvasUtils.clearCanvas(this.overlayCanvas);
    }

    /**
     * 绘制预览
     */
    drawPreview() {
        canvasUtils.clearCanvas(this.overlayCanvas);
        
        const ctx = this.ctx;
        ctx.strokeStyle = '#6366f1';
        ctx.fillStyle = 'rgba(99, 102, 241, 0.2)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        
        const width = this.currentX - this.startX;
        const height = this.currentY - this.startY;
        
        ctx.beginPath();
        
        switch (this.shapeType) {
            case 'rectangle':
                this.drawRectangle(this.startX, this.startY, width, height);
                break;
            case 'circle':
                this.drawCircle(this.startX, this.startY, width, height);
                break;
            case 'ellipse':
                this.drawEllipse(this.startX, this.startY, width, height);
                break;
            case 'petal':
                this.drawPetal(this.startX, this.startY, width, height);
                break;
            case 'star':
                this.drawStar(this.startX, this.startY, width, height);
                break;
            case 'heart':
                this.drawHeart(this.startX, this.startY, width, height);
                break;
        }
        
        ctx.stroke();
        ctx.fill();
    }

    /**
     * 绘制矩形
     */
    drawRectangle(x, y, width, height) {
        const ctx = this.ctx;
        const rx = width >= 0 ? x : x + width;
        const ry = height >= 0 ? y : y + height;
        const rw = Math.abs(width);
        const rh = Math.abs(height);
        
        ctx.rect(rx, ry, rw, rh);
        
        ctx.font = '14px Arial';
        ctx.fillStyle = '#6366f1';
        ctx.fillText(`${rw} × ${rh}`, rx + rw / 2 - 30, ry - 10);
    }

    /**
     * 绘制圆形（从起点拖动到当前点作为直径）
     */
    drawCircle(x, y, width, height) {
        const ctx = this.ctx;
        const radiusX = Math.abs(width) / 2;
        const radiusY = Math.abs(height) / 2;
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        const radius = Math.min(radiusX, radiusY);
        
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        
        ctx.font = '14px Arial';
        ctx.fillStyle = '#6366f1';
        ctx.fillText(`r = ${Math.round(radius)}`, centerX - 20, centerY - radius - 10);
    }

    /**
     * 绘制椭圆
     */
    drawEllipse(x, y, width, height) {
        const ctx = this.ctx;
        const radiusX = Math.abs(width) / 2;
        const radiusY = Math.abs(height) / 2;
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        
        ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
        
        ctx.font = '14px Arial';
        ctx.fillStyle = '#6366f1';
        ctx.fillText(`rx = ${Math.round(radiusX)}, ry = ${Math.round(radiusY)}`, centerX - 50, centerY - radiusY - 10);
    }

    /**
     * 绘制花瓣形状（向日葵样式）
     * @param {number} cx - 中心X
     * @param {number} cy - 中心Y
     * @param {number} width - 宽度
     * @param {number} height - 高度
     */
    drawPetal(cx, cy, width, height) {
        const ctx = this.ctx;
        const radiusX = Math.abs(width) / 2;
        const radiusY = Math.abs(height) / 2;

        const centerX = cx + width / 2;
        const centerY = cy + height / 2;

        const petals = 8;
        const petalLength = Math.min(radiusX, radiusY) * 0.85;
        const innerRadius = petalLength * 0.25;

        for (let i = 0; i < petals; i++) {
            const angle = (i * 2 * Math.PI / petals) - Math.PI / 2;
            const nextAngle = ((i + 1) * 2 * Math.PI / petals) - Math.PI / 2;
            const midAngle = (angle + nextAngle) / 2;
            const halfAngle = (nextAngle - angle) / 2;

            const innerLeftAngle = midAngle - halfAngle * 0.6;
            const innerRightAngle = midAngle + halfAngle * 0.6;
            const outerLeftAngle = midAngle - halfAngle * 0.3;
            const outerRightAngle = midAngle + halfAngle * 0.3;

            const innerLeftX = centerX + Math.cos(innerLeftAngle) * innerRadius;
            const innerLeftY = centerY + Math.sin(innerLeftAngle) * innerRadius;
            const innerRightX = centerX + Math.cos(innerRightAngle) * innerRadius;
            const innerRightY = centerY + Math.sin(innerRightAngle) * innerRadius;

            const outerLeftX = centerX + Math.cos(outerLeftAngle) * petalLength;
            const outerLeftY = centerY + Math.sin(outerLeftAngle) * petalLength;
            const outerRightX = centerX + Math.cos(outerRightAngle) * petalLength;
            const outerRightY = centerY + Math.sin(outerRightAngle) * petalLength;

            const tipX = centerX + Math.cos(midAngle) * petalLength;
            const tipY = centerY + Math.sin(midAngle) * petalLength;

            if (i === 0) {
                ctx.moveTo(innerLeftX, innerLeftY);
            }
            ctx.lineTo(outerLeftX, outerLeftY);
            ctx.quadraticCurveTo(tipX, tipY, outerRightX, outerRightY);
            ctx.lineTo(innerRightX, innerRightY);
        }

        ctx.closePath();
    }

    /**
     * 绘制星形
     */
    drawStar(cx, cy, width, height) {
        const ctx = this.ctx;
        const centerX = cx + width / 2;
        const centerY = cy + height / 2;
        const outerRadius = Math.min(Math.abs(width), Math.abs(height)) / 2;
        const innerRadius = outerRadius * 0.4;
        const points = 5;
        
        ctx.moveTo(centerX, centerY - outerRadius);
        
        for (let i = 0; i < points * 2; i++) {
            const radius = i % 2 === 0 ? outerRadius : innerRadius;
            const angle = (i * Math.PI / points) - Math.PI / 2;
            const x = centerX + Math.cos(angle) * radius;
            const y = centerY + Math.sin(angle) * radius;
            ctx.lineTo(x, y);
        }
        
        ctx.closePath();
    }

    /**
     * 绘制心形
     */
    drawHeart(cx, cy, width, height) {
        const ctx = this.ctx;
        const centerX = cx + width / 2;
        const centerY = cy + height / 2;
        const size = Math.min(Math.abs(width), Math.abs(height)) / 2;
        
        ctx.moveTo(centerX, centerY + size * 0.6);
        
        ctx.bezierCurveTo(
            centerX - size * 1.2, centerY - size * 0.2,
            centerX - size * 0.6, centerY - size * 1.2,
            centerX, centerY - size * 0.4
        );
        
        ctx.bezierCurveTo(
            centerX + size * 0.6, centerY - size * 1.2,
            centerX + size * 1.2, centerY - size * 0.2,
            centerX, centerY + size * 0.6
        );
    }

    /**
     * 创建形状蒙版
     * @returns {Uint8ClampedArray} 蒙版数据
     */
    createShapeMask() {
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        const mask = new Uint8ClampedArray(width * height);
        
        const shapeWidth = this.currentX - this.startX;
        const shapeHeight = this.currentY - this.startY;
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (this.isPointInShape(x, y, this.startX, this.startY, shapeWidth, shapeHeight)) {
                    mask[y * width + x] = 255;
                }
            }
        }
        
        return mask;
    }

    /**
     * 判断点是否在形状内
     * @param {number} px - 点X坐标
     * @param {number} py - 点Y坐标
     * @param {number} x - 起始X坐标
     * @param {number} y - 起始Y坐标
     * @param {number} width - 宽度
     * @param {number} height - 高度
     * @returns {boolean} 是否在形状内
     */
    isPointInShape(px, py, x, y, width, height) {
        switch (this.shapeType) {
            case 'rectangle':
                return this.isPointInRectangle(px, py, x, y, width, height);
            case 'circle':
                return this.isPointInCircle(px, py, x, y, width, height);
            case 'ellipse':
                return this.isPointInEllipse(px, py, x, y, width, height);
            case 'petal':
                return this.isPointInPetal(px, py, x, y, width, height);
            case 'star':
                return this.isPointInStar(px, py, x, y, width, height);
            case 'heart':
                return this.isPointInHeart(px, py, x, y, width, height);
            default:
                return false;
        }
    }

    /**
     * 判断点是否在矩形内
     */
    isPointInRectangle(px, py, x, y, width, height) {
        const rx = width >= 0 ? x : x + width;
        const ry = height >= 0 ? y : y + height;
        const rw = Math.abs(width);
        const rh = Math.abs(height);
        
        return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
    }

    /**
     * 判断点是否在圆形内
     */
    isPointInCircle(px, py, x, y, width, height) {
        const radiusX = Math.abs(width) / 2;
        const radiusY = Math.abs(height) / 2;
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        const radius = Math.min(radiusX, radiusY);
        
        const dx = px - centerX;
        const dy = py - centerY;
        
        return (dx * dx + dy * dy) <= radius * radius;
    }

    /**
     * 判断点是否在椭圆内
     */
    isPointInEllipse(px, py, x, y, width, height) {
        const radiusX = Math.abs(width) / 2;
        const radiusY = Math.abs(height) / 2;
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        
        const dx = (px - centerX) / radiusX;
        const dy = (py - centerY) / radiusY;
        
        return (dx * dx + dy * dy) <= 1;
    }

    /**
     * 判断点是否在花瓣内（向日葵样式）
     */
    isPointInPetal(px, py, x, y, width, height) {
        const radiusX = Math.abs(width) / 2;
        const radiusY = Math.abs(height) / 2;
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        const petalLength = Math.min(radiusX, radiusY) * 0.85;
        const innerRadius = petalLength * 0.25;

        const dx = px - centerX;
        const dy = py - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance > petalLength) return false;
        if (distance <= innerRadius) return true;

        let angle = Math.atan2(dy, dx);
        if (angle < 0) angle += Math.PI * 2;

        const petals = 8;
        const petalAngle = Math.PI * 2 / petals;
        const halfAngle = petalAngle / 2;

        const normalizedAngle = ((angle + halfAngle) % petalAngle + petalAngle) % petalAngle;
        const angularDist = Math.abs(normalizedAngle - halfAngle);

        const innerAngleLimit = halfAngle * 0.6;
        const outerAngleLimit = halfAngle * 0.3;

        if (angularDist <= innerAngleLimit) {
            return true;
        }

        if (angularDist > halfAngle) return false;

        const t = (angularDist - innerAngleLimit) / (halfAngle - innerAngleLimit);
        const maxDist = innerRadius + (petalLength - innerRadius) * (1 - t);

        return distance <= maxDist;
    }

    /**
     * 判断点是否在星形内
     * 原理：五角星由5个尖角组成，每个尖角占360°/5=72°
     * 尖角顶端在外圆半径上，内角底端在内圆半径上
     * 对于给定角度，计算该角度下星形边界允许的最大半径
     * 如果点到中心距离小于等于最大半径，则在星形内
     */
    isPointInStar(px, py, x, y, width, height) {
        // 计算星形包围盒的中心点
        const centerX = x + width / 2;
        const centerY = y + height / 2;

        // outerRadius: 外圆半径（尖角顶端到中心的距离）
        // innerRadius: 内圆半径（内角底端到中心的距离）
        const outerRadius = Math.min(Math.abs(width), Math.abs(height)) / 2;
        const innerRadius = outerRadius * 0.4;

        // 计算待判断点到星形中心的向量和距离
        const dx = px - centerX;
        const dy = py - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // 快速排除：距离超过外圆半径，一定在星形外
        if (distance > outerRadius) return false;

        // 计算点的角度（弧度），范围 [0, 2π]
        // atan2 返回 [-π, π]，负值需要加 2π 转为正值
        let angle = Math.atan2(dy, dx);
        if (angle < 0) angle += Math.PI * 2;

        // points: 五角星有5个尖角
        // starAngle: 每个尖角占用的角度 = 360° / 5 = 72° = 2π/5
        const points = 5;
        const starAngle = 2 * Math.PI / points;

        // 将角度标准化到第一个尖角的范围内 [0, starAngle)
        // 这样只需要处理一个尖角的判断逻辑
        const normalizedAngle = angle % starAngle;

        // angularDist: 点与尖角中线的角度距离
        // 由于尖角中线位于 starAngle/2 处，取到两端距离的较小值
        // 例如 starAngle=72°，normalizedAngle=20°时：
        //   min(20, 72-20) = min(20, 52) = 20°
        // 例如 starAngle=72°，normalizedAngle=50°时：
        //   min(50, 72-50) = min(50, 22) = 22°
        const angularDist = Math.min(normalizedAngle, starAngle - normalizedAngle);

        // t: 角度距离的归一化值，范围 [0, 1]
        // t=0 表示在尖角中线上（半径最大）
        // t=1 表示在内角边上（半径最小）
        const t = angularDist / (starAngle / 2);

        // maxRadius: 该角度下星形边界允许的最大半径
        // 在尖角中线方向（t=0），半径最大 = outerRadius
        // 在内角边方向（t=1），半径最小 = innerRadius
        // 中间角度时，半径线性插值
        const maxRadius = innerRadius + (outerRadius - innerRadius) * (1 - t);

        // 判断点是否在星形边界内
        return distance <= maxRadius;
    }

    /**
     * 判断点是否在心形内
     */
    isPointInHeart(px, py, x, y, width, height) {
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        const size = Math.min(Math.abs(width), Math.abs(height)) / 2;

        const dx = (px - centerX) / size;
        const dy = -(py - centerY - size * 0.3) / size;

        const heartEquation = Math.pow(dx * dx + dy * dy - 1, 3) - dx * dx * dy * dy * dy;

        return heartEquation <= 0;
    }
}
