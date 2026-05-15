/**
 * 魔术棒工具模块
 * 通过点击选择相似颜色区域
 */

import * as canvasUtils from '../utils/canvasUtils.js';

/**
 * 魔术棒工具类
 */
export class MagicWandTool {
    /**
     * 构造函数
     * @param {HTMLCanvasElement} mainCanvas - 主Canvas
     * @param {HTMLCanvasElement} overlayCanvas - 覆盖层Canvas
     */
    constructor(mainCanvas, overlayCanvas) {
        this.mainCanvas = mainCanvas;
        this.overlayCanvas = overlayCanvas;
        this.tolerance = 32;
        this.contiguous = true;
        this.imageData = null;
    }

    /**
     * 设置容差值
     * @param {number} value - 容差值 (1-100)
     */
    setTolerance(value) {
        this.tolerance = value;
    }

    /**
     * 设置是否连续区域
     * @param {boolean} value - 是否连续
     */
    setContiguous(value) {
        this.contiguous = value;
    }

    /**
     * 更新图像数据
     */
    updateImageData() {
        this.imageData = canvasUtils.getImageData(this.mainCanvas);
    }

    /**
     * 在指定位置选择相似颜色区域
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @returns {Uint8ClampedArray} 选区蒙版
     */
    select(x, y) {
        this.updateImageData();
        
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        const targetColor = canvasUtils.getPixelColor(this.imageData, x, y);
        const mask = new Uint8ClampedArray(width * height);

        if (this.contiguous) {
            this.floodFill(x, y, targetColor, mask);
        } else {
            this.selectSimilar(targetColor, mask);
        }

        return mask;
    }

    /**
     * 洪水填充算法（连续区域选择）
     * @param {number} startX - 起始X坐标
     * @param {number} startY - 起始Y坐标
     * @param {Object} targetColor - 目标颜色
     * @param {Uint8ClampedArray} mask - 蒙版数组
     */
    floodFill(startX, startY, targetColor, mask) {
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        const visited = new Uint8ClampedArray(width * height);
        const stack = [[startX, startY]];

        while (stack.length > 0) {
            const [x, y] = stack.pop();
            
            if (!canvasUtils.isInBounds(this.mainCanvas, x, y)) continue;
            
            const index = y * width + x;
            if (visited[index]) continue;
            
            const pixelColor = canvasUtils.getPixelColor(this.imageData, x, y);
            const distance = canvasUtils.colorDistance(pixelColor, targetColor);
            
            if (distance > this.tolerance) continue;
            
            visited[index] = 1;
            mask[index] = 255;
            
            stack.push([x + 1, y]);
            stack.push([x - 1, y]);
            stack.push([x, y + 1]);
            stack.push([x, y - 1]);
        }
    }

    /**
     * 选择相似颜色（非连续）
     * @param {Object} targetColor - 目标颜色
     * @param {Uint8ClampedArray} mask - 蒙版数组
     */
    selectSimilar(targetColor, mask) {
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const pixelColor = canvasUtils.getPixelColor(this.imageData, x, y);
                const distance = canvasUtils.colorDistance(pixelColor, targetColor);
                
                if (distance <= this.tolerance) {
                    mask[y * width + x] = 255;
                }
            }
        }
    }

    /**
     * 添加到现有选区
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @param {Uint8ClampedArray} existingMask - 现有蒙版
     * @returns {Uint8ClampedArray} 合并后的蒙版
     */
    addToSelection(x, y, existingMask) {
        const newMask = this.select(x, y);
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;

        for (let i = 0; i < width * height; i++) {
            if (newMask[i] > 0) {
                existingMask[i] = 255;
            }
        }

        return existingMask;
    }

    /**
     * 从现有选区减去
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @param {Uint8ClampedArray} existingMask - 现有蒙版
     * @returns {Uint8ClampedArray} 减去后的蒙版
     */
    subtractFromSelection(x, y, existingMask) {
        const newMask = this.select(x, y);
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;

        for (let i = 0; i < width * height; i++) {
            if (newMask[i] > 0) {
                existingMask[i] = 0;
            }
        }

        return existingMask;
    }

    /**
     * 与现有选区交叉
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @param {Uint8ClampedArray} existingMask - 现有蒙版
     * @returns {Uint8ClampedArray} 交叉后的蒙版
     */
    intersectSelection(x, y, existingMask) {
        const newMask = this.select(x, y);
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;

        for (let i = 0; i < width * height; i++) {
            existingMask[i] = (newMask[i] > 0 && existingMask[i] > 0) ? 255 : 0;
        }

        return existingMask;
    }

    /**
     * 优化选区边缘
     * @param {Uint8ClampedArray} mask - 蒙版数组
     * @param {number} radius - 优化半径
     * @returns {Uint8ClampedArray} 优化后的蒙版
     */
    refineEdges(mask, radius = 2) {
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        const refinedMask = new Uint8ClampedArray(mask);

        for (let y = radius; y < height - radius; y++) {
            for (let x = radius; x < width - radius; x++) {
                const index = y * width + x;
                let sum = 0;
                let count = 0;

                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        const nIndex = (y + dy) * width + (x + dx);
                        sum += mask[nIndex];
                        count++;
                    }
                }

                refinedMask[index] = sum / count > 127 ? 255 : 0;
            }
        }

        return refinedMask;
    }

    /**
     * 扩展选区
     * @param {Uint8ClampedArray} mask - 蒙版数组
     * @param {number} pixels - 扩展像素数
     * @returns {Uint8ClampedArray} 扩展后的蒙版
     */
    expandSelection(mask, pixels) {
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        const expandedMask = new Uint8ClampedArray(mask);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const index = y * width + x;
                if (mask[index] > 0) continue;

                for (let dy = -pixels; dy <= pixels; dy++) {
                    for (let dx = -pixels; dx <= pixels; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            const nIndex = ny * width + nx;
                            if (mask[nIndex] > 0) {
                                expandedMask[index] = 255;
                                break;
                            }
                        }
                    }
                }
            }
        }

        return expandedMask;
    }

    /**
     * 收缩选区
     * @param {Uint8ClampedArray} mask - 蒙版数组
     * @param {number} pixels - 收缩像素数
     * @returns {Uint8ClampedArray} 收缩后的蒙版
     */
    contractSelection(mask, pixels) {
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        const contractedMask = new Uint8ClampedArray(mask);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const index = y * width + x;
                if (mask[index] === 0) continue;

                for (let dy = -pixels; dy <= pixels; dy++) {
                    for (let dx = -pixels; dx <= pixels; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            const nIndex = ny * width + nx;
                            if (mask[nIndex] === 0) {
                                contractedMask[index] = 0;
                                break;
                            }
                        }
                    }
                }
            }
        }

        return contractedMask;
    }
}
