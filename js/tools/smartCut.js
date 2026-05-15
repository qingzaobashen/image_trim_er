/**
 * 智能抠图工具模块
 * 提供多种智能抠图算法
 */

import * as canvasUtils from '../utils/canvasUtils.js';

/**
 * 智能抠图类
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
        this.smoothness = 50;
        this.mode = 'auto';
    }

    /**
     * 加载BodyPix模型（用于人体抠图）
     * @returns {Promise<void>}
     */
    async loadBodyPixModel() {
        if (this.isBodyPixLoaded) return;
        
        try {
            if (typeof bodyPix === 'undefined') {
                throw new Error('BodyPix库未加载');
            }
            
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
     * 设置平滑度
     * @param {number} value - 平滑度值 (0-100)
     */
    setSmoothness(value) {
        this.smoothness = value;
    }

    /**
     * 设置抠图模式
     * @param {string} mode - 模式 ('auto', 'person', 'color', 'edge')
     */
    setMode(mode) {
        this.mode = mode;
    }

    /**
     * 执行智能抠图
     * @returns {Promise<Uint8ClampedArray>} 选区蒙版
     */
    async apply() {
        switch (this.mode) {
            case 'person':
                return await this.applyPersonSegmentation();
            case 'color':
                return this.applyColorBasedSegmentation();
            case 'edge':
                return this.applyEdgeBasedSegmentation();
            case 'auto':
            default:
                return await this.applyAutoSegmentation();
        }
    }

    /**
     * 自动选择最佳抠图方法
     * @returns {Promise<Uint8ClampedArray>} 选区蒙版
     */
    async applyAutoSegmentation() {
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
            if (typeof bodyPix !== 'undefined') {
                console.log('尝试人体分割');
                return await this.applyPersonSegmentation();
            }
        } catch (error) {
            console.log('人体分割不可用，使用颜色聚类');
        }
        
        return colorMask;
    }

    /**
     * 人体分割抠图
     * @returns {Promise<Uint8ClampedArray>} 选区蒙版
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
        
        for (let i = 0; i < segmentation.data.length; i++) {
            mask[i] = segmentation.data[i] === 1 ? 255 : 0;
        }

        if (this.smoothness > 0) {
            this.smoothMask(mask, width, height, this.smoothness);
        }

        return mask;
    }

    /**
     * 基于颜色聚类的抠图
     * @returns {Uint8ClampedArray} 选区蒙版
     */
    applyColorBasedSegmentation() {
        const imageData = canvasUtils.getImageData(this.mainCanvas);
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        
        const bgColor = this.detectBackgroundColor(imageData);
        const fgColor = this.detectForegroundColor(imageData, bgColor);
        
        const tolerance = this.calculateOptimalTolerance(imageData, bgColor, fgColor);
        
        const mask = new Uint8ClampedArray(width * height);
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const pixelColor = canvasUtils.getPixelColor(imageData, x, y);
                const bgDistance = canvasUtils.colorDistance(pixelColor, bgColor);
                const fgDistance = canvasUtils.colorDistance(pixelColor, fgColor);
                
                if (fgDistance < bgDistance) {
                    mask[y * width + x] = 255;
                } else {
                    const ratio = bgDistance / (bgDistance + fgDistance);
                    mask[y * width + x] = ratio > 0.6 ? 255 : 0;
                }
            }
        }
        
        this.removeSmallRegions(mask, width, height, 100);
        
        if (this.smoothness > 0) {
            this.smoothMask(mask, width, height, this.smoothness);
        }
        
        return mask;
    }

    /**
     * 基于边缘检测的抠图
     * @returns {Uint8ClampedArray} 选区蒙版
     */
    applyEdgeBasedSegmentation() {
        const imageData = canvasUtils.getImageData(this.mainCanvas);
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        
        const edges = this.detectEdges(imageData);
        
        const mask = this.floodFillFromCenter(edges, width, height);
        
        this.removeSmallRegions(mask, width, height, 100);
        
        if (this.smoothness > 0) {
            this.smoothMask(mask, width, height, this.smoothness);
        }
        
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

    /**
     * 平滑蒙版边缘
     * @param {Uint8ClampedArray} mask - 蒙版数据
     * @param {number} width - 宽度
     * @param {number} height - 高度
     * @param {number} amount - 平滑程度
     */
    smoothMask(mask, width, height, amount) {
        const radius = Math.floor(amount / 10);
        if (radius === 0) return;

        const tempMask = new Uint8ClampedArray(mask);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const index = y * width + x;
                let sum = 0;
                let count = 0;

                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;

                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            const nIndex = ny * width + nx;
                            sum += tempMask[nIndex];
                            count++;
                        }
                    }
                }

                mask[index] = sum / count > 127 ? 255 : 0;
            }
        }
    }

    /**
     * 销毁模型
     */
    dispose() {
        if (this.bodyPixModel) {
            this.bodyPixModel = null;
            this.isBodyPixLoaded = false;
        }
    }
}
