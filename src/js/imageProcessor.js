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
import { EdgeSmoother } from './tools/edgeSmoother.js';
import { ShadowProcessor } from './tools/shadowProcessor.js';
import { EdgeBrushTool } from './tools/edgeBrush.js';
import { UndoRedoManager } from './utils/undoRedoManager.js';

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

        // 统一撤销/重做管理器（最多50步完整状态快照）
        this.undoRedoManager = new UndoRedoManager(50);

        this.shadowMask = null;
        this.edgeData = null;
        this.isShadowBrushActive = false;
        this.isEdgeBrushActive = false;

        this.smartCutTool = new SmartCutTool(mainCanvas, overlayCanvas);
        this.shapeCutTool = new ShapeCutTool(mainCanvas, overlayCanvas);
        this.magicWandTool = new MagicWandTool(mainCanvas, overlayCanvas);
        this.brushTool = new BrushTool(overlayCanvas);
        this.eraserTool = new EraserTool(overlayCanvas);
        this.regionSelector = new RegionSelector(overlayCanvas, mainCanvas);
        this.edgeSmoother = new EdgeSmoother(mainCanvas);
        this.shadowProcessor = new ShadowProcessor(mainCanvas);
        this.edgeBrush = new EdgeBrushTool(mainCanvas, overlayCanvas);
    }

    /**
     * 初始化 AI 模型（延迟加载）
     * @param {Function} onProgress - 进度回调
     * @param {Function} onStateChange - 状态变更回调
     * @returns {Promise<boolean>} 是否初始化成功
     */
    async initAIModel(onProgress, onStateChange) {
        return await this.smartCutTool.initAIModel(onProgress, onStateChange);
    }

    /**
     * 切换 AI 模型
     * @param {string} modelKey - 目标模型键，格式为 "模型ID:精度"
     * @returns {Promise<boolean>} 是否切换成功
     */
    async switchAIModel(modelKey) {
        return await this.smartCutTool.switchAIModel(modelKey);
    }

    /**
     * 检查 AI 模型是否已就绪
     * @returns {boolean} 是否已就绪
     */
    isAIModelReady() {
        return this.smartCutTool.isAIModelReady();
    }

    /**
     * 获取当前 AI 模型名称
     * @returns {string|null} 当前模型名称
     */
    getCurrentAIModel() {
        return this.smartCutTool.getCurrentAIModel();
    }

    /**
     * 获取当前 AI 模型精度类型
     * @returns {string|null} 当前精度类型
     */
    getCurrentAIDtype() {
        return this.smartCutTool.getCurrentAIDtype();
    }

    /**
     * 取消模型加载
     */
    cancelModelLoading() {
        this.smartCutTool.cancelModelLoading();
    }

    /**
     * 确保原始图片备份存在
     * 备份在 loadImage 时已创建，此方法仅做防御性检查
     * 如果备份不存在（如 loadImage 未调用），则从当前画布创建
     */
    _ensureOriginImgBackup() {
        if (this.originImgBackup) return;
        // 防御性兜底：如果备份不存在，从当前画布创建
        console.warn('[ImageProcessor] originImgBackup 不存在，从当前画布创建（可能不是原始像素）');
        const imageData = canvasUtils.getImageData(this.mainCanvas);
        this.originImgBackup = new Uint8ClampedArray(imageData.data);
    }

    /**
     * 释放原始图片备份
     */
    _releaseOriginImgBackup() {
        this.originImgBackup = null;
    }

    /**
     * 加载图片到主画布
     * 支持超大图自动缩放，避免内存溢出与网页崩溃
     * @param {File} file - 图片文件
     * @returns {Promise<Object>} 图片信息
     */
    async loadImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                const img = new Image();

                img.onload = () => {
                    // 图片尺寸限制：最大 4096×4096，超限则等比缩放
                    const MAX_DIMENSION = 4096;
                    let width = img.width;
                    let height = img.height;
                    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
                        const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
                        width = Math.round(width * ratio);
                        height = Math.round(height * ratio);
                        console.warn(`[ImageProcessor] 图片尺寸过大，已缩放至 ${width}×${height}`);
                    }

                    this.originalImage = img;

                    canvasUtils.setCanvasSize(this.mainCanvas, width, height);
                    canvasUtils.setCanvasSize(this.overlayCanvas, width, height);

                    // 若发生缩放，使用 drawImage 进行高质量缩放绘制
                    const ctx = this.mainCanvas.getContext('2d');
                    ctx.clearRect(0, 0, width, height);
                    ctx.drawImage(img, 0, 0, width, height);
                    canvasUtils.clearCanvas(this.overlayCanvas);

                    this.currentMask = new Uint8ClampedArray(width * height);
                    this.shadowMask = new Uint8ClampedArray(width * height);
                    this.edgeData = null;
                    this.isShadowBrushActive = false;
                    this.isEdgeBrushActive = false;
                    this.edgeBrush.reset();
                    this.undoRedoManager.clear();

                    // 在 loadImage 时立即创建原始图片备份
                    // 必须在此处创建，因为后续操作（如删除选区）会修改画布像素
                    // 延迟加载会导致备份的是修改后的画布，而非原始像素
                    this.originImgBackup = new Uint8ClampedArray(
                        canvasUtils.getImageData(this.mainCanvas).data
                    );

                    // 根据图片像素总数动态调整历史步数，防止大图导致内存溢出
                    this.undoRedoManager.adjustMaxHistoryByImageSize(width * height, 4);

                    this.saveToHistory(true, 'loadImage');

                    resolve({
                        width,
                        height,
                        originalWidth: img.width,
                        originalHeight: img.height,
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
     * 使用 AI 模型自动识别背景并生成选区
     * @returns {Promise<void>}
     */
    async applySmartCut() {
        try {
            this.currentMask = await this.smartCutTool.apply();
            this.renderSelection();
            this.saveToHistory(false, 'smartCut');
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
        this.saveToHistory(false, 'colorBasedCut', { tolerance });
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
            this.saveToHistory(false, 'shape');
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
        
        this.renderSelection();
        this.saveToHistory(false, 'magicWand', { x, y, tolerance, contiguous });
    }

    /**
     * 添加到选区
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     */
    addToSelection(x, y) {
        const newMask = this.magicWandTool.addToSelection(x, y, this.currentMask);
        
        this.currentMask = newMask;
        this.renderSelection();
        this.saveToHistory(false, 'add', { x, y });
    }

    /**
     * 从选区减去
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     */
    subtractFromSelection(x, y) {
        const newMask = this.magicWandTool.subtractFromSelection(x, y, this.currentMask);
        
        this.currentMask = newMask;
        this.renderSelection();
        this.saveToHistory(false, 'subtract', { x, y });
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
        
        this.currentMask = this.brushTool.applyToMask(this.currentMask, brushMask);
        const mode = this.brushTool.mode === 'add' ? 'brush' : 'erase';
        
        this.brushTool.clear();
        this.renderSelection();
        this.saveToHistory(false, mode, { size: this.brushTool.size, hardness: this.brushTool.hardness });
    }

    /**
     * 撤销最后一次选择（右键功能）
     * 直接使用统一的 undo 系统，撤销到上一步完整状态
     * @returns {boolean} 是否成功撤销
     */
    undoLastSelection() {
        return this.undo();
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
        canvasUtils.clearCanvas(this.overlayCanvas);
        this.saveToHistory(false, 'clear');
    }

    /**
     * 反选
     */
    invertSelection() {
        for (let i = 0; i < this.currentMask.length; i++) {
            this.currentMask[i] = this.currentMask[i] > 0 ? 0 : 255;
        }
        this.renderSelection();
        this.saveToHistory(false, 'invert');
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
        this.saveToHistory(true, 'delete');
    }

    /**
     * 去除小区域（噪点）
     * @param {number} minArea - 最小区域阈值（像素数）
     * @returns {{removedRegions: number, removedPixels: number}} 处理统计信息
     */
    removeSmallRegions(minArea = 100) {
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        this._ensureOriginImgBackup();  // 确保原始图片备份存在
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
        this.saveToHistory(true, 'denoiseImage', { minArea });

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
        this._ensureOriginImgBackup();  // 确保原始图片备份存在
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
        this.saveToHistory(true, 'denoiseImageArea', { minArea });

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
        this.saveToHistory(false, 'denoiseSelection', { minArea });

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
            this.saveToHistory(true, 'smoothEdges', { strength });
        }
        return success;
    }

    /**
     * 执行边缘检测
     * 使用Canny算法检测物体轮廓，结果存储到this.edgeData
     * 从原始图像数据检测，确保即使背景已被抠除也能正确检测边缘
     * @returns {Promise<boolean>} 是否成功
     */
    async detectEdges(options = {}) {
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        let imageData;
        this._ensureOriginImgBackup();  // 确保原始图片备份存在
        if (this.originImgBackup) {
            imageData = new ImageData(
                new Uint8ClampedArray(this.originImgBackup),
                width,
                height
            );
        } else {
            imageData = canvasUtils.getImageData(this.mainCanvas);
        }

        const lowThreshold = options.lowThreshold ?? 5;
        const highThreshold = options.highThreshold ?? 40;
        const blurKernelSize = options.blurKernelSize ?? 3;

        // 优先使用OpenCV版本（按需异步加载），不可用时回退到手写版本
        const openCVEdges = await this.shadowProcessor.detectEdgesWithOpenCV(imageData, {
            lowThreshold,
            highThreshold,
            blurKernelSize,
            blurSigma: 0
        });
        if (openCVEdges) {
            this.edgeData = openCVEdges;
        } else {
            this.edgeData = this.shadowProcessor.detectEdges(imageData);
        }

        // 设置边缘画笔的数据引用，使其可以操作edgeData
        this.edgeBrush.reset(); // 重置边缘画笔历史记录
        this.edgeBrush.setEdgeData(this.edgeData, width, height);
        this.edgeBrush.setOriginalImageData(this.originImgBackup, width, height);
        this.edgeBrush.setShadowProcessor(this.shadowProcessor);

        this.renderSelection();
        this.saveToHistory(false, 'detectEdges', { minConfidence });
        return true;
    }

    /**
     * 执行阴影检测
     * 根据当前前景蒙版和边缘检测结果，识别物体边缘外的阴影区域
     * 使用洪水算法 + 张力机制，从前景边界向外扩散，遇到边缘障碍墙则停止
     * @param {Object} options - 阴影检测参数
     * @param {number} options.maxDistance - 最大阴影距离（像素）
     * @param {number} options.shadowDiff - 阴影差异度 0-100
     * @param {number} [options.tensionRadius=2] - 张力半径，控制微小空隙闭合能力
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
        this._ensureOriginImgBackup();  // 确保原始图片备份存在
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
        this.saveToHistory(false, 'detectShadows', options);
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
        this.saveToHistory(false, 'shadowBrush');
    }

    // ==================== 边缘画笔方法 ====================

    /**
     * 开始边缘画笔绘制
     * 清空overlay canvas避免干扰，初始化边缘画笔绘制状态
     * @param {number} x - X坐标（canvas坐标）
     * @param {number} y - Y坐标（canvas坐标）
     * @param {number} size - 画笔大小（1-50）
     * @param {number} hardness - 画笔硬度（0-100）
     * @param {string} mode - 模式（'add'=正画笔 / 'subtract'=负画笔）
     * @param {number} scale - 当前缩放比例
     */
    startEdgeBrush(x, y, size = 10, hardness = 50, mode = 'add', scale = 1) {
        if (!this.edgeData) {
            console.warn('请先执行边缘检测');
            return;
        }

        this.isEdgeBrushActive = true;
        this.edgeBrush.setSize(size);
        this.edgeBrush.setHardness(hardness);
        this.edgeBrush.setMode(mode);

        // 确保edgeBrush持有最新的数据引用
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        this.edgeBrush.setEdgeData(this.edgeData, width, height);
        this.edgeBrush.setOriginalImageData(this.originImgBackup, width, height);
        this.edgeBrush.setShadowProcessor(this.shadowProcessor);

        canvasUtils.clearCanvas(this.overlayCanvas);
        this.edgeBrush.startDrawing(x, y, scale);
    }

    /**
     * 边缘画笔绘制中
     * 在overlay canvas上绘制画笔指示轨迹
     * @param {number} x - X坐标（canvas坐标）
     * @param {number} y - Y坐标（canvas坐标）
     * @param {number} scale - 当前缩放比例
     */
    edgeBrushDraw(x, y, scale = 1) {
        this.edgeBrush.drawIndicator(x, y, scale);
    }

    /**
     * 停止边缘画笔绘制并应用效果
     * 正画笔：对涂抹区域执行边缘检测，合并到edgeData
     * 负画笔：抹除涂抹区域内的边缘像素
     */
    async stopEdgeBrush() {
        if (!this.isEdgeBrushActive) return;

        await this.edgeBrush.stopDrawing();
        this.isEdgeBrushActive = false;

        // 边缘画笔操作完成后，保存到系统统一的历史记录
        this.saveToHistory(false, 'edgeBrush');
        this.renderSelection();
    }

    /**
     * 清除边缘数据
     * 重置边缘检测结果和边缘画笔历史
     */
    clearEdgeData() {
        this.edgeData = null;
        this.edgeBrush.reset();
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
        this.saveToHistory(true, 'shadow');
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
     * 
     * **Mask 逻辑说明**：
     * - mask[i] > 0 表示背景区域（要抠除的部分）
     * - mask[i] === 0 表示前景区域（要保留的部分）
     * - 这符合行业通用标准：mask 标记的是需要抠除的区域
     * 
     * 紫色(99,102,241) = 背景抠除选区（要抠除的区域）
     * 粉色(236,72,153) = 阴影选区
     * 青色细线(0,200,255) = 边缘检测轮廓
     */
    renderSelection() {
        canvasUtils.clearCanvas(this.overlayCanvas);
        const ctx = canvasUtils.getContext(this.overlayCanvas);
        const imageData = ctx.createImageData(this.overlayCanvas.width, this.overlayCanvas.height);

        // mask[i] > 0 表示背景（要抠除），显示为紫色选区
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
     * 保存完整应用状态到统一的撤销/重做历史记录
     * 包含：主画布图像数据（仅图像变更时）、选区蒙版、阴影蒙版、边缘数据
     * @param {boolean} [imageChanged=false] - 图像像素是否发生变化（delete/denoise/shadow等操作）
     * @param {string} [operationType=null] - 操作类型标识
     * @param {Object} [operationMetadata=null] - 操作元数据
     */
    saveToHistory(imageChanged = false, operationType = null, operationMetadata = null) {
        const snapshot = UndoRedoManager.createSnapshot({
            imageChanged,
            getImageData: () => canvasUtils.getImageData(this.mainCanvas),
            getMask: () => new Uint8ClampedArray(this.currentMask),
            getShadowMask: () => this.shadowMask ? new Uint8ClampedArray(this.shadowMask) : null,
            getEdgeData: () => this.edgeData ? new Uint8ClampedArray(this.edgeData) : null,
            operationType,
            operationMetadata
        });
        this.undoRedoManager.push(snapshot);
    }

    /**
     * 撤销：恢复完整应用状态到上一步
     * @returns {boolean} 是否成功
     */
    undo() {
        const snapshot = this.undoRedoManager.undo();
        if (!snapshot) return false;

        // 增量快照模式：如果当前快照 imageData 为 null（mask-only 操作），
        // 需要向前回溯找到最近的 imageData 来恢复图像像素
        if (!snapshot.imageData) {
            const nearestImageData = this.undoRedoManager.findNearestImageData();
            if (nearestImageData) {
                canvasUtils.putImageData(this.mainCanvas, nearestImageData);
            }
        }

        UndoRedoManager.restoreSnapshot(snapshot, {
            restoreImageData: (imageData) => {
                canvasUtils.putImageData(this.mainCanvas, imageData);
            },
            restoreMask: (mask) => {
                this.currentMask = new Uint8ClampedArray(mask);
            },
            restoreShadowMask: (shadowMask) => {
                this.shadowMask = shadowMask ? new Uint8ClampedArray(shadowMask) : null;
            },
            restoreEdgeData: (edgeData) => {
                this.edgeData = edgeData ? new Uint8ClampedArray(edgeData) : null;
                // 同步边缘画笔的数据引用
                if (this.edgeData) {
                    const width = this.mainCanvas.width;
                    const height = this.mainCanvas.height;
                    this.edgeBrush.setEdgeData(this.edgeData, width, height);
                }
            },
            onRestoreComplete: () => {
                this.renderSelection();
            }
        });

        return true;
    }

    /**
     * 重做：恢复完整应用状态到下一步
     * @returns {boolean} 是否成功
     */
    redo() {
        const snapshot = this.undoRedoManager.redo();
        if (!snapshot) return false;

        // 增量快照模式：如果当前快照 imageData 为 null（mask-only 操作），
        // 需要向前回溯找到最近的 imageData 来恢复图像像素
        if (!snapshot.imageData) {
            const nearestImageData = this.undoRedoManager.findNearestImageData();
            if (nearestImageData) {
                canvasUtils.putImageData(this.mainCanvas, nearestImageData);
            }
        }

        UndoRedoManager.restoreSnapshot(snapshot, {
            restoreImageData: (imageData) => {
                canvasUtils.putImageData(this.mainCanvas, imageData);
            },
            restoreMask: (mask) => {
                this.currentMask = new Uint8ClampedArray(mask);
            },
            restoreShadowMask: (shadowMask) => {
                this.shadowMask = shadowMask ? new Uint8ClampedArray(shadowMask) : null;
            },
            restoreEdgeData: (edgeData) => {
                this.edgeData = edgeData ? new Uint8ClampedArray(edgeData) : null;
                if (this.edgeData) {
                    const width = this.mainCanvas.width;
                    const height = this.mainCanvas.height;
                    this.edgeBrush.setEdgeData(this.edgeData, width, height);
                }
            },
            onRestoreComplete: () => {
                this.renderSelection();
            }
        });

        return true;
    }

    /**
     * 是否可以撤销
     * @returns {boolean}
     */
    canUndo() {
        return this.undoRedoManager.canUndo();
    }

    /**
     * 是否可以重做
     * @returns {boolean}
     */
    canRedo() {
        return this.undoRedoManager.canRedo();
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

        this.saveToHistory(false, 'reset');
    }
}
