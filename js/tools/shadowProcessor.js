/**
 * 阴影处理工具模块
 * 提供白底图阴影识别与半透明过渡处理功能
 * 核心逻辑：在前景蒙版的边缘像素中识别阴影，将其设为半透明
 */

import * as canvasUtils from '../utils/canvasUtils.js';

/**
 * 阴影处理器类
 * 用于识别前景物体边缘的阴影并计算半透明alpha值
 */
export class ShadowProcessor {
    /**
     * 构造函数
     * @param {HTMLCanvasElement} mainCanvas - 主Canvas
     */
    constructor(mainCanvas) {
        this.mainCanvas = mainCanvas;
        this.bgColor = null;
    }

    /**
     * 处理阴影
     * 在前景蒙版中识别边缘阴影像素，将其从255降为半透明
     * @param {Uint8ClampedArray} mask - 当前二值蒙版（255=前景，0=背景）
     * @param {Object} options - 处理参数
     * @param {number} options.intensity - 阴影的透明强度 0-100
     * @param {number} options.maxDistance - 最大阴影距离（像素）
     * @param {number} options.sensitivity - 阴影与主体色的最大颜色差异值（rgb之间的坐标距离） 0-100
     * @returns {Uint8ClampedArray} 带alpha值的灰度蒙版（0-255）
     */
    process(mask, options = {}) {
        const intensity = (options.intensity ?? 50) / 100;
        const maxDistance = options.maxDistance ?? 60;
        const sensitivity = (options.sensitivity ?? 50);

        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        const imageData = canvasUtils.getImageData(this.mainCanvas);

        // Step 1: 检测背景色
        this.bgColor = this.detectBackgroundColor(imageData);
        // 计算前景亮度
        const bgBrightness = (this.bgColor.r + this.bgColor.g + this.bgColor.b) / 3;

        // Step 2: 计算前景像素到最近背景像素的距离图
        // 距离 = 0：前景中心（远离背景）
        // 距离 = 1,2,3...：前景边缘（靠近背景）
        const distanceMap = this.computeForegroundDistanceMap(mask, width, height);

        // Step 3: 分析前景主体颜色（用于区分主体和阴影）
        const fgColor = this.detectForegroundColor(imageData, mask, this.bgColor);
        // 计算前景主体亮度
        const fgBrightness = (fgColor.r + fgColor.g + fgColor.b) / 3;

        // Step 4: 在前景像素中识别阴影并计算alpha
        const alphaMask = new Uint8ClampedArray(width * height);

        // 先填充背景和前景基础值
        for (let i = 0; i < mask.length; i++) {
            alphaMask[i] = mask[i]; // 0 或 255
        }

        // 阴影检测参数
        const maxShadowDiff = Math.min(100, bgBrightness * 0.4); // 最大颜色差异阈值
        const minShadowDiff = 3 + (1 - sensitivity) * 15; // 最小差异阈值
        console.log('sensitivity', sensitivity);
        console.log('fgColor', fgColor);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;

                // 只处理前景像素
                if (mask[idx] === 0) continue;

                const distance = distanceMap[idx];

                // 距离太大的像素（前景中心）不可能是阴影
                if (distance > maxDistance) continue;

                const pixel = canvasUtils.getPixelColor(imageData, x, y);

                // 计算与背景色的差异
                const colorDiff = canvasUtils.colorDistance(pixel, this.bgColor);

                // 差异太小：可能是主体穿透到边缘的纯色（如数字本身）
                //if (colorDiff < minShadowDiff) continue;

                // 差异太大：前景主体本身的颜色
                if (colorDiff > sensitivity) continue;

                // 检查是否为中性灰（阴影特征：R≈G≈B）
                const grayness = this.calculateGrayness(pixel);
                if (grayness < 0.5) continue; // 不够灰，是彩色主体

                // 检查亮度：白底图片的情况下，阴影的亮度应该比主体亮，但比背景暗
                const pixelBrightness = (pixel.r + pixel.g + pixel.b) / 3;
                if (pixelBrightness < fgBrightness * 0.99 || pixelBrightness > bgBrightness * 0.99) continue; // 比主体色暗了或比背景色亮了，不是阴影

                // 计算与前景主体颜色的差异
                // 如果像素颜色很接近主体色，说明是主体边缘而非阴影
                const fgDistance = canvasUtils.colorDistance(pixel, fgColor);
                if (fgDistance < 30) continue; // 太接近主体色，不是阴影

                // 综合判断：前景边缘 + 颜色接近背景 + 中性灰 + 较暗 = 阴影
                // 计算基础alpha（基于该点与背景的颜色差异，差异越小越像阴影，alphaBase应该越小，需要的透明度越高，即alpha越小）
                const alphaBase = Math.min(1, colorDiff / sensitivity);

                // 边缘衰减：离背景越近（distance越小），阴影越淡，edgeFade越小，而需要的透明度越高，即alpha越小
                const edgeFade = Math.max(0, (distance / maxDistance));

                // 使用平滑的衰减扩大参数
                const smoothFade = 3;

                // 最终alpha = 基础透明度 × 边缘衰减 × 阴影的透明强度
                // alpha值越小越透明（阴影越淡）
                const alpha = Math.round((alphaBase * edgeFade * (1-intensity))*smoothFade * 255);

                // 限制范围，确保主体不会完全消失
                alphaMask[idx] = Math.min(255, alpha);
            }
        }

        return alphaMask;
    }

    /**
     * 计算前景像素到最近背景像素的距离图
     * @param {Uint8ClampedArray} mask - 二值蒙版
     * @param {number} width - 宽度
     * @param {number} height - 高度
     * @returns {Float32Array} 距离图（前景像素到最近背景的距离，背景像素为0）
     */
    computeForegroundDistanceMap(mask, width, height) {
        const distanceMap = new Float32Array(width * height);
        const INF = width + height;

        // 初始化：背景像素=0，前景像素=INF
        for (let i = 0; i < mask.length; i++) {
            distanceMap[i] = mask[i] > 0 ? INF : 0;
        }

        // 两次扫描的Distance Transform（8邻域）
        // 第一次：从左到右，从上到下
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (mask[idx] === 0) continue;

                let minDist = distanceMap[idx];

                if (x > 0) minDist = Math.min(minDist, distanceMap[idx - 1] + 1);
                if (y > 0) minDist = Math.min(minDist, distanceMap[idx - width] + 1);
                if (x > 0 && y > 0) minDist = Math.min(minDist, distanceMap[idx - width - 1] + Math.SQRT2);
                if (x < width - 1 && y > 0) minDist = Math.min(minDist, distanceMap[idx - width + 1] + Math.SQRT2);

                distanceMap[idx] = minDist;
            }
        }

        // 第二次：从右到左，从下到上
        for (let y = height - 1; y >= 0; y--) {
            for (let x = width - 1; x >= 0; x--) {
                const idx = y * width + x;
                if (mask[idx] === 0) continue;

                let minDist = distanceMap[idx];

                if (x < width - 1) minDist = Math.min(minDist, distanceMap[idx + 1] + 1);
                if (y < height - 1) minDist = Math.min(minDist, distanceMap[idx + width] + 1);
                if (x > 0 && y < height - 1) minDist = Math.min(minDist, distanceMap[idx + width - 1] + Math.SQRT2);
                if (x < width - 1 && y < height - 1) minDist = Math.min(minDist, distanceMap[idx + width + 1] + Math.SQRT2);

                distanceMap[idx] = minDist;
            }
        }

        return distanceMap;
    }

    /**
     * 检测背景色（从图像边缘采样）
     * @param {ImageData} imageData - 图像数据
     * @returns {Object} 背景颜色 {r, g, b}
     */
    detectBackgroundColor(imageData) {
        const width = imageData.width;
        const height = imageData.height;
        const colors = [];

        const sampleSize = Math.min(80, Math.floor(width / 6), Math.floor(height / 6));

        for (let i = 0; i < sampleSize; i++) {
            colors.push(canvasUtils.getPixelColor(imageData, Math.floor(i * width / sampleSize), 2));
            colors.push(canvasUtils.getPixelColor(imageData, Math.floor(i * width / sampleSize), height - 3));
            colors.push(canvasUtils.getPixelColor(imageData, 2, Math.floor(i * height / sampleSize)));
            colors.push(canvasUtils.getPixelColor(imageData, width - 3, Math.floor(i * height / sampleSize)));
        }

        // 使用K-Means聚类
        const clusters = this.kMeansClustering(colors, 3, 10);

        let maxCluster = clusters[0];
        for (const cluster of clusters) {
            if (cluster.points.length > maxCluster.points.length) {
                maxCluster = cluster;
            }
        }

        return maxCluster.center;
    }

    /**
     * 检测前景主体颜色（从前景中心采样）
     * @param {ImageData} imageData - 图像数据
     * @param {Uint8ClampedArray} mask - 二值蒙版
     * @param {Object} bgColor - 背景颜色
     * @returns {Object} 前景颜色 {r, g, b}
     */
    detectForegroundColor(imageData, mask, bgColor) {
        const width = imageData.width;
        const height = imageData.height;

        let bestColor = { r: 128, g: 128, b: 128 };
        let maxDistance = 0;
        let count = 0;
        const totalR = 0, totalG = 0, totalB = 0;

        // 从前景像素中采样，找离背景色最远的颜色
        const step = Math.max(1, Math.floor(Math.sqrt(mask.length) / 20));

        for (let y = step; y < height - step; y += step) {
            for (let x = step; x < width - step; x += step) {
                const idx = y * width + x;
                if (mask[idx] === 0) continue;

                const pixel = canvasUtils.getPixelColor(imageData, x, y);
                const distance = canvasUtils.colorDistance(pixel, bgColor);

                if (distance > maxDistance && distance > 30) {
                    maxDistance = distance;
                    bestColor = pixel;
                }
            }
        }

        return bestColor;
    }

    /**
     * K-Means聚类
     * @param {Array} points - 颜色点数组
     * @param {number} k - 聚类数
     * @param {number} maxIterations - 最大迭代次数
     * @returns {Array} 聚类结果
     */
    kMeansClustering(points, k, maxIterations = 10) {
        const centers = [];
        for (let i = 0; i < k; i++) {
            centers.push({
                r: points[Math.floor(i * points.length / k)].r,
                g: points[Math.floor(i * points.length / k)].g,
                b: points[Math.floor(i * points.length / k)].b
            });
        }

        for (let iter = 0; iter < maxIterations; iter++) {
            const clusters = centers.map(c => ({ center: c, points: [] }));

            for (const point of points) {
                let minDist = Infinity;
                let minIdx = 0;

                for (let i = 0; i < k; i++) {
                    const dist = canvasUtils.colorDistance(point, centers[i]);
                    if (dist < minDist) {
                        minDist = dist;
                        minIdx = i;
                    }
                }

                clusters[minIdx].points.push(point);
            }

            let changed = false;
            for (let i = 0; i < k; i++) {
                if (clusters[i].points.length === 0) continue;

                const newCenter = { r: 0, g: 0, b: 0 };
                for (const point of clusters[i].points) {
                    newCenter.r += point.r;
                    newCenter.g += point.g;
                    newCenter.b += point.b;
                }

                newCenter.r = Math.round(newCenter.r / clusters[i].points.length);
                newCenter.g = Math.round(newCenter.g / clusters[i].points.length);
                newCenter.b = Math.round(newCenter.b / clusters[i].points.length);

                if (canvasUtils.colorDistance(newCenter, centers[i]) > 1) {
                    changed = true;
                }

                centers[i] = newCenter;
            }

            if (!changed) break;
        }

        return centers.map((c, i) => ({ center: c, points: [] }));
    }

    /**
     * 计算像素的中性灰程度
     * @param {Object} pixel - 像素颜色 {r, g, b}
     * @returns {number} 灰度值 0-1（1=完全中性灰）
     */
    calculateGrayness(pixel) {
        const avg = (pixel.r + pixel.g + pixel.b) / 3;
        const maxDiff = Math.max(
            Math.abs(pixel.r - avg),
            Math.abs(pixel.g - avg),
            Math.abs(pixel.b - avg)
        );

        return Math.max(0, 1 - maxDiff / 60);
    }

    /**
     * 应用阴影蒙版到图像（直接修改mainCanvas）
     * @param {Uint8ClampedArray} alphaMask - 带alpha的蒙版
     * @param {boolean} preview - 是否为预览模式
     */
    applyToCanvas(alphaMask, preview = false) {
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        const imageData = canvasUtils.getImageData(this.mainCanvas);

        for (let i = 0; i < alphaMask.length; i++) {
            const alpha = alphaMask[i];
            const idx = i * 4;

            if (alpha === 255) {
                // 前景主体：保持原样（不透明）
                imageData.data[idx + 3] = 255;
            } else if (alpha === 0) {
                // 纯背景：完全透明
                imageData.data[idx + 3] = 0;
            } else {
                // 阴影区域：半透明
                imageData.data[idx + 3] = alpha;
            }
        }

        canvasUtils.putImageData(this.mainCanvas, imageData);
    }
}
