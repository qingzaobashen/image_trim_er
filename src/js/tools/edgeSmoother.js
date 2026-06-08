/**
 * 边缘光滑处理模块
 * 提供图像边缘平滑处理功能
 */

import * as canvasUtils from '../utils/canvasUtils.js';

/**
 * 边缘光滑处理类
 */
export class EdgeSmoother {
    /**
     * 构造函数
     * @param {HTMLCanvasElement} canvas - 主Canvas
     */
    constructor(canvas) {
        this.canvas = canvas;
    }

    /**
     * 执行边缘光滑处理
     * @param {number} strength - 光滑强度 (1-10)
     * @returns {boolean} 是否成功
     */
    smooth(strength = 3) {
        const width = this.canvas.width;
        const height = this.canvas.height;

        if (width === 0 || height === 0) return false;

        const imageData = canvasUtils.getImageData(this.canvas);
        const data = imageData.data;

        const edgeMask = this.detectEdges(data, width, height);

        const blurRadius = Math.max(1, Math.floor(strength * 0.8));
        const blurredData = this.applyGaussianBlur(data, width, height, blurRadius);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                const edgeFactor = edgeMask[y * width + x];

                if (edgeFactor > 0) {
                    const blendFactor = edgeFactor * (strength / 10);
                    data[idx] = Math.round(data[idx] * (1 - blendFactor) + blurredData[idx] * blendFactor);
                    data[idx + 1] = Math.round(data[idx + 1] * (1 - blendFactor) + blurredData[idx + 1] * blendFactor);
                    data[idx + 2] = Math.round(data[idx + 2] * (1 - blendFactor) + blurredData[idx + 2] * blendFactor);
                }
            }
        }

        canvasUtils.putImageData(this.canvas, imageData);
        return true;
    }

    /**
     * 检测图像边缘
     * @param {Uint8ClampedArray} data - 图像数据
     * @param {number} width - 图像宽度
     * @param {number} height - 图像高度
     * @returns {Float32Array} 边缘蒙版 (0-1)
     */
    detectEdges(data, width, height) {
        const edgeMask = new Float32Array(width * height);

        const threshold = 30;

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                const pixelIdx = idx * 4;

                const alpha = data[pixelIdx + 3];

                if (alpha === 0) continue;

                const leftAlpha = data[(y * width + (x - 1)) * 4 + 3];
                const rightAlpha = data[(y * width + (x + 1)) * 4 + 3];
                const topAlpha = data[((y - 1) * width + x) * 4 + 3];
                const bottomAlpha = data[((y + 1) * width + x) * 4 + 3];

                const alphaGradient = Math.max(
                    Math.abs(alpha - leftAlpha),
                    Math.abs(alpha - rightAlpha),
                    Math.abs(alpha - topAlpha),
                    Math.abs(alpha - bottomAlpha)
                );

                if (alphaGradient > threshold) {
                    edgeMask[idx] = Math.min(1, alphaGradient / 255);
                }

                const r = data[pixelIdx];
                const g = data[pixelIdx + 1];
                const b = data[pixelIdx + 2];

                const leftR = data[(y * width + (x - 1)) * 4];
                const leftG = data[(y * width + (x - 1)) * 4 + 1];
                const leftB = data[(y * width + (x - 1)) * 4 + 2];

                const rightR = data[(y * width + (x + 1)) * 4];
                const rightG = data[(y * width + (x + 1)) * 4 + 1];
                const rightB = data[(y * width + (x + 1)) * 4 + 2];

                const topR = data[((y - 1) * width + x) * 4];
                const topG = data[((y - 1) * width + x) * 4 + 1];
                const topB = data[((y - 1) * width + x) * 4 + 2];

                const bottomR = data[((y + 1) * width + x) * 4];
                const bottomG = data[((y + 1) * width + x) * 4 + 1];
                const bottomB = data[((y + 1) * width + x) * 4 + 2];

                const colorGradient = Math.max(
                    Math.abs(r - leftR),
                    Math.abs(g - leftG),
                    Math.abs(b - leftB),
                    Math.abs(r - rightR),
                    Math.abs(g - rightG),
                    Math.abs(b - rightB),
                    Math.abs(r - topR),
                    Math.abs(g - topG),
                    Math.abs(b - topB),
                    Math.abs(r - bottomR),
                    Math.abs(g - bottomG),
                    Math.abs(b - bottomB)
                );

                if (colorGradient > threshold * 2) {
                    edgeMask[idx] = Math.max(edgeMask[idx], Math.min(1, colorGradient / 255));
                }
            }
        }

        this.dilateEdges(edgeMask, width, height, 2);

        return edgeMask;
    }

    /**
     * 扩展边缘区域
     * @param {Float32Array} edgeMask - 边缘蒙版
     * @param {number} width - 图像宽度
     * @param {number} height - 图像高度
     * @param {number} radius - 扩展半径
     */
    dilateEdges(edgeMask, width, height, radius) {
        const tempMask = new Float32Array(edgeMask);

        for (let y = radius; y < height - radius; y++) {
            for (let x = radius; x < width - radius; x++) {
                const idx = y * width + x;

                if (tempMask[idx] > 0) continue;

                let maxVal = 0;
                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist <= radius) {
                            const neighborIdx = (y + dy) * width + (x + dx);
                            if (tempMask[neighborIdx] > maxVal) {
                                maxVal = tempMask[neighborIdx];
                            }
                        }
                    }
                }

                if (maxVal > 0) {
                    edgeMask[idx] = maxVal * 0.5;
                }
            }
        }
    }

    /**
     * 应用高斯模糊
     * @param {Uint8ClampedArray} data - 图像数据
     * @param {number} width - 图像宽度
     * @param {number} height - 图像高度
     * @param {number} radius - 模糊半径
     * @returns {Uint8ClampedArray} 模糊后的数据
     */
    applyGaussianBlur(data, width, height, radius) {
        const result = new Uint8ClampedArray(data.length);
        const kernel = this.createGaussianKernel(radius);
        const kernelSize = kernel.length;
        const halfKernel = Math.floor(kernelSize / 2);

        const tempData = new Uint8ClampedArray(data.length);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let r = 0, g = 0, b = 0, a = 0, weight = 0;

                for (let k = 0; k < kernelSize; k++) {
                    const nx = x + k - halfKernel;
                    if (nx >= 0 && nx < width) {
                        const idx = (y * width + nx) * 4;
                        const w = kernel[k];
                        r += data[idx] * w;
                        g += data[idx + 1] * w;
                        b += data[idx + 2] * w;
                        a += data[idx + 3] * w;
                        weight += w;
                    }
                }

                const idx = (y * width + x) * 4;
                tempData[idx] = Math.round(r / weight);
                tempData[idx + 1] = Math.round(g / weight);
                tempData[idx + 2] = Math.round(b / weight);
                tempData[idx + 3] = Math.round(a / weight);
            }
        }

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let r = 0, g = 0, b = 0, a = 0, weight = 0;

                for (let k = 0; k < kernelSize; k++) {
                    const ny = y + k - halfKernel;
                    if (ny >= 0 && ny < height) {
                        const idx = (ny * width + x) * 4;
                        const w = kernel[k];
                        r += tempData[idx] * w;
                        g += tempData[idx + 1] * w;
                        b += tempData[idx + 2] * w;
                        a += tempData[idx + 3] * w;
                        weight += w;
                    }
                }

                const idx = (y * width + x) * 4;
                result[idx] = Math.round(r / weight);
                result[idx + 1] = Math.round(g / weight);
                result[idx + 2] = Math.round(b / weight);
                result[idx + 3] = Math.round(a / weight);
            }
        }

        return result;
    }

    /**
     * 创建高斯核
     * @param {number} radius - 半径
     * @returns {number[]} 高斯核
     */
    createGaussianKernel(radius) {
        const size = radius * 2 + 1;
        const kernel = new Array(size);
        const sigma = radius / 3;
        const twoSigmaSquare = 2 * sigma * sigma;

        let sum = 0;
        for (let i = 0; i < size; i++) {
            const x = i - radius;
            kernel[i] = Math.exp(-(x * x) / twoSigmaSquare);
            sum += kernel[i];
        }

        for (let i = 0; i < size; i++) {
            kernel[i] /= sum;
        }

        return kernel;
    }
}
