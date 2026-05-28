/**
 * 阴影处理工具模块
 * 提供白底图阴影识别与半透明过渡处理功能
 */

import * as canvasUtils from '../utils/canvasUtils.js';

/**
 * 阴影处理器类
 * 用于识别白底图片中的阴影区域并计算半透明alpha值
 */
export class ShadowProcessor {
    /**
     * 构造函数
     * @param {HTMLCanvasElement} mainCanvas - 主Canvas
     */
    constructor(mainCanvas) {
        this.mainCanvas = mainCanvas;
        this.bgColor = null;
        this.shadowColor = { r: 80, g: 80, b: 80 }; // 默认阴影颜色（深灰）
    }

    /**
     * 处理阴影
     * @param {Uint8ClampedArray} mask - 当前二值蒙版（255=前景，0=背景）
     * @param {Object} options - 处理参数
     * @param {number} options.intensity - 阴影强度 0-100
     * @param {number} options.maxDistance - 最大阴影距离（像素）
     * @param {number} options.sensitivity - 阴影敏感度 0-100
     * @returns {Uint8ClampedArray} 带alpha值的灰度蒙版（0-255）
     */
    process(mask, options = {}) {
        const intensity = (options.intensity ?? 50) / 100;
        const maxDistance = options.maxDistance ?? 60;
        const sensitivity = (options.sensitivity ?? 50) / 100;
        
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        const imageData = canvasUtils.getImageData(this.mainCanvas);
        
        // Step 1: 检测背景色
        this.bgColor = this.detectBackgroundColor(imageData);
        const bgBrightness = (this.bgColor.r + this.bgColor.g + this.bgColor.b) / 3;
        console.log("背景色:", this.bgColor);
        // Step 2: 计算精确的前景边缘距离图
        const distanceMap = this.computeDistanceMap(mask, width, height);
        
        // Step 3: 识别阴影区域并计算alpha
        const alphaMask = new Uint8ClampedArray(width * height);
        
        // 先复制原蒙版（前景保持255）
        for (let i = 0; i < mask.length; i++) {
            if (mask[i] > 0) {
                alphaMask[i] = 255; // 前景完全不透明
            }
        }
        
        // 阴影检测参数
        const maxShadowDiff = Math.min(120, bgBrightness * 0.45); // 最大颜色差异
        const minShadowDiff = 5 + (1 - sensitivity) * 20; // 最小差异阈值
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                
                // 跳过前景像素
                if (mask[idx] > 0) continue;   // TODO: 这里跳过了前景像素点，那有什么意义？看来还是没理解我的意思
                
                const distance = distanceMap[idx];
                
                // 只处理在阴影范围内的背景像素
                if (distance <= 0 || distance > maxDistance) continue;
                
                const pixel = canvasUtils.getPixelColor(imageData, x, y);
                
                // 计算与背景色的差异
                const colorDiff = canvasUtils.colorDistance(pixel, this.bgColor);
                
                // 如果差异太小，认为是纯净背景
                if (colorDiff < minShadowDiff) continue;
                
                // 如果差异太大，可能是其他物体或噪点
                if (colorDiff > maxShadowDiff) continue;
                
                // 检查是否为中性灰（阴影特征：R≈G≈B）
                const grayness = this.calculateGrayness(pixel);
                if (grayness < 0.7) continue; // 不够灰，可能是彩色物体
                
                // 计算基础alpha（基于颜色差异）
                const alphaBase = Math.min(1, colorDiff / maxShadowDiff);
                
                // 计算边缘衰减（离前景越远，阴影越淡）
                const edgeFade = Math.max(0, 1 - (distance / maxDistance));
                
                // 使用平滑的衰减曲线
                const smoothFade = edgeFade * edgeFade * (3 - 2 * edgeFade);
                
                // 最终alpha
                const alpha = alphaBase * smoothFade * intensity;
                
                alphaMask[idx] = Math.round(alpha * 255);
            }
        }
        
        return alphaMask;
    }

    /**
     * 检测背景色（增强版）
     * @param {ImageData} imageData - 图像数据
     * @returns {Object} 背景颜色 {r, g, b}
     */
    detectBackgroundColor(imageData) {
        const width = imageData.width;
        const height = imageData.height;
        const colors = [];
        
        // 采样四边边缘区域
        const sampleSize = Math.min(80, Math.floor(width / 6), Math.floor(height / 6));
        
        for (let i = 0; i < sampleSize; i++) {
            // 上边
            colors.push(canvasUtils.getPixelColor(imageData, Math.floor(i * width / sampleSize), 2));
            // 下边
            colors.push(canvasUtils.getPixelColor(imageData, Math.floor(i * width / sampleSize), height - 3));
            // 左边
            colors.push(canvasUtils.getPixelColor(imageData, 2, Math.floor(i * height / sampleSize)));
            // 右边
            colors.push(canvasUtils.getPixelColor(imageData, width - 3, Math.floor(i * height / sampleSize)));
        }
        
        // 使用K-Means聚类找出最 dominant 的颜色
        const clusters = this.kMeansClustering(colors, 3, 10);
        
        // 选择最大的聚类作为背景色
        let maxCluster = clusters[0];
        for (const cluster of clusters) {
            if (cluster.points.length > maxCluster.points.length) {
                maxCluster = cluster;
            }
        }
        
        return maxCluster.center;
    }

    /**
     * K-Means聚类
     * @param {Array} points - 颜色点数组
     * @param {number} k - 聚类数
     * @param {number} maxIterations - 最大迭代次数
     * @returns {Array} 聚类结果
     */
    kMeansClustering(points, k, maxIterations = 10) {
        // 初始化中心点
        const centers = [];
        for (let i = 0; i < k; i++) {
            centers.push({
                r: points[Math.floor(i * points.length / k)].r,
                g: points[Math.floor(i * points.length / k)].g,
                b: points[Math.floor(i * points.length / k)].b
            });
        }
        
        for (let iter = 0; iter < maxIterations; iter++) {
            // 分配点到最近的中心
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
            
            // 更新中心点
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
        
        // 最大差异越小，越接近中性灰
        return Math.max(0, 1 - maxDiff / 60);
    }

    /**
     * 计算背景像素到前景边缘的距离图
     * @param {Uint8ClampedArray} mask - 二值蒙版
     * @param {number} width - 宽度
     * @param {number} height - 高度
     * @returns {Float32Array} 距离图（背景像素到最近前景边缘的距离，前景像素为0）
     */
    computeDistanceMap(mask, width, height) {
        const distanceMap = new Float32Array(width * height);
        const INF = width + height;
        
        // 初始化：前景像素=0，背景像素=INF
        for (let i = 0; i < mask.length; i++) {
            distanceMap[i] = mask[i] > 0 ? 0 : INF;
        }
        
        // 两次扫描的Distance Transform（8邻域）
        // 第一次：从左到右，从上到下
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (mask[idx] > 0) continue;
                
                let minDist = distanceMap[idx];
                
                // 检查4个已处理的邻居
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
                if (mask[idx] > 0) continue;
                
                let minDist = distanceMap[idx];
                
                // 检查4个未处理的邻居
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
                // 前景：保持原样
                continue;
            } else if (alpha === 0) {
                // 纯背景：完全透明
                imageData.data[idx + 3] = 0;
            } else {
                // 阴影区域：半透明
                // 根据alpha值混合原始颜色和背景色
                const blendFactor = alpha / 255;
                
                // 保持RGB不变（阴影颜色就是原始颜色），只调整alpha
                imageData.data[idx + 3] = alpha;
            }
        }
        
        canvasUtils.putImageData(this.mainCanvas, imageData);
    }
}
