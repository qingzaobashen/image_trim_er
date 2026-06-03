/**
 * 图像处理核心模块
 * 管理图像处理的主要流程和状态
 */

import * as canvasUtils from './utils/canvasUtils.js';
import { SmartCutTool } from './tools/smartCut.js';
import { ShapeCutTool } from './tools/shapeCut.js';
import { MagicWandTool } from './tools/magicWand.js';
import { BrushTool, EraserTool } from './tools/brush.js';
import { RegionSelector } from './tools/regionSelector.js';
import { SelectionHistory } from './utils/selectionHistory.js';
import { EdgeSmoother } from './tools/edgeSmoother.js';
import { ShadowProcessor } from './tools/shadowProcessor.js';

/**
 * 图像处理器类
 */
export class ImageProcessor {
    /**
     * 构造函数
     * @param {HTMLCanvasElement} mainCanvas - 主Canvas
     * @param {HTMLCanvasElement} overlayCanvas - 覆盖层Canvas
     */
    constructor(mainCanvas, overlayCanvas) {
        this.mainCanvas = mainCanvas;
        this.overlayCanvas = overlayCanvas;
        this.originalImage = null;
        this.currentMask = null;
        this.originImgBackup = null;
        this.history = [];
        this.historyIndex = -1;
        this.maxHistory = 50;

        this.shadowMask = null;
        this.edgeData = null;
        this.isShadowBrushActive = false;

        this.selectionHistory = new SelectionHistory();
        this.smartCutTool = new SmartCutTool(mainCanvas, overlayCanvas);
        this.shapeCutTool = new ShapeCutTool(mainCanvas, overlayCanvas);
        this.magicWandTool = new MagicWandTool(mainCanvas, overlayCanvas);
        this.brushTool = new BrushTool(overlayCanvas);
        this.eraserTool = new EraserTool(overlayCanvas);
        this.regionSelector = new RegionSelector(overlayCanvas, mainCanvas);
        this.edgeSmoother = new EdgeSmoother(mainCanvas);
        this.shadowProcessor = new ShadowProcessor(mainCanvas);
    }

    /**
     * 加载图片
     * @param {File} file - 图片文件
     * @returns {Promise<Object>} 图片信息
     */
    async loadImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (e) => {
                const img = new Image();
                
                img.onload = () => {
                    this.originalImage = img;
                    
                    canvasUtils.setCanvasSize(this.mainCanvas, img.width, img.height);
                    canvasUtils.setCanvasSize(this.overlayCanvas, img.width, img.height);
                    
                    canvasUtils.drawImage(this.mainCanvas, img);
                    canvasUtils.clearCanvas(this.overlayCanvas);
                    
                    this.currentMask = new Uint8ClampedArray(img.width * img.height);
                    this.shadowMask = new Uint8ClampedArray(img.width * img.height);
                    this.edgeData = null;
                    this.isShadowBrushActive = false;
                    this.history = [];
                    this.historyIndex = -1;
                    
                    this.saveToHistory();
                    
                    const imageData = canvasUtils.getImageData(this.mainCanvas);
                            
                    this.originImgBackup = new Uint8ClampedArray(img.width * img.height * 4);
                    this.originImgBackup.set(imageData.data); //将整个原始图形数据记录下来，以备回退和恢复的需求
                    
                    resolve({
                        width: img.width,
                        height: img.height,
                        size: file.size,
                        type: file.type
                    });
                };
                
                img.onerror = () => reject(new Error('图片加载失败'));
                img.src = e.target.result;
            };
            
            reader.onerror = () => reject(new Error('文件读取失败'));
            reader.readAsDataURL(file);
        });
    }

    /**
     * 应用智能抠图
     * @param {number} smoothness - 平滑度
     * @returns {Promise<void>}
     */
    async applySmartCut(smoothness = 50) {
        this.smartCutTool.setSmoothness(smoothness);
        
        try {
            this.currentMask = await this.smartCutTool.apply();
            this.renderSelection();
            this.saveToHistory();
        } catch (error) {
            console.error('智能抠图失败:', error);
            throw error;
        }
    }

    /**
     * 应用基于颜色的抠图
     * @param {number} tolerance - 容差值（已废弃，现在使用SmartCutTool的颜色模式）
     */
    async applyColorBasedCut(tolerance = 30) {
        this.smartCutTool.setMode('color');
        this.currentMask = await this.smartCutTool.apply();
        this.renderSelection();
        this.saveToHistory();
    }

    /**
     * 设置形状抠图类型
     * @param {string} shapeType - 形状类型
     */
    setShapeType(shapeType) {
        this.shapeCutTool.setShapeType(shapeType);
    }

    /**
     * 开始形状抠图绘制
     * @param {number} x - 起始X坐标
     * @param {number} y - 起始Y坐标
     */
    startShapeDrawing(x, y) {
        this.shapeCutTool.startDrawing(x, y);
    }

    /**
     * 更新形状抠图绘制
     * @param {number} x - 当前X坐标
     * @param {number} y - 当前Y坐标
     */
    updateShapeDrawing(x, y) {
        this.shapeCutTool.updateDrawing(x, y);
    }

    /**
     * 完成形状抠图
     * @returns {boolean} 是否成功
     */
    finishShapeDrawing() {
        const result = this.shapeCutTool.finishDrawing();
        if (result && result.mask) {
            this.currentMask = result.mask;
            this.renderSelection();
            this.shapeCutTool.getTransformManager().draw();
            this.saveToHistory();
            return true;
        }
        return false;
    }

    /**
     * 取消形状抠图
     */
    cancelShapeDrawing() {
        this.shapeCutTool.cancelDrawing();
    }

    /**
     * 获取形状抠图变换管理器
     * @returns {SelectionTransformManager}
     */
    getShapeTransformManager() {
        return this.shapeCutTool.getTransformManager();
    }

    /**
     * 检查形状抠图是否有激活的选择框
     * @returns {boolean}
     */
    hasActiveShapeSelection() {
        return this.shapeCutTool.hasActiveSelection();
    }

    /**
     * 清除形状抠图选择框
     */
    clearShapeSelection() {
        this.shapeCutTool.clearSelection();
    }

    /**
     * 更新形状抠图蒙版（变换后）
     * @param {Object} newBounds - 新的边界
     * @returns {Uint8ClampedArray} 新的蒙版
     */
    updateShapeMaskFromBounds(newBounds) {
        const mask = this.shapeCutTool.updateMaskFromBounds(newBounds);
        if (mask) {
            this.currentMask = mask;
            this.renderSelection();
            this.shapeCutTool.getTransformManager().draw();
        }
        return mask;
    }

    /**
     * 使用魔术棒选择
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @param {number} tolerance - 容差值
     * @param {boolean} contiguous - 是否连续
     * @param {boolean} addToExisting - 是否添加到现有选区
     */
    magicWandSelect(x, y, tolerance = 32, contiguous = true, addToExisting = false) {
        this.magicWandTool.setTolerance(tolerance);
        this.magicWandTool.setContiguous(contiguous);
        
        const newMask = this.magicWandTool.select(x, y);
        
        if (addToExisting && this.currentMask) {
            for (let i = 0; i < this.currentMask.length; i++) {
                if (newMask[i] > 0) {
                    this.currentMask[i] = 255;
                }
            }
        } else {
            this.currentMask = newMask;
        }
        
        this.selectionHistory.addSelection(
            newMask,
            'magicWand',
            { x, y, tolerance, contiguous }
        );
        
        this.renderSelection();
        this.saveToHistory();
    }

    /**
     * 添加到选区
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     */
    addToSelection(x, y) {
        const newMask = this.magicWandTool.addToSelection(x, y, this.currentMask);
        
        this.selectionHistory.addSelection(
            newMask,
            'add',
            { x, y }
        );
        
        this.currentMask = newMask;
        this.renderSelection();
        this.saveToHistory();
    }

    /**
     * 从选区减去
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     */
    subtractFromSelection(x, y) {
        const newMask = this.magicWandTool.subtractFromSelection(x, y, this.currentMask);
        
        this.selectionHistory.addSelection(
            newMask,
            'subtract',
            { x, y }
        );
        
        this.currentMask = newMask;
        this.renderSelection();
        this.saveToHistory();
    }

    /**
     * 开始画笔绘制
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @param {number} size - 画笔大小（屏幕像素）
     * @param {number} hardness - 画笔硬度
     * @param {string} mode - 模式
     * @param {number} scale - 当前缩放比例
     */
    startBrushDrawing(x, y, size = 20, hardness = 50, mode = 'add', scale = 1) {
        const canvasSize = size / scale;
        this.brushTool.setSize(canvasSize);
        this.brushTool.setHardness(hardness);
        this.brushTool.setMode(mode);
        this.brushTool.startDrawing(x, y);
    }

    /**
     * 画笔绘制
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @param {number} scale - 当前缩放比例
     */
    brushDraw(x, y, scale = 1) {
        this.brushTool.draw(x, y);
    }

    /**
     * 停止画笔绘制
     */
    stopBrushDrawing() {
        this.brushTool.stopDrawing();
        const brushMask = this.brushTool.getBrushMask();
        
        this.selectionHistory.addSelection(
            brushMask,
            this.brushTool.mode === 'add' ? 'brush' : 'subtract',
            { size: this.brushTool.size, hardness: this.brushTool.hardness }
        );
        
        this.currentMask = this.brushTool.applyToMask(this.currentMask, brushMask);
        this.brushTool.clear();
        this.renderSelection();
        this.saveToHistory();
    }

    /**
     * 撤销最后一次选择（右键功能）
     * @returns {boolean} 是否成功撤销
     */
    undoLastSelection() {
        if (!this.selectionHistory.canUndo()) {
            return false;
        }

        const previousMask = this.selectionHistory.undoLastSelection();
        
        if (previousMask) {
            this.currentMask = previousMask;
            this.renderSelection();
            this.saveToHistory();
            return true;
        }
        
        return false;
    }

    /**
     * 确认删除选区（中键功能）
     * @returns {Promise<boolean>} 是否成功删除
     */
    async confirmDeleteSelection() {
        if (!this.currentMask || this.currentMask.every(v => v === 0)) {
            return false;
        }

        await this.animateDeletion();

        this.deleteSelection();
        
        this.selectionHistory.clear();
        
        return true;
    }

    /**
     * 删除选区动画
     * @returns {Promise<void>}
     */
    async animateDeletion() {
        return new Promise((resolve) => {
            const ctx = canvasUtils.getContext(this.overlayCanvas);
            const originalAlpha = ctx.globalAlpha;
            
            let flashCount = 0;
            const maxFlashes = 3;
            const flashInterval = setInterval(() => {
                ctx.globalAlpha = flashCount % 2 === 0 ? 0.8 : 0.3;
                ctx.fillStyle = 'rgba(239, 68, 68, 0.5)';
                ctx.fillRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
                
                flashCount++;
                if (flashCount >= maxFlashes * 2) {
                    clearInterval(flashInterval);
                    ctx.globalAlpha = originalAlpha;
                    canvasUtils.clearCanvas(this.overlayCanvas);
                    resolve();
                }
            }, 100);
        });
    }

    /**
     * 清除选区
     */
    clearSelection() {
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        this.currentMask = new Uint8ClampedArray(width * height);
        this.shadowMask = new Uint8ClampedArray(width * height);
        this.edgeData = null;
        this.isShadowBrushActive = false;
        this.selectionHistory.clear();
        canvasUtils.clearCanvas(this.overlayCanvas);
        this.saveToHistory();
    }

    /**
     * 反选
     */
    invertSelection() {
        for (let i = 0; i < this.currentMask.length; i++) {
            this.currentMask[i] = this.currentMask[i] > 0 ? 0 : 255;
        }
        this.renderSelection();
        this.saveToHistory();
    }

    /**
     * 删除选中区域
     */
    deleteSelection() {
        if (!this.currentMask || this.currentMask.every(v => v === 0)) {
            return;
        }

        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        const imageData = canvasUtils.getImageData(this.mainCanvas);
        for (let i = 0; i < this.currentMask.length; i++) {
            if (this.currentMask[i] > 0) {
                const index = i * 4;
                imageData.data[index + 3] = 1;   // 仅将选中区域的alpha通道设为0，实现透明效果，但canvas会自动将该区域的像素设为0
            }
        }

        canvasUtils.putImageData(this.mainCanvas, imageData);
        canvasUtils.clearCanvas(this.overlayCanvas);
        this.currentMask = new Uint8ClampedArray(width * height);
        this.saveToHistory();
    }

    /**
     * 去除小区域（噪点）
     * @param {number} minArea - 最小区域阈值（像素数）
     * @returns {{removedRegions: number, removedPixels: number}} 处理统计信息
     */
    removeSmallRegions(minArea = 100) {
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        const imageData = canvasUtils.getImageData(this.mainCanvas);
        
        let removedOpaqueRegions = 0;   // 移除的不透明区域（透明噪点）
        let removedOpaquePixels = 0;
        let removedTransparentRegions = 0;  // 移除的透明区域（不透明噪点）
        let removedTransparentPixels = 0;
        
        // 第一步：移除小的不透明噪点，即不透明像素数量小于minArea的联通区域
        const visitedOpaque = new Uint8ClampedArray(width * height);
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                
                if (visitedOpaque[idx]) continue;
                
                const alphaIdx = idx * 4 + 3;
                if (imageData.data[alphaIdx] > 128) {
                    const regionPixels = [];
                    const queue = [[x, y]];
                    visitedOpaque[idx] = 1;
                    
                    while (queue.length > 0) {
                        const [cx, cy] = queue.shift();
                        const cidx = cy * width + cx;
                        regionPixels.push(cidx);
                        
                        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                            const nx = cx + dx;
                            const ny = cy + dy;
                            
                            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                                const nidx = ny * width + nx;
                                
                                if (!visitedOpaque[nidx] && imageData.data[nidx * 4 + 3] > 128) {
                                    visitedOpaque[nidx] = 1;
                                    queue.push([nx, ny]);
                                }
                            }
                        }
                    }
                    
                    // 移除小的不透明区域，即不透明像素数量小于minArea的联通区域，即不透明噪点
                    if (regionPixels.length < minArea) {
                        removedOpaqueRegions++;
                        removedOpaquePixels += regionPixels.length;
                        
                        for (const pixelIdx of regionPixels) {
                            imageData.data[pixelIdx * 4 + 3] = 0;  // 将其变为透明
                        }
                    }
                }
            }
        }
        
        // 第二步：移除小的透明区域，即透明像素数量小于minArea的联通区域
        const visitedTransparent = new Uint8ClampedArray(width * height);
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                
                if (visitedTransparent[idx]) continue;
                
                const alphaIdx = idx * 4 + 3;
                if (imageData.data[alphaIdx] <= 128) {
                    const regionPixels = [];
                    const queue = [[x, y]];
                    visitedTransparent[idx] = 1;
                    
                    while (queue.length > 0) {
                        const [cx, cy] = queue.shift();
                        const cidx = cy * width + cx;
                        regionPixels.push(cidx);
                        
                        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                            const nx = cx + dx;
                            const ny = cy + dy;
                            
                            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                                const nidx = ny * width + nx;
                                
                                if (!visitedTransparent[nidx] && imageData.data[nidx * 4 + 3] <= 128) {
                                    visitedTransparent[nidx] = 1;
                                    queue.push([nx, ny]);
                                }
                            }
                        }
                    }
                    
                    // 移除小的透明区域，即透明像素数量小于minArea的联通区域
                    if (regionPixels.length < minArea) {
                        removedTransparentRegions++;
                        removedTransparentPixels += regionPixels.length;
                        
                        for (const pixelIdx of regionPixels) {
                            if (this.originImgBackup && this.originImgBackup[pixelIdx * 4] !== undefined) {
                                imageData.data[pixelIdx * 4] = this.originImgBackup[pixelIdx * 4];
                                imageData.data[pixelIdx * 4 + 1] = this.originImgBackup[pixelIdx * 4 + 1];
                                imageData.data[pixelIdx * 4 + 2] = this.originImgBackup[pixelIdx * 4 + 2];
                            }
                            imageData.data[pixelIdx * 4 + 3] = 255;  // 将其变为不透明
                        }
                    }
                }
            }
        }

        canvasUtils.putImageData(this.mainCanvas, imageData);
        this.saveToHistory();

        return {
            removedRegions: removedOpaqueRegions + removedTransparentRegions,
            removedPixels: removedOpaquePixels + removedTransparentPixels,
            removedOpaqueRegions,
            removedOpaquePixels,
            removedTransparentRegions,
            removedTransparentPixels
        };
    }

    /**
     * 去除指定区域的小区域（噪点）
     * @param {number} minArea - 最小区域阈值（像素数）
     * @param {Object} region - 区域 {x, y, width, height}
     * @returns {{removedRegions: number, removedPixels: number}} 处理统计信息
     */
    removeSmallRegionsInArea(minArea = 100, region = null) {
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        const imageData = canvasUtils.getImageData(this.mainCanvas);
        
        let removedOpaqueRegions = 0;
        let removedOpaquePixels = 0;
        let removedTransparentRegions = 0;
        let removedTransparentPixels = 0;
        
        const minX = region ? region.x : 0;
        const minY = region ? region.y : 0;
        const maxX = region ? region.x + region.width : width;
        const maxY = region ? region.y + region.height : height;
        
        // 第一步：找出小的不透明区域，即不透明像素数量小于minArea的联通区域
        const visitedOpaque = new Uint8ClampedArray(width * height);
        
        for (let y = minY; y < maxY; y++) {
            for (let x = minX; x < maxX; x++) {
                const idx = y * width + x;
                
                if (visitedOpaque[idx]) continue;
                
                const alphaIdx = idx * 4 + 3;
                if (imageData.data[alphaIdx] > 128) {
                    const regionPixels = [];
                    const queue = [[x, y]];
                    visitedOpaque[idx] = 1;
                    
                    while (queue.length > 0) {
                        const [cx, cy] = queue.shift();
                        const cidx = cy * width + cx;
                        regionPixels.push(cidx);
                        
                        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                            const nx = cx + dx;
                            const ny = cy + dy;
                            
                            if (nx >= minX && nx < maxX && ny >= minY && ny < maxY) {
                                const nidx = ny * width + nx;
                                
                                if (!visitedOpaque[nidx] && imageData.data[nidx * 4 + 3] > 128) {
                                    visitedOpaque[nidx] = 1;
                                    queue.push([nx, ny]);
                                }
                            }
                        }
                    }
                    
                    // 移除小的不透明噪点，即不透明像素数量小于minArea的联通区域
                    if (regionPixels.length < minArea) {
                        removedOpaqueRegions++;
                        removedOpaquePixels += regionPixels.length;
                        
                        for (const pixelIdx of regionPixels) {
                            imageData.data[pixelIdx * 4 + 3] = 0;  // 将其变为透明
                        }
                    }
                }
            }
        }
        
        // 第二步：找出小的透明区域，即透明像素数量小于minArea的联通区域
        const visitedTransparent = new Uint8ClampedArray(width * height);
        
        for (let y = minY; y < maxY; y++) {
            for (let x = minX; x < maxX; x++) {
                const idx = y * width + x;
                
                if (visitedTransparent[idx]) continue;
                
                const alphaIdx = idx * 4 + 3;
                if (imageData.data[alphaIdx] <= 128) {
                    const regionPixels = [];
                    const queue = [[x, y]];
                    visitedTransparent[idx] = 1;
                    
                    while (queue.length > 0) {
                        const [cx, cy] = queue.shift();
                        const cidx = cy * width + cx;
                        regionPixels.push(cidx);
                        
                        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                            const nx = cx + dx;
                            const ny = cy + dy;
                            
                            if (nx >= minX && nx < maxX && ny >= minY && ny < maxY) {
                                const nidx = ny * width + nx;
                                
                                if (!visitedTransparent[nidx] && imageData.data[nidx * 4 + 3] <= 128) {
                                    visitedTransparent[nidx] = 1;
                                    queue.push([nx, ny]);
                                }
                            }
                        }
                    }
                    
                    // 移除小的透明区域，即透明像素数量小于minArea的联通区域
                    if (regionPixels.length < minArea) {
                        removedTransparentRegions++;
                        removedTransparentPixels += regionPixels.length;

                        for (const pixelIdx of regionPixels) {
                            if (this.originImgBackup && this.originImgBackup[pixelIdx * 4] !== undefined) {
                                imageData.data[pixelIdx * 4] = this.originImgBackup[pixelIdx * 4];
                                imageData.data[pixelIdx * 4 + 1] = this.originImgBackup[pixelIdx * 4 + 1];
                                imageData.data[pixelIdx * 4 + 2] = this.originImgBackup[pixelIdx * 4 + 2];
                            }
                            imageData.data[pixelIdx * 4 + 3] = 255;  // 将其变为不透明
                        }
                    }
                }
            }
        }

        canvasUtils.putImageData(this.mainCanvas, imageData);
        this.saveToHistory();

        return {
            removedRegions: removedOpaqueRegions + removedTransparentRegions,
            removedPixels: removedOpaquePixels + removedTransparentPixels,
            removedOpaqueRegions,
            removedOpaquePixels,
            removedTransparentRegions,
            removedTransparentPixels
        };
    }

    /**
     * 去除选区中的小区域（噪点）
     * @param {number} minArea - 最小区域阈值（像素数）
     * @returns {{removedRegions: number, removedPixels: number}} 处理统计信息
     */
    removeSmallRegionsFromSelection(minArea = 100) {
        if (!this.currentMask || this.currentMask.every(v => v === 0)) {
            return {
                removedRegions: 0,
                removedPixels: 0,
                totalRegions: 0
            };
        }

        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        
        // 统计两种噪点
        let removedSelectedRegions = 0;    // 已选区域中的未选噪点（深色）
        let removedSelectedPixels = 0;
        let removedUnselectedRegions = 0;  // 未选区域中的已选噪点（白色）
        let removedUnselectedPixels = 0;
        
        // 第一步：处理已选区域（currentMask > 0）中的小未选区域
        const visitedSelected = new Uint8ClampedArray(width * height);
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                
                if (visitedSelected[idx]) continue;
                
                if (this.currentMask[idx] > 0) {
                    const regionPixels = [];
                    const queue = [[x, y]];
                    visitedSelected[idx] = 1;
                    
                    while (queue.length > 0) {
                        const [cx, cy] = queue.shift();
                        const cidx = cy * width + cx;
                        regionPixels.push(cidx);
                        
                        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                            const nx = cx + dx;
                            const ny = cy + dy;
                            
                            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                                const nidx = ny * width + nx;
                                
                                if (!visitedSelected[nidx] && this.currentMask[nidx] > 0) {
                                    visitedSelected[nidx] = 1;
                                    queue.push([nx, ny]);
                                }
                            }
                        }
                    }
                    
                    // 移除小的已选区域（深色噪点）
                    if (regionPixels.length < minArea) {
                        removedSelectedRegions++;
                        removedSelectedPixels += regionPixels.length;
                        
                        for (const pixelIdx of regionPixels) {
                            this.currentMask[pixelIdx] = 0;
                        }
                    }
                }
            }
        }
        
        // 第二步：处理未选区域（currentMask === 0）中的小已选区域（白色噪点）
        const visitedUnselected = new Uint8ClampedArray(width * height);
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                
                if (visitedUnselected[idx]) continue;
                
                if (this.currentMask[idx] === 0) {
                    const regionPixels = [];
                    const queue = [[x, y]];
                    visitedUnselected[idx] = 1;
                    
                    while (queue.length > 0) {
                        const [cx, cy] = queue.shift();
                        const cidx = cy * width + cx;
                        regionPixels.push(cidx);
                        
                        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                            const nx = cx + dx;
                            const ny = cy + dy;
                            
                            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                                const nidx = ny * width + nx;
                                
                                if (!visitedUnselected[nidx] && this.currentMask[nidx] === 0) {
                                    visitedUnselected[nidx] = 1;
                                    queue.push([nx, ny]);
                                }
                            }
                        }
                    }
                    
                    // 移除小的未选区域（白色噪点）
                    if (regionPixels.length < minArea) {
                        removedUnselectedRegions++;
                        removedUnselectedPixels += regionPixels.length;
                        
                        for (const pixelIdx of regionPixels) {
                            this.currentMask[pixelIdx] = 255;
                        }
                    }
                }
            }
        }

        this.renderSelection();
        this.saveToHistory();

        return {
            removedRegions: removedSelectedRegions + removedUnselectedRegions,
            removedPixels: removedSelectedPixels + removedUnselectedPixels,
            removedSelectedRegions,
            removedSelectedPixels,
            removedUnselectedRegions,
            removedUnselectedPixels,
            totalRegions: removedSelectedRegions + removedUnselectedRegions
        };
    }

    /**
     * 边缘光滑处理
     * @param {number} strength - 光滑强度 (1-10)
     * @returns {boolean} 是否成功
     */
    smoothEdges(strength = 3) {
        const success = this.edgeSmoother.smooth(strength);
        if (success) {
            this.saveToHistory();
        }
        return success;
    }

    /**
     * 执行边缘检测
     * 使用Canny算法检测物体轮廓，结果存储到this.edgeData
     * 从原始图像数据检测，确保即使背景已被抠除也能正确检测边缘
     * @returns {boolean} 是否成功
     */
    detectEdges() {
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        let imageData;
        if (this.originImgBackup) {
            imageData = new ImageData(
                new Uint8ClampedArray(this.originImgBackup),
                width,
                height
            );
        } else {
            imageData = canvasUtils.getImageData(this.mainCanvas);
        }
        // 优先使用OpenCV版本，不可用时回退到手写版本
        //if (this.shadowProcessor.isOpenCVReady()) {
        //        this.edgeData = this.shadowProcessor.detectEdgesWithOpenCV(imageData, {
        //        lowThreshold: 5,
        //        highThreshold: 40,
        //        blurKernelSize: 3,
        //        blurSigma: 0
        //    });
        //} else {
        //    this.edgeData = this.shadowProcessor.detectEdges(imageData);
        //}
        this.edgeData = this.shadowProcessor.detectEdges(imageData);
        // this.edgeData = this.shadowProcessor.connectEdgeCurves(this.edgeData, width, height);
        this.renderSelection();
        return true;
    }

    /**
     * 执行阴影检测
     * 根据当前前景蒙版和边缘检测结果，识别物体边缘外的阴影区域
     * @param {Object} options - 阴影检测参数
     * @param {number} options.maxDistance - 最大阴影距离（像素）
     * @param {number} options.shadowDiff - 阴影差异度 0-100
     * @returns {boolean} 是否成功
     */
    detectShadows(options = {}) {
        if (!this.currentMask || this.currentMask.every(v => v === 0)) {
            console.warn('没有活跃的选区，无法检测阴影');
            return false;
        }

        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;

        let currentCanvasData = null;
        if (this.originImgBackup) {
            currentCanvasData = canvasUtils.getImageData(this.mainCanvas);
            const originalData = new ImageData(
                new Uint8ClampedArray(this.originImgBackup),
                width,
                height
            );
            canvasUtils.putImageData(this.mainCanvas, originalData);
        }

        if (!this.edgeData) {
            this.detectEdges();
        }

        const binaryMask = new Uint8ClampedArray(this.currentMask.length);
        for (let i = 0; i < this.currentMask.length; i++) {
            binaryMask[i] = this.currentMask[i] > 0 ? 255 : 0; // currentMask中选中的区域为255；
        }

        this.shadowMask = this.shadowProcessor.detectShadows(binaryMask, this.edgeData, options);

        if (currentCanvasData) {
            canvasUtils.putImageData(this.mainCanvas, currentCanvasData);
        }

        this.renderSelection();
        return true;
    }

    /**
     * 开始阴影画笔绘制
     * 清空overlay canvas以避免已有选区渲染干扰画笔蒙版识别
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @param {number} size - 画笔大小
     * @param {number} hardness - 画笔硬度
     * @param {string} mode - 模式 ('add' 添加阴影 / 'subtract' 取消阴影)
     * @param {number} scale - 当前缩放比例
     */
    startShadowBrush(x, y, size = 20, hardness = 50, mode = 'add', scale = 1) {
        this.isShadowBrushActive = true;
        const canvasSize = size / scale;
        this.brushTool.setSize(canvasSize);
        this.brushTool.setHardness(hardness);
        this.brushTool.setMode(mode);
        canvasUtils.clearCanvas(this.overlayCanvas);
        this.brushTool.startDrawing(x, y);
    }

    /**
     * 阴影画笔绘制
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @param {number} scale - 当前缩放比例
     */
    shadowBrushDraw(x, y, scale = 1) {
        this.brushTool.draw(x, y);
    }

    /**
     * 停止阴影画笔绘制
     * 将画笔结果应用到阴影蒙版，然后重新渲染选区
     */
    stopShadowBrush() {
        if (!this.isShadowBrushActive) return;

        this.brushTool.stopDrawing();
        const brushMask = this.brushTool.getBrushMask();

        if (!this.shadowMask) {
            const width = this.mainCanvas.width;
            const height = this.mainCanvas.height;
            this.shadowMask = new Uint8ClampedArray(width * height);
        }

        const currentMode = this.brushTool.mode;
        for (let i = 0; i < brushMask.length; i++) {
            if (currentMode === 'add' && brushMask[i] === 255) {
                this.shadowMask[i] = 255;
            } else if (currentMode === 'subtract' && brushMask[i] === 128) {
                this.shadowMask[i] = 0;
            }
        }

        this.brushTool.clear();
        this.isShadowBrushActive = false;
        this.renderSelection();
    }

    /**
     * 应用阴影处理
     * 紫色选区（前景）完全抠除，粉色选区（阴影）半透明抠除
     * @param {number} intensity - 阴影透明度 0-100
     * @returns {boolean} 是否成功
     */
    applyShadowProcess(intensity = 60) {
        if (!this.currentMask || this.currentMask.every(v => v === 0)) {
            console.warn('没有活跃的选区，无法应用阴影处理');
            return false;
        }

        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;

        if (this.originImgBackup) {
            const originalData = new ImageData(
                new Uint8ClampedArray(this.originImgBackup),
                width,
                height
            );
            canvasUtils.putImageData(this.mainCanvas, originalData);
        }

        const foregroundMask = new Uint8ClampedArray(this.currentMask.length);
        for (let i = 0; i < this.currentMask.length; i++) {
            foregroundMask[i] = this.currentMask[i] > 0 ? 255 : 0;
        }

        let shadowAlphaMask = new Uint8ClampedArray(width * height);

        if (this.shadowMask && !this.shadowMask.every(v => v === 0)) {
            shadowAlphaMask = this.shadowProcessor.calculateShadowAlpha(
                this.shadowMask,
                foregroundMask,
                intensity
            );
        }

        this.shadowProcessor.applyToCanvas(foregroundMask, shadowAlphaMask);

        this.currentMask = new Uint8ClampedArray(width * height);
        this.shadowMask = new Uint8ClampedArray(width * height);
        this.edgeData = null;
        this.isShadowBrushActive = false;

        canvasUtils.clearCanvas(this.overlayCanvas);
        this.saveToHistory();
        return true;
    }
    
    testRenderSelection(data,overlayCanvas) {
        canvasUtils.clearCanvas(overlayCanvas);
        const ctx = canvasUtils.getContext(overlayCanvas);
        const imageData = ctx.createImageData(overlayCanvas.width, overlayCanvas.height);
        if (data) {
            for (let i = 0; i < data.length; i++) {
                if (data[i] > 0) {
                    const index = i * 4;
                    imageData.data[index] = 0;
                    imageData.data[index + 1] = 200;
                    imageData.data[index + 2] = 255;
                    imageData.data[index + 3] = 200;
                }
            }
        }

        ctx.putImageData(imageData, 0, 0);
    }

    /**
     * 渲染选区
     * 紫色(99,102,241) = 前景抠除选区
     * 粉色(236,72,153) = 阴影选区
     * 青色细线(0,200,255) = 边缘检测轮廓
     */
    renderSelection() {
        canvasUtils.clearCanvas(this.overlayCanvas);
        const ctx = canvasUtils.getContext(this.overlayCanvas);
        const imageData = ctx.createImageData(this.overlayCanvas.width, this.overlayCanvas.height);

        for (let i = 0; i < this.currentMask.length; i++) {
            if (this.currentMask[i] > 0) {
                const index = i * 4;
                imageData.data[index] = 99;
                imageData.data[index + 1] = 102;
                imageData.data[index + 2] = 241;
                imageData.data[index + 3] = 128;
            }
        }

        if (this.shadowMask) {
            for (let i = 0; i < this.shadowMask.length; i++) {
                if (this.shadowMask[i] > 0 && this.currentMask[i] === 0) {
                    const index = i * 4;
                    imageData.data[index] = 236;
                    imageData.data[index + 1] = 72;
                    imageData.data[index + 2] = 153;
                    imageData.data[index + 3] = 128;
                }
            }
        }

        if (this.edgeData) {
            for (let i = 0; i < this.edgeData.length; i++) {
                if (this.edgeData[i] > 0 && this.currentMask[i] === 0 && (!this.shadowMask || this.shadowMask[i] === 0)) {
                    const index = i * 4;
                    imageData.data[index] = 0;
                    imageData.data[index + 1] = 200;
                    imageData.data[index + 2] = 255;
                    imageData.data[index + 3] = 200;
                }
            }
        }

        ctx.putImageData(imageData, 0, 0);
    }

    /**
     * 保存到历史记录
     */
    saveToHistory() {
        const state = {
            imageData: canvasUtils.getImageData(this.mainCanvas),
            mask: new Uint8ClampedArray(this.currentMask)
        };

        if (this.historyIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.historyIndex + 1);
        }

        this.history.push(state);

        if (this.history.length > this.maxHistory) {
            this.history.shift();
        } else {
            this.historyIndex++;
        }
    }

    /**
     * 撤销
     * @returns {boolean} 是否成功
     */
    undo() {
        if (this.historyIndex <= 0) return false;

        this.historyIndex--;
        const state = this.history[this.historyIndex];
        
        canvasUtils.putImageData(this.mainCanvas, state.imageData);
        this.currentMask = new Uint8ClampedArray(state.mask);
        this.renderSelection();

        return true;
    }

    /**
     * 重做
     * @returns {boolean} 是否成功
     */
    redo() {
        if (this.historyIndex >= this.history.length - 1) return false;

        this.historyIndex++;
        const state = this.history[this.historyIndex];
        
        canvasUtils.putImageData(this.mainCanvas, state.imageData);
        this.currentMask = new Uint8ClampedArray(state.mask);
        this.renderSelection();

        return true;
    }

    /**
     * 是否可以撤销
     * @returns {boolean}
     */
    canUndo() {
        return this.historyIndex > 0;
    }

    /**
     * 是否可以重做
     * @returns {boolean}
     */
    canRedo() {
        return this.historyIndex < this.history.length - 1;
    }

    /**
     * 导出图片
     * @param {string} type - 图片类型
     * @param {number} quality - 图片质量
     * @returns {string} DataURL
     */
    exportImage(type = 'image/png', quality = 1) {
        return canvasUtils.canvasToDataURL(this.mainCanvas, type, quality);
    }

    /**
     * 下载图片
     * @param {string} filename - 文件名
     */
    downloadImage(filename = 'processed-image.png') {
        const dataURL = this.exportImage();
        const link = document.createElement('a');
        link.download = filename;
        link.href = dataURL;
        link.click();
    }

    /**
     * 重置到原始图片
     */
    reset() {
        if (!this.originalImage) return;

        canvasUtils.drawImage(this.mainCanvas, this.originalImage);
        canvasUtils.clearCanvas(this.overlayCanvas);
        
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        this.currentMask = new Uint8ClampedArray(width * height);
        this.shadowMask = new Uint8ClampedArray(width * height);
        this.edgeData = null;
        this.isShadowBrushActive = false;
        
        this.saveToHistory();
    }
}
