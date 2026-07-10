/**
 * 形状抠图工具模块
 * 提供多种几何形状的抠图功能
 */

import * as canvasUtils from '../utils/canvasUtils.js';
import { SelectionTransformManager, HandleType } from './selectionTransform.js';

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

        this.transformManager = new SelectionTransformManager(overlayCanvas);
        this.lastMask = null;
        this.lastBounds = null;

        /** 多边形边数（3-12） */
        this.polygonSides = 6;
        /** 多边形归一化顶点（相对包围盒 0..1），绘制完成后填充 */
        this.polygonNormVerts = null;
        /** 正在拖拽的多边形顶点索引，-1 表示无 */
        this.draggingVertex = -1;
    }

    /**
     * 设置形状类型
     * @param {string} type - 形状类型 ('rectangle', 'circle', 'ellipse', 'petal', 'star', 'heart')
     */
    setShapeType(type) {
        this.shapeType = type;
        this.polygonNormVerts = null;
        this.draggingVertex = -1;
    }

    /**
     * 开始绘制形状
     * @param {number} x - 起始X坐标
     * @param {number} y - 起始Y坐标
     */
    startDrawing(x, y) {
        this.transformManager.clear();
        this.isDrawing = true;
        this.polygonNormVerts = null;
        this.draggingVertex = -1;
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
     * 结束绘制并显示选择框
     * @returns {Object} 包含蒙版和边界信息
     */
    finishDrawing() {
        if (!this.isDrawing) return null;

        this.isDrawing = false;

        const bounds = this.getSelectionBounds();
        if (!bounds || bounds.width < 5 || bounds.height < 5) {
            canvasUtils.clearCanvas(this.overlayCanvas);
            return null;
        }

        this.lastBounds = bounds;

        // 多边形：根据包围盒生成正多边形归一化顶点
        if (this.shapeType === 'polygon') {
            this.polygonNormVerts = this._computePolygonNormVerts(bounds);
        }

        this.lastMask = this.createShapeMask();
        this.transformManager.setSelectionBounds(bounds);

        return {
            mask: this.lastMask,
            bounds: bounds
        };
    }

    /**
     * 获取选区边界
     * @returns {Object} 边界对象 {x, y, width, height}
     */
    getSelectionBounds() {
        const x = Math.min(this.startX, this.currentX);
        const y = Math.min(this.startY, this.currentY);
        const width = Math.abs(this.currentX - this.startX);
        const height = Math.abs(this.currentY - this.startY);

        return { x, y, width, height };
    }

    /**
     * 根据变换后的边界重新生成蒙版
     * @param {Object} newBounds - 新的边界对象
     * @returns {Uint8ClampedArray} 新的蒙版
     */
    updateMaskFromBounds(newBounds) {
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        const mask = new Uint8ClampedArray(width * height);

        // 多边形：按新包围盒重算归一化顶点对应的绝对多边形
        if (this.shapeType === 'polygon') {
            const verts = this.getPolygonAbsoluteVerts(newBounds);
            if (verts.length > 0) {
                // 仅遍历多边形外接框，避免全图扫描
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const v of verts) {
                    minX = Math.min(minX, v.x);
                    minY = Math.min(minY, v.y);
                    maxX = Math.max(maxX, v.x);
                    maxY = Math.max(maxY, v.y);
                }
                const x0 = Math.max(0, Math.floor(minX));
                const y0 = Math.max(0, Math.floor(minY));
                const x1 = Math.min(width - 1, Math.ceil(maxX));
                const y1 = Math.min(height - 1, Math.ceil(maxY));
                for (let py = y0; py <= y1; py++) {
                    for (let px = x0; px <= x1; px++) {
                        if (this.isPointInPolygon(px, py, verts)) {
                            mask[py * width + px] = 255;
                        }
                    }
                }
            }
            this.lastMask = mask;
            this.lastBounds = newBounds;
            return mask;
        }

        const shapeWidth = newBounds.width;
        const shapeHeight = newBounds.height;

        for (let py = 0; py < height; py++) {
            for (let px = 0; px < width; px++) {
                if (this.isPointInShape(px, py, newBounds.x, newBounds.y, shapeWidth, shapeHeight)) {
                    mask[py * width + px] = 255;
                }
            }
        }

        this.lastMask = mask;
        this.lastBounds = newBounds;

        return mask;
    }

    /**
     * 获取变换管理器
     * @returns {SelectionTransformManager}
     */
    getTransformManager() {
        return this.transformManager;
    }

    /**
     * 获取最后的蒙版
     * @returns {Uint8ClampedArray}
     */
    getLastMask() {
        return this.lastMask;
    }

    /**
     * 清除选择框
     */
    clearSelection() {
        this.transformManager.clear();
        this.lastMask = null;
        this.lastBounds = null;
    }

    /**
     * 检查是否有激活的选择框
     * @returns {boolean}
     */
    hasActiveSelection() {
        return this.transformManager.isSelectionActive();
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
            case 'polygon':
                this.drawPolygonPreview(this.startX, this.startY, width, height);
                break;
        }
        
        ctx.stroke();
        ctx.fill();
    }

    /**
     * 绘制圆角矩形
     */
    drawRectangle(x, y, width, height) {
        const ctx = this.ctx;
        const rx = width >= 0 ? x : x + width;
        const ry = height >= 0 ? y : y + height;
        const rw = Math.abs(width);
        const rh = Math.abs(height);

        const cornerRadius = Math.min(rw, rh) * 0.15;

        ctx.moveTo(rx + cornerRadius, ry);
        ctx.lineTo(rx + rw - cornerRadius, ry);
        ctx.arcTo(rx + rw, ry, rx + rw, ry + cornerRadius, cornerRadius);
        ctx.lineTo(rx + rw, ry + rh - cornerRadius);
        ctx.arcTo(rx + rw, ry + rh, rx + rw - cornerRadius, ry + rh, cornerRadius);
        ctx.lineTo(rx + cornerRadius, ry + rh);
        ctx.arcTo(rx, ry + rh, rx, ry + rh - cornerRadius, cornerRadius);
        ctx.lineTo(rx, ry + cornerRadius);
        ctx.arcTo(rx, ry, rx + cornerRadius, ry, cornerRadius);
        ctx.closePath();

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
        const innerRadius = petalLength * 0.7;

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
     * 绘制多边形预览（正多边形，由拖拽包围盒推导）
     * @param {number} x - 起始X
     * @param {number} y - 起始Y
     * @param {number} width - 宽度
     * @param {number} height - 高度
     */
    drawPolygonPreview(x, y, width, height) {
        const bounds = {
            x: width >= 0 ? x : x + width,
            y: height >= 0 ? y : y + height,
            width: Math.abs(width),
            height: Math.abs(height)
        };
        const verts = this._computePolygonVerts(bounds, this.polygonSides);
        const ctx = this.ctx;
        if (verts.length === 0) return;
        ctx.beginPath();
        ctx.moveTo(verts[0].x, verts[0].y);
        for (let i = 1; i < verts.length; i++) {
            ctx.lineTo(verts[i].x, verts[i].y);
        }
        ctx.closePath();

        ctx.font = '14px Arial';
        ctx.fillStyle = '#6366f1';
        const label = `${this.polygonSides} 边形`;
        ctx.fillText(label, bounds.x + bounds.width / 2 - 20, bounds.y - 10);
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
            case 'polygon':
                return this.isPointInPolygon(px, py, this.getPolygonAbsoluteVerts(this._getCurrentBounds()));
            default:
                return false;
        }
    }

    /**
     * 判断点是否在圆角矩形内
     */
    isPointInRectangle(px, py, x, y, width, height) {
        const rx = width >= 0 ? x : x + width;
        const ry = height >= 0 ? y : y + height;
        const rw = Math.abs(width);
        const rh = Math.abs(height);

        if (rw === 0 || rh === 0) return false;

        const cornerRadius = Math.min(rw, rh) * 0.15;

        if (px < rx || px > rx + rw || py < ry || py > ry + rh) {
            return false;
        }

        if (px >= rx + cornerRadius && px <= rx + rw - cornerRadius) {
            return true;
        }
        if (py >= ry + cornerRadius && py <= ry + rh - cornerRadius) {
            return true;
        }

        const corners = [
            { cx: rx + cornerRadius, cy: ry + cornerRadius },
            { cx: rx + rw - cornerRadius, cy: ry + cornerRadius },
            { cx: rx + cornerRadius, cy: ry + rh - cornerRadius },
            { cx: rx + rw - cornerRadius, cy: ry + rh - cornerRadius }
        ];

        for (const corner of corners) {
            const dx = px - corner.cx;
            const dy = py - corner.cy;
            if (dx * dx + dy * dy <= cornerRadius * cornerRadius) {
                return true;
            }
        }

        return false;
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
        const innerRadius = petalLength * 0.75;

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
        let angle = Math.atan2(dx, -dy); // 它用于计算从原点到点(x, y)的线与y轴正半轴之间顺时针的角度
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
        const angNorm = t * Math.PI/2;
        const ratio = Math.sin(angNorm);

        // maxRadius: 该角度下星形边界允许的最大半径
        // 在尖角中线方向（t=0），半径最大 = outerRadius
        // 在内角边方向（t=1），半径最小 = innerRadius
        // 中间角度时，半径线性插值，这个插值方法插出来是个弧形，应该改为直线
        const maxRadius = innerRadius + (outerRadius - innerRadius) * (1 - ratio);

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

    /**
     * 设置多边形边数（3-12）
     * @param {number} sides - 边数
     */
    setPolygonSides(sides) {
        this.polygonSides = Math.max(3, Math.min(12, parseInt(sides) || 6));
    }

    /**
     * 获取当前绘制边界：绘制中取实时拖拽框，否则取已完成边界
     * @returns {Object|null}
     */
    _getCurrentBounds() {
        return this.isDrawing ? this.getSelectionBounds() : this.lastBounds;
    }

    /**
     * 根据包围盒与边数计算正多边形绝对顶点
     * @param {Object} bounds - 包围盒 {x, y, width, height}
     * @param {number} sides - 边数
     * @returns {Array<{x:number, y:number}>}
     */
    _computePolygonVerts(bounds, sides) {
        const cx = bounds.x + bounds.width / 2;
        const cy = bounds.y + bounds.height / 2;
        const radius = Math.min(bounds.width, bounds.height) / 2;
        const verts = [];
        for (let i = 0; i < sides; i++) {
            const angle = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
            verts.push({
                x: cx + radius * Math.cos(angle),
                y: cy + radius * Math.sin(angle)
            });
        }
        return verts;
    }

    /**
     * 根据包围盒计算正多边形的归一化顶点（0..1，相对包围盒）
     * @param {Object} bounds - 包围盒
     * @returns {Array<{nx:number, ny:number}>}
     */
    _computePolygonNormVerts(bounds) {
        const verts = this._computePolygonVerts(bounds, this.polygonSides);
        return verts.map(v => ({
            nx: (v.x - bounds.x) / bounds.width,
            ny: (v.y - bounds.y) / bounds.height
        }));
    }

    /**
     * 由归一化顶点与给定包围盒计算绝对顶点
     * @param {Object} bounds - 包围盒
     * @returns {Array<{x:number, y:number}>}
     */
    getPolygonAbsoluteVerts(bounds) {
        if (!this.polygonNormVerts || !bounds) return [];
        return this.polygonNormVerts.map(v => ({
            x: bounds.x + v.nx * bounds.width,
            y: bounds.y + v.ny * bounds.height
        }));
    }

    /**
     * 射线法判断点是否在多边形内
     * @param {number} px - 点X坐标
     * @param {number} py - 点Y坐标
     * @param {Array<{x:number, y:number}>} verts - 多边形绝对顶点
     * @returns {boolean}
     */
    isPointInPolygon(px, py, verts) {
        let inside = false;
        for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
            const xi = verts[i].x, yi = verts[i].y;
            const xj = verts[j].x, yj = verts[j].y;
            const intersect = ((yi > py) !== (yj > py)) &&
                (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    /**
     * 命中测试多边形顶点，返回顶点索引，未命中返回 -1
     * @param {number} mx - 鼠标X坐标
     * @param {number} my - 鼠标Y坐标
     * @returns {number}
     */
    hitTestVertex(mx, my) {
        if (!this.polygonNormVerts) return -1;
        const bounds = this.transformManager.getSelectionBounds();
        if (!bounds) return -1;
        const verts = this.getPolygonAbsoluteVerts(bounds);
        const hitRadius = 12;
        for (let i = 0; i < verts.length; i++) {
            const dx = mx - verts[i].x;
            const dy = my - verts[i].y;
            if (dx * dx + dy * dy <= hitRadius * hitRadius) return i;
        }
        return -1;
    }

    /**
     * 开始拖拽指定多边形顶点
     * @param {number} index - 顶点索引
     */
    startVertexDrag(index) {
        this.draggingVertex = index;
    }

    /**
     * 更新被拖拽顶点位置（写入归一化坐标）
     * @param {number} mx - 鼠标X坐标
     * @param {number} my - 鼠标Y坐标
     */
    updateVertexDrag(mx, my) {
        if (this.draggingVertex < 0 || !this.polygonNormVerts) return;
        const bounds = this.transformManager.getSelectionBounds();
        if (!bounds) return;
        const nx = (mx - bounds.x) / bounds.width;
        const ny = (my - bounds.y) / bounds.height;
        this.polygonNormVerts[this.draggingVertex] = {
            nx: Math.max(0, Math.min(1, nx)),
            ny: Math.max(0, Math.min(1, ny))
        };
    }

    /**
     * 结束顶点拖拽
     */
    endVertexDrag() {
        this.draggingVertex = -1;
    }

    /**
     * 是否正在拖拽顶点
     * @returns {boolean}
     */
    isVertexDragging() {
        return this.draggingVertex >= 0;
    }

    /**
     * 多边形是否处于已绘制（激活）状态
     * @returns {boolean}
     */
    isPolygonActive() {
        return this.shapeType === 'polygon' && this.polygonNormVerts !== null;
    }

    /**
     * 绘制当前选区：多边形绘制轮廓与可拖拽顶点，其它形状沿用变换管理器
     */
    drawSelection() {
        if (this.isPolygonActive()) {
            this.drawPolygonOverlay(this.transformManager.getSelectionBounds());
        } else {
            this.transformManager.draw();
        }
    }

    /**
     * 在覆盖层绘制多边形轮廓与顶点控制点
     * @param {Object} bounds - 包围盒
     */
    drawPolygonOverlay(bounds) {
        canvasUtils.clearCanvas(this.overlayCanvas);
        if (!bounds) return;
        const verts = this.getPolygonAbsoluteVerts(bounds);
        if (verts.length === 0) return;

        const ctx = this.ctx;
        ctx.fillStyle = 'rgba(99, 102, 241, 0.2)';
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.moveTo(verts[0].x, verts[0].y);
        for (let i = 1; i < verts.length; i++) {
            ctx.lineTo(verts[i].x, verts[i].y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 顶点控制点
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#6366f1';
        for (const v of verts) {
            ctx.beginPath();
            ctx.arc(v.x, v.y, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }
}
