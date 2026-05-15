/**
 * Canvas工具函数模块
 * 提供Canvas操作的通用工具函数
 */

/**
 * 获取Canvas上下文
 * @param {HTMLCanvasElement} canvas - Canvas元素
 * @param {string} type - 上下文类型
 * @returns {CanvasRenderingContext2D} Canvas上下文
 */
export function getContext(canvas, type = '2d') {
    return canvas.getContext(type);
}

/**
 * 设置Canvas尺寸
 * @param {HTMLCanvasElement} canvas - Canvas元素
 * @param {number} width - 宽度
 * @param {number} height - 高度
 */
export function setCanvasSize(canvas, width, height) {
    canvas.width = width;
    canvas.height = height;
}

/**
 * 清空Canvas
 * @param {HTMLCanvasElement} canvas - Canvas元素
 */
export function clearCanvas(canvas) {
    const ctx = getContext(canvas);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/**
 * 在Canvas上绘制图片
 * @param {HTMLCanvasElement} canvas - Canvas元素
 * @param {HTMLImageElement} image - 图片元素
 * @param {number} x - X坐标
 * @param {number} y - Y坐标
 * @param {number} width - 宽度
 * @param {number} height - 高度
 */
export function drawImage(canvas, image, x = 0, y = 0, width = image.width, height = image.height) {
    const ctx = getContext(canvas);
    ctx.drawImage(image, x, y, width, height);
}

/**
 * 获取Canvas图像数据
 * @param {HTMLCanvasElement} canvas - Canvas元素
 * @returns {ImageData} 图像数据
 */
export function getImageData(canvas) {
    const ctx = getContext(canvas);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * 设置Canvas图像数据
 * @param {HTMLCanvasElement} canvas - Canvas元素
 * @param {ImageData} imageData - 图像数据
 */
export function putImageData(canvas, imageData) {
    const ctx = getContext(canvas);
    ctx.putImageData(imageData, 0, 0);
}

/**
 * 创建临时Canvas
 * @param {number} width - 宽度
 * @param {number} height - 高度
 * @returns {HTMLCanvasElement} 临时Canvas元素
 */
export function createTempCanvas(width, height) {
    const canvas = document.createElement('canvas');
    setCanvasSize(canvas, width, height);
    return canvas;
}

/**
 * 克隆Canvas
 * @param {HTMLCanvasElement} source - 源Canvas
 * @returns {HTMLCanvasElement} 克隆的Canvas
 */
export function cloneCanvas(source) {
    const canvas = createTempCanvas(source.width, source.height);
    const ctx = getContext(canvas);
    ctx.drawImage(source, 0, 0);
    return canvas;
}

/**
 * 获取像素颜色
 * @param {ImageData} imageData - 图像数据
 * @param {number} x - X坐标
 * @param {number} y - Y坐标
 * @returns {Object} RGBA颜色对象
 */
export function getPixelColor(imageData, x, y) {
    const index = (y * imageData.width + x) * 4;
    return {
        r: imageData.data[index],
        g: imageData.data[index + 1],
        b: imageData.data[index + 2],
        a: imageData.data[index + 3]
    };
}

/**
 * 设置像素颜色
 * @param {ImageData} imageData - 图像数据
 * @param {number} x - X坐标
 * @param {number} y - Y坐标
 * @param {Object} color - RGBA颜色对象
 */
export function setPixelColor(imageData, x, y, color) {
    const index = (y * imageData.width + x) * 4;
    imageData.data[index] = color.r;
    imageData.data[index + 1] = color.g;
    imageData.data[index + 2] = color.b;
    imageData.data[index + 3] = color.a !== undefined ? color.a : 255;
}

/**
 * 计算两个颜色之间的距离
 * @param {Object} color1 - 颜色1
 * @param {Object} color2 - 颜色2
 * @returns {number} 颜色距离
 */
export function colorDistance(color1, color2) {
    const dr = color1.r - color2.r;
    const dg = color1.g - color2.g;
    const db = color1.b - color2.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * 检查坐标是否在Canvas范围内
 * @param {HTMLCanvasElement} canvas - Canvas元素
 * @param {number} x - X坐标
 * @param {number} y - Y坐标
 * @returns {boolean} 是否在范围内
 */
export function isInBounds(canvas, x, y) {
    return x >= 0 && x < canvas.width && y >= 0 && y < canvas.height;
}

/**
 * 获取Canvas相对于鼠标事件的坐标
 * @param {HTMLCanvasElement} canvas - Canvas元素
 * @param {MouseEvent} event - 鼠标事件
 * @returns {Object} 坐标对象
 */
export function getMousePos(canvas, event) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    return {
        x: Math.floor((event.clientX - rect.left) * scaleX),
        y: Math.floor((event.clientY - rect.top) * scaleY)
    };
}

/**
 * 绘制选区蒙版
 * @param {HTMLCanvasElement} canvas - Canvas元素
 * @param {Uint8ClampedArray} mask - 选区蒙版
 * @param {string} color - 蒙版颜色
 * @param {number} opacity - 透明度
 */
export function drawSelectionMask(canvas, mask, color = 'rgba(99, 102, 241, 0.5)', opacity = 0.5) {
    const ctx = getContext(canvas);
    const imageData = getImageData(canvas);
    
    for (let i = 0; i < mask.length; i++) {
        if (mask[i] > 0) {
            const index = i * 4;
            imageData.data[index] = 99;     // R
            imageData.data[index + 1] = 102; // G
            imageData.data[index + 2] = 241; // B
            imageData.data[index + 3] = Math.floor(255 * opacity); // A
        }
    }
    
    putImageData(canvas, imageData);
}

/**
 * 应用选区到图像
 * @param {HTMLCanvasElement} sourceCanvas - 源Canvas
 * @param {HTMLCanvasElement} targetCanvas - 目标Canvas
 * @param {Uint8ClampedArray} mask - 选区蒙码
 * @param {boolean} inverse - 是否反选
 */
export function applyMask(sourceCanvas, targetCanvas, mask, inverse = false) {
    const ctx = getContext(targetCanvas);
    setCanvasSize(targetCanvas, sourceCanvas.width, sourceCanvas.height);
    
    const sourceData = getImageData(sourceCanvas);
    const targetData = ctx.createImageData(sourceCanvas.width, sourceCanvas.height);
    
    for (let i = 0; i < mask.length; i++) {
        const index = i * 4;
        const isSelected = mask[i] > 0;
        const shouldKeep = inverse ? !isSelected : isSelected;
        
        if (shouldKeep) {
            targetData.data[index] = sourceData.data[index];
            targetData.data[index + 1] = sourceData.data[index + 1];
            targetData.data[index + 2] = sourceData.data[index + 2];
            targetData.data[index + 3] = sourceData.data[index + 3];
        } else {
            targetData.data[index] = 0;
            targetData.data[index + 1] = 0;
            targetData.data[index + 2] = 0;
            targetData.data[index + 3] = 0;
        }
    }
    
    putImageData(targetCanvas, targetData);
}

/**
 * 将Canvas转换为Blob
 * @param {HTMLCanvasElement} canvas - Canvas元素
 * @param {string} type - 图片类型
 * @param {number} quality - 图片质量
 * @returns {Promise<Blob>} Blob对象
 */
export function canvasToBlob(canvas, type = 'image/png', quality = 1) {
    return new Promise((resolve) => {
        canvas.toBlob(resolve, type, quality);
    });
}

/**
 * 将Canvas转换为DataURL
 * @param {HTMLCanvasElement} canvas - Canvas元素
 * @param {string} type - 图片类型
 * @param {number} quality - 图片质量
 * @returns {string} DataURL
 */
export function canvasToDataURL(canvas, type = 'image/png', quality = 1) {
    return canvas.toDataURL(type, quality);
}

/**
 * 创建棋盘格背景（用于透明区域显示）
 * @param {number} width - 宽度
 * @param {number} height - 高度
 * @param {number} cellSize - 格子大小
 * @returns {HTMLCanvasElement} 棋盘格Canvas
 */
export function createCheckerboard(width, height, cellSize = 10) {
    const canvas = createTempCanvas(width, height);
    const ctx = getContext(canvas);
    
    for (let y = 0; y < height; y += cellSize) {
        for (let x = 0; x < width; x += cellSize) {
            const isEven = ((x / cellSize) + (y / cellSize)) % 2 === 0;
            ctx.fillStyle = isEven ? '#ffffff' : '#e0e0e0';
            ctx.fillRect(x, y, cellSize, cellSize);
        }
    }
    
    return canvas;
}
