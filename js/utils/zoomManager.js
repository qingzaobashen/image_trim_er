/**
 * 缩放管理器模块
 * 处理Canvas的缩放、平移和坐标转换
 */

/**
 * 缩放管理器类
 */
export class ZoomManager {
    /**
     * 构造函数
     * @param {HTMLCanvasElement} mainCanvas - 主Canvas
     * @param {HTMLCanvasElement} overlayCanvas - 覆盖层Canvas
     * @param {HTMLElement} wrapper - 包裹容器
     */
    constructor(mainCanvas, overlayCanvas, wrapper) {
        this.mainCanvas = mainCanvas;
        this.overlayCanvas = overlayCanvas;
        this.wrapper = wrapper;
        
        this.scale = 1;
        this.minScale = 0.1;
        this.maxScale = 10;
        this.scaleStep = 0.1;
        
        this.offsetX = 0;
        this.offsetY = 0;
        
        this.isDragging = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        
        this.onZoomChange = null;
        
        this.init();
    }

    /**
     * 初始化缩放管理器
     */
    init() {
        this.bindEvents();
    }

    /**
     * 绑定事件
     */
    bindEvents() {
        this.wrapper.addEventListener('wheel', (e) => this.handleWheel(e));
        this.wrapper.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.wrapper.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.wrapper.addEventListener('mouseup', () => this.handleMouseUp());
        this.wrapper.addEventListener('mouseleave', () => this.handleMouseUp());
    }

    /**
     * 处理滚轮事件
     * @param {WheelEvent} e - 滚轮事件
     */
    handleWheel(e) {
        e.preventDefault();
        
        const rect = this.wrapper.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        
        const isPinchZoom = e.ctrlKey && !e.metaKey;
        
        const isLikelyTouchpad = Math.abs(e.deltaY) < 50 || Math.abs(e.deltaX) > 0;
        
        if (isPinchZoom) {
            const delta = -e.deltaY * 0.01;
            const newScale = Math.max(this.minScale, Math.min(this.maxScale, this.scale + delta));
            
            if (newScale !== this.scale) {
                const scaleRatio = newScale / this.scale;
                
                const mouseOffsetX = mouseX - centerX;
                const mouseOffsetY = mouseY - centerY;
                
                this.offsetX = mouseOffsetX - (mouseOffsetX - this.offsetX) * scaleRatio;
                this.offsetY = mouseOffsetY - (mouseOffsetY - this.offsetY) * scaleRatio;
                
                this.scale = newScale;
                this.applyTransform();
                this.notifyZoomChange();
            }
        } else if (isLikelyTouchpad) {
            this.offsetX -= e.deltaX;
            this.offsetY -= e.deltaY;
            this.applyTransform();
        } else {
            const delta = e.deltaY > 0 ? -this.scaleStep : this.scaleStep;
            const newScale = Math.max(this.minScale, Math.min(this.maxScale, this.scale + delta));
            
            if (newScale !== this.scale) {
                const scaleRatio = newScale / this.scale;
                
                const mouseOffsetX = mouseX - centerX;
                const mouseOffsetY = mouseY - centerY;
                
                this.offsetX = mouseOffsetX - (mouseOffsetX - this.offsetX) * scaleRatio;
                this.offsetY = mouseOffsetY - (mouseOffsetY - this.offsetY) * scaleRatio;
                
                this.scale = newScale;
                this.applyTransform();
                this.notifyZoomChange();
            }
        }
    }

    /**
     * 处理鼠标按下
     * @param {MouseEvent} e - 鼠标事件
     */
    handleMouseDown(e) {
        if (e.button === 1 || (e.button === 0 && e.altKey)) {
            this.isDragging = true;
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
            this.wrapper.style.cursor = 'grabbing';
            e.preventDefault();
        }
    }

    /**
     * 处理鼠标移动
     * @param {MouseEvent} e - 鼠标事件
     */
    handleMouseMove(e) {
        if (!this.isDragging) return;
        
        const deltaX = e.clientX - this.lastMouseX;
        const deltaY = e.clientY - this.lastMouseY;
        
        this.offsetX += deltaX;
        this.offsetY += deltaY;
        
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        
        this.applyTransform();
    }

    /**
     * 处理鼠标抬起
     */
    handleMouseUp() {
        this.isDragging = false;
        this.wrapper.style.cursor = '';
    }

    /**
     * 应用变换
     */
    applyTransform() {
        const transform = `translate(-50%, -50%) translate(${this.offsetX}px, ${this.offsetY}px) scale(${this.scale})`;
        this.mainCanvas.style.transform = transform;
        this.overlayCanvas.style.transform = transform;
    }

    /**
     * 设置缩放比例
     * @param {number} scale - 缩放比例
     * @param {boolean} center - 是否居中
     */
    setScale(scale, center = true) {
        this.scale = Math.max(this.minScale, Math.min(this.maxScale, scale));
        
        if (center) {
            this.centerCanvas();
        }
        
        this.applyTransform();
        this.notifyZoomChange();
    }

    /**
     * 放大
     */
    zoomIn() {
        this.setScale(this.scale + this.scaleStep, false);
    }

    /**
     * 缩小
     */
    zoomOut() {
        this.setScale(this.scale - this.scaleStep, false);
    }

    /**
     * 重置缩放
     */
    resetZoom() {
        this.scale = 1;
        this.offsetX = 0;
        this.offsetY = 0;
        this.applyTransform();
        this.notifyZoomChange();
    }

    /**
     * 适应窗口
     */
    fitToWindow() {
        if (!this.mainCanvas.width || !this.mainCanvas.height) return;
        
        const wrapperRect = this.wrapper.getBoundingClientRect();
        const padding = 40;
        
        const availableWidth = wrapperRect.width - padding * 2;
        const availableHeight = wrapperRect.height - padding * 2;
        
        const scaleX = availableWidth / this.mainCanvas.width;
        const scaleY = availableHeight / this.mainCanvas.height;
        
        this.scale = Math.min(scaleX, scaleY, 1);
        this.scale = Math.max(this.minScale, Math.min(this.maxScale, this.scale));
        
        this.centerCanvas();
        this.applyTransform();
        this.notifyZoomChange();
    }

    /**
     * 居中Canvas
     */
    centerCanvas() {
        this.offsetX = 0;
        this.offsetY = 0;
    }

    /**
     * 将屏幕坐标转换为Canvas坐标
     * @param {number} screenX - 屏幕X坐标
     * @param {number} screenY - 屏幕Y坐标
     * @returns {Object} Canvas坐标
     */
    screenToCanvas(screenX, screenY) {
        const wrapperRect = this.wrapper.getBoundingClientRect();
        const centerX = wrapperRect.width / 2;
        const centerY = wrapperRect.height / 2;
        
        const canvasX = (screenX - centerX - this.offsetX) / this.scale + this.mainCanvas.width / 2;
        const canvasY = (screenY - centerY - this.offsetY) / this.scale + this.mainCanvas.height / 2;
        
        return {
            x: Math.floor(canvasX),
            y: Math.floor(canvasY)
        };
    }

    /**
     * 将Canvas坐标转换为屏幕坐标
     * @param {number} canvasX - Canvas X坐标
     * @param {number} canvasY - Canvas Y坐标
     * @returns {Object} 屏幕坐标
     */
    canvasToScreen(canvasX, canvasY) {
        const wrapperRect = this.wrapper.getBoundingClientRect();
        const centerX = wrapperRect.width / 2;
        const centerY = wrapperRect.height / 2;
        
        const screenX = (canvasX - this.mainCanvas.width / 2) * this.scale + centerX + this.offsetX;
        const screenY = (canvasY - this.mainCanvas.height / 2) * this.scale + centerY + this.offsetY;
        
        return {
            x: screenX,
            y: screenY
        };
    }

    /**
     * 获取当前缩放比例
     * @returns {number} 缩放比例
     */
    getScale() {
        return this.scale;
    }

    /**
     * 获取缩放百分比
     * @returns {number} 缩放百分比
     */
    getScalePercent() {
        return Math.round(this.scale * 100);
    }

    /**
     * 设置缩放变化回调
     * @param {Function} callback - 回调函数
     */
    setOnZoomChange(callback) {
        this.onZoomChange = callback;
    }

    /**
     * 通知缩放变化
     */
    notifyZoomChange() {
        if (this.onZoomChange) {
            this.onZoomChange(this.getScalePercent());
        }
    }

    /**
     * 检查坐标是否在Canvas范围内
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @returns {boolean} 是否在范围内
     */
    isPointInCanvas(x, y) {
        return x >= 0 && x < this.mainCanvas.width && y >= 0 && y < this.mainCanvas.height;
    }

    /**
     * 重置状态
     */
    reset() {
        this.scale = 1;
        this.offsetX = 0;
        this.offsetY = 0;
        this.applyTransform();
        this.notifyZoomChange();
    }
}
