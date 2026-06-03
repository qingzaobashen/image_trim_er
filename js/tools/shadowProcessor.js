/**
 * 阴影处理工具模块
 * 提供白底图阴影识别与半透明过渡处理功能
 *
 * 核心流程：
 * 1. 边缘检测：使用Canny算法检测物体轮廓，连接离散边缘点形成连续曲线
 * 2. 阴影检测：在背景区域中，从前景边界向外生长，遇到边缘曲线停止，识别阴影区域
 * 3. 阴影画笔：手动调整阴影选区（涂抹新增/取消）
 * 4. 应用处理：紫色选区完全抠除，粉色阴影选区半透明抠除
 *
 * 选区颜色约定：
 * - 紫色(99,102,241)：前景抠除选区（完全抠除）
 * - 粉色(236,72,153)：阴影选区（半透明抠除）
 * - 细线(0,200,255)：边缘检测轮廓线
 */

import * as canvasUtils from '../utils/canvasUtils.js';

/**
 * 阴影处理器类
 * 用于识别物体边缘外的阴影区域并计算半透明alpha值
 */
export class ShadowProcessor {
    /**
     * 构造函数
     * @param {HTMLCanvasElement} mainCanvas - 主Canvas
     */
    constructor(mainCanvas) {
        this.mainCanvas = mainCanvas;
        this.bgColor = null;
        this.edgeData = null;
    }

    /**
     * 检测物体边缘轮廓（Canny边缘检测）
     * 检测图片中物体的连续轮廓，特别关注物体与背景的边界
     * 
     * Canny边缘检测算法流程：
     * 1. 灰度转换：将彩色图像转为灰度图，简化计算
     * 2. 高斯模糊：去除噪声，避免噪声被误识别为边缘
     * 3. 梯度计算：计算每个像素的梯度幅值和方向
     * 4. 非极大值抑制：细化边缘，保留梯度方向上的局部最大值
     * 5. 双阈值检测：区分强边缘、弱边缘和非边缘
     * 6. 边缘连接：将弱边缘连接到强边缘，形成连续边缘
     * 
     * @param {ImageData} imageData - 图像数据
     * @returns {Uint8ClampedArray} 边缘图（255=边缘，0=非边缘）
     */
    detectEdges(imageData) {
        const width = imageData.width;
        const height = imageData.height;

        // ==================== 步骤1：灰度转换 ====================
        // 将RGB彩色图像转换为灰度图像
        // 使用加权平均法：Gray = 0.299*R + 0.587*G + 0.114*B
        // 权重基于人眼对不同颜色的敏感度（人眼对绿色最敏感）
        const gray = new Float32Array(width * height);
        for (let i = 0; i < width * height; i++) {
            const idx = i * 4; // RGBA四个通道，每个像素占4个字节
            gray[i] = imageData.data[idx] * 0.333 +      // R通道权重0.299
                      imageData.data[idx + 1] * 0.333 +  // G通道权重0.587
                      imageData.data[idx + 2] * 0.333;   // B通道权重0.114
        }

        // ==================== 步骤2：高斯模糊去噪 ====================
        // 使用高斯滤波器平滑图像，去除噪声点
        // 噪声点通常有很高的梯度值，会被误识别为边缘
        // sigma=1.4 控制模糊程度，值越大越模糊
        // const blurred = this.applyGaussianBlur(gray, width, height, 1.1);
        const blurred = gray;

        // ==================== 步骤3：计算梯度幅值和方向 ====================
        // 使用Sobel算子计算每个像素的梯度
        // 梯度 = 图像亮度变化率，边缘就是亮度变化剧烈的地方
        const gradient = new Float32Array(width * height);  // 梯度幅值
        const direction = new Float32Array(width * height); // 梯度方向（弧度）

        // 遍历图像每个像素（跳过边界像素，避免数组越界）
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                
                // 获取3x3邻域的9个像素值
                // tl=左上, tc=上, tr=右上
                // ml=左,   mr=右
                // bl=左下, bc=下, br=右下
                const tl = blurred[(y - 1) * width + (x - 1)];
                const tc = blurred[(y - 1) * width + x];
                const tr = blurred[(y - 1) * width + (x + 1)];
                const ml = blurred[y * width + (x - 1)];
                const mr = blurred[y * width + (x + 1)];
                const bl = blurred[(y + 1) * width + (x - 1)];
                const bc = blurred[(y + 1) * width + x];
                const br = blurred[(y + 1) * width + (x + 1)];

                // 计算水平梯度Gx（检测垂直边缘）
                // Sobel算子：[-1  0 +1]
                //            [-2  0 +2]
                //            [-1  0 +1]
                const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
                
                // 计算垂直梯度Gy（检测水平边缘）
                // Sobel算子：[-1 -2 -1]
                //            [ 0  0  0]
                //            [+1 +2 +1]
                const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;

                // 计算梯度幅值：|G| = sqrt(Gx² + Gy²)
                // 幅值越大，表示亮度变化越剧烈，越可能是边缘
                gradient[idx] = Math.sqrt(gx * gx + gy * gy);
                
                // 计算梯度方向：θ = atan2(Gy, Gx)
                // 方向表示亮度变化的方向（垂直于边缘方向）
                direction[idx] = Math.atan2(gy, gx);
            }
        }

        // ==================== 步骤4：非极大值抑制 ====================
        // 细化边缘，只保留梯度方向上的局部最大值
        // 目的：将边缘从"粗线"变成"细线"，精确定位边缘位置
        const suppressed = new Float32Array(width * height);
        
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                const angle = direction[idx]; // 当前像素的梯度方向
                const mag = gradient[idx];    // 当前像素的梯度幅值

                // 将角度归一化到[0, π)范围
                // 因为边缘方向是双向的（0°和180°是同一条边缘）
                const normAngle = ((angle % Math.PI) + Math.PI) % Math.PI;
                let neighbor1 = 0, neighbor2 = 0;

                // 根据梯度方向，确定需要比较的两个邻居像素
                // 梯度方向垂直于边缘方向，所以沿着梯度方向比较
                if ((normAngle >= 0 && normAngle < Math.PI / 8) ||
                    (normAngle >= 7 * Math.PI / 8 && normAngle < Math.PI)) {
                    // 方向接近水平（0°）：比较左右邻居
                    neighbor1 = gradient[idx - 1];
                    neighbor2 = gradient[idx + 1];
                } else if (normAngle >= Math.PI / 8 && normAngle < 3 * Math.PI / 8) {
                    // 方向接近45°：比较右上和左下邻居
                    neighbor1 = gradient[(y - 1) * width + (x + 1)];
                    neighbor2 = gradient[(y + 1) * width + (x - 1)];
                } else if (normAngle >= 3 * Math.PI / 8 && normAngle < 5 * Math.PI / 8) {
                    // 方向接近垂直（90°）：比较上下邻居
                    neighbor1 = gradient[(y - 1) * width + x];
                    neighbor2 = gradient[(y + 1) * width + x];
                } else {
                    // 方向接近135°：比较左上和右下邻居
                    neighbor1 = gradient[(y - 1) * width + (x - 1)];
                    neighbor2 = gradient[(y + 1) * width + (x + 1)];
                }

                // 如果当前像素的梯度幅值大于等于两个邻居，则保留
                // 否则抑制（设为0），这样边缘就变细了
                if (mag >= neighbor1 && mag >= neighbor2) {
                    suppressed[idx] = mag;
                }
            }
        }
        // return suppressed;

        // ==================== 步骤5：双阈值检测 ====================
        // 使用两个阈值将像素分为三类：强边缘、弱边缘、非边缘
        const edges = new Uint8ClampedArray(width * height);
        const highThreshold = 40; // 高阈值：确定是边缘
        const lowThreshold = 15;   // 低阈值：可能是边缘

        // 第一遍：标记所有强边缘（梯度幅值 >= 高阈值）
        for (let i = 0; i < gradient.length; i++) {
            if (gradient[i] >= highThreshold) {
                edges[i] = 255; // 标记为边缘
            }
        }
        // return edges;

        // ==================== 步骤6：边缘连接（滞后跟踪） ====================
        // 将弱边缘连接到强边缘
        // 如果弱边缘与强边缘相连，则认为是真实边缘的一部分
        let changed = true;
        while (changed) {
            changed = false;
            // 遍历所有像素
            for (let y = 1; y < height - 1; y++) {
                for (let x = 1; x < width - 1; x++) {
                    const idx = y * width + x;
                    // 如果当前像素已经是强边缘
                    if (edges[idx] === 255) {
                        // 检查8邻域
                        for (let dy = -1; dy <= 1; dy++) {
                            for (let dx = -1; dx <= 1; dx++) {
                                const nidx = (y + dy) * width + (x + dx);
                                // 如果邻居是弱边缘（低阈值 <= 梯度 < 高阈值）且尚未标记为边缘
                                if (gradient[nidx] >= lowThreshold && edges[nidx] === 0) {
                                    edges[nidx] = 255; // 将弱边缘提升为强边缘
                                    changed = true;    // 标记有变化，需要继续迭代
                                }
                            }
                        }
                    }
                }
            }
        }
        // 迭代直到没有新的弱边缘被连接为止
        // 最终结果：连续的边缘线条

        this.edgeData = edges;
        return edges;
    }

    /**
     * 使用OpenCV.js检测物体边缘轮廓（Canny边缘检测）
     * 基于OpenCV.js的WebAssembly实现，性能优于纯JS手写版本
     *
     * 使用前需确保OpenCV.js已加载，可通过以下方式引入：
     * 1. CDN方式：在HTML中添加 <script async src="https://docs.opencv.org/4.x/opencv.js" type="text/javascript"></script>
     * 2. NPM方式：npm install @techstark/opencv-js
     *
     * OpenCV Canny算法内部流程（由WASM原生执行，速度更快）：
     * 1. cvtColor：将RGBA转为灰度图
     * 2. GaussianBlur：5x5高斯核去噪，sigma=1.4
     * 3. Sobel：计算梯度幅值和方向（3x3算子）
     * 4. 非极大值抑制：细化边缘为单像素宽
     * 5. 双阈值检测 + 滞后跟踪：连接弱边缘到强边缘
     *
     * @param {ImageData} imageData - 图像数据
     * @param {Object} options - 可选参数
     * @param {number} options.lowThreshold - 低阈值，默认15（控制弱边缘灵敏度）
     * @param {number} options.highThreshold - 高阈值，默认40（控制强边缘判定）
     * @param {number} options.blurKernelSize - 高斯模糊核大小，默认5（必须为奇数）
     * @param {number} options.blurSigma - 高斯模糊标准差，默认0（由核大小自动计算）
     * @returns {Uint8ClampedArray|null} 边缘图（255=边缘，0=非边缘），OpenCV未加载时返回null
     */
    detectEdgesWithOpenCV(imageData, options = {}) {
        // 检查OpenCV.js是否已加载
        // OpenCV加载后会在全局挂载cv对象，且包含Mat类
        if (typeof cv === 'undefined' || !cv.Mat) {
            console.warn('OpenCV.js未加载，无法使用detectEdgesWithOpenCV。请在HTML中引入opencv.js');
            return null;
        }

        const width = imageData.width;
        const height = imageData.height;

        // 解析可选参数，提供默认值
        const lowThreshold = options.lowThreshold ?? 15;   // 低阈值：弱边缘的下限
        const highThreshold = options.highThreshold ?? 40;  // 高阈值：强边缘的下限
        const blurKernelSize = options.blurKernelSize ?? 5; // 高斯模糊核大小（奇数）
        const blurSigma = options.blurSigma ?? 0;           // sigma=0时由核大小自动推算
        console.log('lowThreshold', lowThreshold);
        console.log('highThreshold', highThreshold);
        console.log('blurKernelSize', blurKernelSize);
        console.log('blurSigma', blurSigma);

        // ==================== 步骤1：将ImageData转为OpenCV Mat对象 ====================
        // ImageData.data是RGBA格式的Uint8ClampedArray
        // cv.Mat构造函数：new cv.Mat(rows, cols, type)
        // CV_8UC4 = 4通道8位无符号整数（对应RGBA）
        const src = new cv.Mat(height, width, cv.CV_8UC4);
        // 将ImageData的像素数据拷贝到Mat中
        src.data.set(imageData.data);

        // ==================== 步骤2：灰度转换 ====================
        // 将RGBA彩色图转为单通道灰度图
        // cvtColor是OpenCV的颜色空间转换函数
        // COLOR_RGBA2GRAY = 将RGBA转为灰度（内部使用加权平均：0.299R + 0.587G + 0.114B）
        const gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

        // ==================== 步骤3：高斯模糊去噪 ====================
        // 使用高斯滤波器平滑灰度图，消除噪声干扰
        // GaussianBlur参数：
        //   - gray：输入灰度图
        //   - blurred：输出模糊图
        //   - new cv.Size(ksize, ksize)：高斯核尺寸（必须为正奇数）
        //   - sigmaX：X方向标准差，0表示由核大小自动计算
        const blurred = new cv.Mat();
        cv.GaussianBlur(gray, blurred, new cv.Size(blurKernelSize, blurKernelSize), blurSigma);

        // ==================== 步骤4：Canny边缘检测 ====================
        // OpenCV的Canny函数内部自动完成：
        //   a) Sobel算子计算梯度幅值和方向
        //   b) 非极大值抑制（细化边缘）
        //   c) 双阈值分类（强边缘 >= highThreshold，弱边缘 >= lowThreshold）
        //   d) 滞后跟踪（将连接到强边缘的弱边缘保留，其余丢弃）
        // Canny参数：
        //   - blurred：输入图像（必须是单通道灰度图）
        //   - edges：输出边缘图（二值图，边缘像素=255，非边缘=0）
        //   - threshold1：低阈值（弱边缘下限）
        //   - threshold2：高阈值（强边缘下限）
        const edges = new cv.Mat();
        cv.Canny(blurred, edges, lowThreshold, highThreshold);

        // ==================== 步骤5：将OpenCV Mat转为Uint8ClampedArray ====================
        // edges是CV_8UC1类型（单通道8位），每个像素值0或255
        // 直接拷贝Mat.data到新的Uint8ClampedArray
        const result = new Uint8ClampedArray(width * height);
        result.set(edges.data);

        // ==================== 步骤6：释放OpenCV Mat内存 ====================
        // OpenCV.js使用WebAssembly管理内存，Mat对象不会自动垃圾回收
        // 必须手动调用delete()释放，否则会导致内存泄漏
        src.delete();
        gray.delete();
        blurred.delete();
        edges.delete();

        // 保存边缘数据到实例属性，供后续阴影检测使用
        this.edgeData = result;
        return result;
    }

    /**
     * 检查OpenCV.js是否已加载并可用
     * @returns {boolean} OpenCV.js是否可用
     */
    isOpenCVReady() {

        if (typeof cv !== 'undefined' && cv.Mat !== undefined) {
            return true;
        } else {
            console.warn('OpenCV.js未加载，无法使用detectEdgesWithOpenCV。请在HTML中引入opencv.js');
            return false;
        }
    }

    /**
     * 应用高斯模糊
     * @param {Float32Array} gray - 灰度数组
     * @param {number} width - 宽度
     * @param {number} height - 高度
     * @param {number} sigma - 标准差
     * @returns {Float32Array} 模糊后的数组
     */
    applyGaussianBlur(gray, width, height, sigma) {
        const kernelSize = Math.ceil(sigma * 6) | 1;
        const halfSize = Math.floor(kernelSize / 2);
        const kernel = new Float32Array(kernelSize);

        let sum = 0;
        for (let i = 0; i < kernelSize; i++) {
            const x = i - halfSize;
            kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
            sum += kernel[i];
        }
        for (let i = 0; i < kernelSize; i++) {
            kernel[i] /= sum;
        }

        const temp = new Float32Array(width * height);
        const result = new Float32Array(width * height);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let val = 0;
                for (let i = 0; i < kernelSize; i++) {
                    const nx = x + i - halfSize;
                    if (nx >= 0 && nx < width) {
                        val += gray[y * width + nx] * kernel[i];
                    }
                }
                temp[y * width + x] = val;
            }
        }

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let val = 0;
                for (let i = 0; i < kernelSize; i++) {
                    const ny = y + i - halfSize;
                    if (ny >= 0 && ny < height) {
                        val += temp[ny * width + x] * kernel[i];
                    }
                }
                result[y * width + x] = val;
            }
        }

        return result;
    }

    /**
     * 连接离散边缘点形成连续边缘曲线
     * 通过形态学闭运算填补小间隙，再通过端点检测和Bresenham连线连接断裂边缘
     * @param {Uint8ClampedArray} edges - 原始边缘检测结果
     * @param {number} width - 宽度
     * @param {number} height - 高度
     * @param {number} connectRadius - 端点连接搜索半径
     * @returns {Uint8ClampedArray} 连接后的边缘曲线
     */
    connectEdgeCurves(edges, width, height, connectRadius = 8) {
        const connected = new Uint8ClampedArray(edges);

        this.morphClose(connected, width, height, 5);

        const endpoints = this.findEdgeEndpoints(connected, width, height);

        for (let i = 0; i < endpoints.length; i++) {
            for (let j = i + 1; j < endpoints.length; j++) {
                const p1 = endpoints[i];
                const p2 = endpoints[j];
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist > 0 && dist <= connectRadius) {
                    this.drawLine(connected, width, height, p1.x, p1.y, p2.x, p2.y);
                }
            }
        }

        return connected;
    }

    /**
     * 形态学闭运算（先膨胀后腐蚀），填补边缘中的小间隙
     * @param {Uint8ClampedArray} data - 边缘数据（原地修改）
     * @param {number} width - 宽度
     * @param {number} height - 高度
     * @param {number} radius - 结构元素半径
     */
    morphClose(data, width, height, radius) {
        this.morphDilate(data, width, height, radius);
        this.morphErode(data, width, height, radius-2);  // 这里减2是因为腐蚀不能又腐蚀回原边界
    }

    /**
     * 形态学膨胀
     * @param {Uint8ClampedArray} data - 边缘数据（原地修改）
     * @param {number} width - 宽度
     * @param {number} height - 高度
     * @param {number} radius - 结构元素半径
     */
    morphDilate(data, width, height, radius) {
        const temp = new Uint8ClampedArray(data);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (temp[y * width + x] === 0) continue;
                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        if (dx * dx + dy * dy > radius * radius) continue;
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            data[ny * width + nx] = 255;
                        }
                    }
                }
            }
        }
    }

    /**
     * 形态学腐蚀  TODO: 这个函数应该实现为用8个方向长条形的结构体进行腐蚀
     * @param {Uint8ClampedArray} data - 边缘数据（原地修改）
     * @param {number} width - 宽度
     * @param {number} height - 高度
     * @param {number} radius - 结构元素半径
     */
    morphErode(data, width, height, radius) {
        const temp = new Uint8ClampedArray(data);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (temp[y * width + x] === 0) continue;
                let allPresent = true;
                for (let dy = -radius; dy <= radius && allPresent; dy++) {
                    for (let dx = -radius; dx <= radius && allPresent; dx++) {
                        if (dx * dx + dy * dy > radius * radius) continue;
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            if (temp[ny * width + nx] === 0) {
                                allPresent = false;
                            }
                        }
                    }
                }
                if (!allPresent) {
                    data[y * width + x] = 0;
                }
            }
        }
    }

    /**
     * 查找边缘端点（8邻域中仅有1个边缘邻居的像素）
     * @param {Uint8ClampedArray} edges - 边缘数据
     * @param {number} width - 宽度
     * @param {number} height - 高度
     * @returns {Array} 端点数组 [{x, y}, ...]
     */
    findEdgeEndpoints(edges, width, height) {
        const endpoints = [];
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                if (edges[y * width + x] === 0) continue;

                let neighbors = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        if (edges[(y + dy) * width + (x + dx)] > 0) neighbors++;
                    }
                }

                if (neighbors === 1) {
                    endpoints.push({ x, y });
                }
            }
        }
        return endpoints;
    }

    /**
     * 使用Bresenham算法在边缘图上画线，连接两个端点
     * @param {Uint8ClampedArray} data - 边缘数据（原地修改）
     * @param {number} width - 宽度
     * @param {number} height - 高度
     * @param {number} x0 - 起点X
     * @param {number} y0 - 起点Y
     * @param {number} x1 - 终点X
     * @param {number} y1 - 终点Y
     */
    drawLine(data, width, height, x0, y0, x1, y1) {
        const dx = Math.abs(x1 - x0);
        const dy = Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1;
        const sy = y0 < y1 ? 1 : -1;
        let err = dx - dy;

        while (true) {
            if (x0 >= 0 && x0 < width && y0 >= 0 && y0 < height) {
                data[y0 * width + x0] = 255;
            }
            if (x0 === x1 && y0 === y1) break;
            const e2 = 2 * err;
            if (e2 > -dy) {
                err -= dy;
                x0 += sx;
            }
            if (e2 < dx) {
                err += dx;
                y0 += sy;
            }
        }
    }

    /**
     * 计算边缘感知的距离图
     * 从前景边界像素出发，BFS向外生长，遇到边缘曲线则停止
     * 确保阴影检测不会越过物体边界
     * @param {Uint8ClampedArray} mask - 二值蒙版（255=前景/选中，0=背景）
     * @param {Uint8ClampedArray} edgeCurves - 连接后的边缘曲线（255=边缘，0=非边缘）
     * @param {number} width - 宽度
     * @param {number} height - 高度
     * @param {number} maxDistance - 最大阴影距离
     * @returns {Float32Array} 距离图（INF=不可达，被边缘曲线阻断）
     */
    computeEdgeAwareDistanceMap(mask, edgeCurves, width, height, maxDistance) {
        const INF = width + height;
        const distanceMap = new Float32Array(width * height);
        distanceMap.fill(INF);

        const visited = new Uint8ClampedArray(width * height);

        const foregroundBoundary = this.extractForegroundBoundary(mask, width, height);

        const queue = [];
        for (let i = 0; i < foregroundBoundary.length; i++) {
            if (foregroundBoundary[i] > 0) {
                distanceMap[i] = 0;
                visited[i] = 1;
                queue.push(i);
            }
        }

        const dx8 = [-1, 1, 0, 0, -1, -1, 1, 1];
        const dy8 = [0, 0, -1, 1, -1, 1, -1, 1];
        const dist8 = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

        let head = 0;
        while (head < queue.length) {
            const idx = queue[head++];
            const x = idx % width;
            const y = Math.floor(idx / width);
            const currentDist = distanceMap[idx];

            if (currentDist >= maxDistance) continue;

            for (let d = 0; d < 8; d++) {
                const nx = x + dx8[d];
                const ny = y + dy8[d];

                if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

                const nidx = ny * width + nx;

                if (visited[nidx]) continue;

                if (mask[nidx] > 0) continue;

                if (edgeCurves[nidx] > 0 && foregroundBoundary[nidx] === 0) {
                    visited[nidx] = 1;
                    continue;
                }

                const newDist = currentDist + dist8[d];
                if (newDist < distanceMap[nidx]) {
                    distanceMap[nidx] = newDist;
                    visited[nidx] = 1;
                    queue.push(nidx);
                }
            }
        }

        return distanceMap;
    }

    /**
     * 提取前景蒙版的边界像素
     * 前景像素中至少有一个8邻域邻居为背景的像素
     * @param {Uint8ClampedArray} mask - 二值蒙版（255=前景，0=背景）
     * @param {number} width - 宽度
     * @param {number} height - 高度
     * @returns {Uint8ClampedArray} 边界图（255=边界像素）
     */
    extractForegroundBoundary(mask, width, height) {
        const boundary = new Uint8ClampedArray(width * height);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (mask[idx] === 0) continue;

                let isBoundary = false;
                for (let dy = -1; dy <= 1 && !isBoundary; dy++) {
                    for (let dx = -1; dx <= 1 && !isBoundary; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
                            isBoundary = true;
                        } else if (mask[ny * width + nx] === 0) {
                            isBoundary = true;
                        }
                    }
                }

                if (isBoundary) {
                    boundary[idx] = 255;
                }
            }
        }

        return boundary;
    }

    /**
     * 检测阴影区域（在背景区域中，物体边缘以外）
     * 使用边缘感知距离变换，从前景边界向外生长，遇到边缘曲线则停止
     * @param {Uint8ClampedArray} mask - 当前前景蒙版（255=前景/选中，0=背景）
     * @param {Uint8ClampedArray} edges - 边缘检测结果（255=边缘，0=非边缘）
     * @param {Object} options - 处理参数
     * @param {number} options.maxDistance - 最大阴影距离（像素）
     * @param {number} options.shadowDiff - 阴影差异度 0-100
     * @returns {Uint8ClampedArray} 阴影蒙版（255=阴影，0=非阴影）
     */
    detectShadows(mask, edges, options = {}) {
        const maxDistance = options.maxDistance ?? 60;
        const shadowDiff = options.shadowDiff ?? 50;

        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        const imageData = canvasUtils.getImageData(this.mainCanvas);

        this.bgColor = this.detectBackgroundColor(imageData);
        const bgBrightness = (this.bgColor.r + this.bgColor.g + this.bgColor.b) / 3;

        // const edgeCurves = this.connectEdgeCurves(edges, width, height);
        const edgeCurves = edges;

        const distanceMap = this.computeEdgeAwareDistanceMap(
            mask, edgeCurves, width, height, maxDistance
        );

        const minColorDiff = 5 + (1 - shadowDiff / 100) * 20;
        const maxColorDiff = Math.min(120, shadowDiff);

        const shadowMask = new Uint8ClampedArray(width * height);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;

                if (mask[idx] > 0) continue;

                const distance = distanceMap[idx];
                const INF = width + height;
                if (distance <= 0 || distance >= INF || distance > maxDistance) continue;

                const pixel = canvasUtils.getPixelColor(imageData, x, y);

                const colorDiff = canvasUtils.colorDistance(pixel, this.bgColor);

                if (colorDiff > maxColorDiff) continue;

                const grayness = this.calculateGrayness(pixel);
                if (grayness < 0.5) continue;

                const pixelBrightness = (pixel.r + pixel.g + pixel.b) / 3;
                if (pixelBrightness > bgBrightness) continue;

                shadowMask[idx] = 255;
            }
        }

        this.filterIsolatedShadow(shadowMask, width, height, 3);

        return shadowMask;
    }

    /**
     * 计算背景像素到最近前景边缘的距离图（无边缘约束的简单版本）
     * @param {Uint8ClampedArray} mask - 二值蒙版（255=前景，0=背景）
     * @param {number} width - 宽度
     * @param {number} height - 高度
     * @returns {Float32Array} 距离图
     */
    computeBackgroundDistanceMap(mask, width, height) {
        const distanceMap = new Float32Array(width * height);
        const INF = width + height;

        for (let i = 0; i < mask.length; i++) {
            distanceMap[i] = mask[i] > 0 ? 0 : INF;
        }

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (mask[idx] > 0) continue;

                let minDist = distanceMap[idx];
                if (x > 0) minDist = Math.min(minDist, distanceMap[idx - 1] + 1);
                if (y > 0) minDist = Math.min(minDist, distanceMap[idx - width] + 1);
                if (x > 0 && y > 0) minDist = Math.min(minDist, distanceMap[idx - width - 1] + Math.SQRT2);
                if (x < width - 1 && y > 0) minDist = Math.min(minDist, distanceMap[idx - width + 1] + Math.SQRT2);
                distanceMap[idx] = minDist;
            }
        }

        for (let y = height - 1; y >= 0; y--) {
            for (let x = width - 1; x >= 0; x--) {
                const idx = y * width + x;
                if (mask[idx] > 0) continue;

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
     * 过滤孤立的阴影像素（连通性过滤）
     * @param {Uint8ClampedArray} shadowMask - 阴影蒙版
     * @param {number} width - 宽度
     * @param {number} height - 高度
     * @param {number} minNeighbors - 最小邻居数
     */
    filterIsolatedShadow(shadowMask, width, height, minNeighbors) {
        const temp = new Uint8ClampedArray(shadowMask);

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                if (temp[idx] === 0) continue;

                let neighbors = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        const nidx = (y + dy) * width + (x + dx);
                        if (temp[nidx] > 0) neighbors++;
                    }
                }

                if (neighbors < minNeighbors) {
                    shadowMask[idx] = 0;
                }
            }
        }
    }

    /**
     * 检测背景色（从图像边缘采样 + K-Means聚类）
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
     * 计算阴影区域的alpha值
     * 根据颜色差异和距离衰减计算每个阴影像素的半透明度
     * @param {Uint8ClampedArray} shadowMask - 阴影蒙版
     * @param {Uint8ClampedArray} mask - 前景蒙版（255=前景，0=背景）
     * @param {number} intensity - 阴影透明度 0-100
     * @returns {Uint8ClampedArray} alpha蒙版（每个阴影像素的alpha值 0-255）
     */
    calculateShadowAlpha(shadowMask, mask, intensity) {
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        const imageData = canvasUtils.getImageData(this.mainCanvas);
        const intensityFactor = intensity / 100;

        const distanceMap = this.computeBackgroundDistanceMap(mask, width, height);
        let maxDist = 1;
        for (let i = 0; i < distanceMap.length; i++) {
            if (distanceMap[i] > maxDist && distanceMap[i] < width + height) {
                maxDist = distanceMap[i];
            }
        }

        const alphaMask = new Uint8ClampedArray(width * height);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;

                if (shadowMask[idx] === 0) continue;

                const pixel = canvasUtils.getPixelColor(imageData, x, y);
                const colorDiff = canvasUtils.colorDistance(pixel, this.bgColor);
                const distance = distanceMap[idx];

                const alphaBase = Math.min(1, colorDiff / 80);

                const edgeFade = Math.max(0, 1 - distance / maxDist);
                const smoothFade = edgeFade * edgeFade * (3 - 2 * edgeFade);

                const alpha = alphaBase * smoothFade * intensityFactor;
                alphaMask[idx] = Math.round(alpha * 255);
            }
        }

        return alphaMask;
    }

    /**
     * 应用阴影处理到画布
     * 紫色选区（foregroundMask>0）完全抠除，粉色选区（shadowAlphaMask>0）半透明抠除，其余保持原样
     * @param {Uint8ClampedArray} foregroundMask - 前景蒙版（紫色选区，255=待完全抠除的区域）
     * @param {Uint8ClampedArray} shadowAlphaMask - 阴影alpha蒙版（粉色选区，0-255灰度值表示抠除程度）
     */
    applyToCanvas(foregroundMask, shadowAlphaMask) {
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        const imageData = canvasUtils.getImageData(this.mainCanvas);

        for (let i = 0; i < foregroundMask.length; i++) {
            const idx = i * 4;

            if (foregroundMask[i] > 0) {
                imageData.data[idx + 3] = 0;
            } else if (shadowAlphaMask[i] > 0) {
                imageData.data[idx + 3] = 255 - shadowAlphaMask[i];
            }
        }

        canvasUtils.putImageData(this.mainCanvas, imageData);
    }
}
