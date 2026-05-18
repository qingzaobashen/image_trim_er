/**
 * 主应用逻辑
 * 连接UI和图像处理功能
 */

import { ImageProcessor } from './imageProcessor.js';
import { ZoomManager } from './utils/zoomManager.js';

/**
 * 主应用类
 */
class App {
    /**
     * 构造函数
     */
    constructor() {
        this.processor = null;
        this.zoomManager = null;
        this.currentTool = 'smartCut';
        this.brushMode = 'add';
        this.isImageLoaded = false;
        this.isLoading = false;

        this.initElements();
        this.initEventListeners();
        this.initProcessor();
        this.initZoomManager();
    }

    /**
     * 初始化DOM元素引用
     */
    initElements() {
        this.mainCanvas = document.getElementById('mainCanvas');
        this.overlayCanvas = document.getElementById('overlayCanvas');
        this.canvasWrapper = document.getElementById('canvasWrapper');
        this.uploadPrompt = document.getElementById('uploadPrompt');
        this.fileInput = document.getElementById('fileInput');
        this.uploadBtn = document.getElementById('uploadBtn');
        this.loadingOverlay = document.getElementById('loadingOverlay');

        this.undoBtn = document.getElementById('undoBtn');
        this.redoBtn = document.getElementById('redoBtn');
        this.downloadBtn = document.getElementById('downloadBtn');
        this.resetBtn = document.getElementById('resetBtn');

        this.toolButtons = document.querySelectorAll('.tool-btn[data-tool]');
        this.paramGroups = document.querySelectorAll('.param-group');

        this.smoothnessInput = document.getElementById('smoothness');
        this.cutModeSelect = document.getElementById('cutMode');
        this.toleranceInput = document.getElementById('tolerance');
        this.contiguousInput = document.getElementById('contiguous');
        this.brushSizeInput = document.getElementById('brushSize');
        this.brushHardnessInput = document.getElementById('brushHardness');
        this.brushAddModeBtn = document.getElementById('brushAddMode');
        this.brushSubtractModeBtn = document.getElementById('brushSubtractMode');

        this.minAreaThresholdInput = document.getElementById('minAreaThreshold');
        this.removeSmallRegionsBtn = document.getElementById('removeSmallRegionsBtn');
        this.框选去除噪点Btn = document.getElementById('框选去除噪点Btn');

        this.applySmartCutBtn = document.getElementById('applySmartCut');
        this.clearSelectionBtn = document.getElementById('clearSelection');
        this.invertSelectionBtn = document.getElementById('invertSelection');
        this.deleteSelectionBtn = document.getElementById('deleteSelection');
        this.selectionDenoiseBtn = document.getElementById('selectionDenoiseBtn');

        this.imageSizeInfo = document.getElementById('imageSize');
        this.fileSizeInfo = document.getElementById('fileSize');
        this.fileFormatInfo = document.getElementById('fileFormat');
        
        this.zoomControls = document.getElementById('zoomControls');
        this.zoomLevel = document.getElementById('zoomLevel');
        this.zoomInBtn = document.getElementById('zoomInBtn');
        this.zoomOutBtn = document.getElementById('zoomOutBtn');
        this.fitWindowBtn = document.getElementById('fitWindowBtn');
        this.resetZoomBtn = document.getElementById('resetZoomBtn');
    }

    /**
     * 初始化事件监听器
     */
    initEventListeners() {
        this.uploadBtn.addEventListener('click', () => this.fileInput.click());
        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));

        this.undoBtn.addEventListener('click', () => this.handleUndo());
        this.redoBtn.addEventListener('click', () => this.handleRedo());
        this.downloadBtn.addEventListener('click', () => this.handleDownload());
        this.resetBtn.addEventListener('click', () => this.handleReset());

        this.toolButtons.forEach(btn => {
            btn.addEventListener('click', () => this.handleToolSelect(btn.dataset.tool));
        });

        this.smoothnessInput.addEventListener('input', (e) => this.updateParamValue(e));
        this.toleranceInput.addEventListener('input', (e) => this.updateParamValue(e));
        this.brushSizeInput.addEventListener('input', (e) => this.updateParamValue(e));
        this.brushHardnessInput.addEventListener('input', (e) => this.updateParamValue(e));

        this.brushAddModeBtn.addEventListener('click', () => this.handleBrushModeChange('add'));
        this.brushSubtractModeBtn.addEventListener('click', () => this.handleBrushModeChange('subtract'));

        this.minAreaThresholdInput.addEventListener('input', (e) => this.updateParamValue(e));
        this.removeSmallRegionsBtn.addEventListener('click', () => this.handleRemoveSmallRegions());
        this.框选去除噪点Btn.addEventListener('click', () => this.handle框选去除噪点());

        this.applySmartCutBtn.addEventListener('click', () => this.handleApplySmartCut());
        this.clearSelectionBtn.addEventListener('click', () => this.handleClearSelection());
        this.invertSelectionBtn.addEventListener('click', () => this.handleInvertSelection());
        this.deleteSelectionBtn.addEventListener('click', () => this.handleDeleteSelection());
        this.selectionDenoiseBtn.addEventListener('click', () => this.handleSelectionDenoise());

        this.overlayCanvas.addEventListener('click', (e) => this.handleCanvasClick(e));
        
        this.canvasWrapper.addEventListener('mousedown', (e) => this.handleCanvasMouseDown(e));
        this.canvasWrapper.addEventListener('mousemove', (e) => this.handleCanvasMouseMove(e));
        this.canvasWrapper.addEventListener('mouseup', () => this.handleCanvasMouseUp());
        this.canvasWrapper.addEventListener('mouseleave', () => this.handleCanvasMouseUp());
        this.canvasWrapper.addEventListener('contextmenu', (e) => e.preventDefault());

        this.zoomInBtn.addEventListener('click', () => this.handleZoomIn());
        this.zoomOutBtn.addEventListener('click', () => this.handleZoomOut());
        this.fitWindowBtn.addEventListener('click', () => this.handleFitWindow());
        this.resetZoomBtn.addEventListener('click', () => this.handleResetZoom());

        document.addEventListener('keydown', (e) => this.handleKeyboard(e));
    }

    /**
     * 初始化图像处理器
     */
    initProcessor() {
        this.processor = new ImageProcessor(this.mainCanvas, this.overlayCanvas);
    }

    /**
     * 初始化缩放管理器
     */
    initZoomManager() {
        this.zoomManager = new ZoomManager(this.mainCanvas, this.overlayCanvas, this.canvasWrapper);
        
        this.zoomManager.setOnZoomChange((percent) => {
            this.zoomLevel.textContent = percent + '%';
        });
    }

    /**
     * 处理文件选择
     * @param {Event} e - 事件对象
     */
    async handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            alert('请选择图片文件');
            return;
        }

        try {
            this.showLoading('加载图片中...');

            const info = await this.processor.loadImage(file);

            this.updateImageInfo(info);
            this.showCanvas();
            this.isImageLoaded = true;
            this.updateButtons();
            this.resetBtn.style.display = 'inline-flex';
            
            setTimeout(() => {
                this.zoomManager.fitToWindow();
            }, 100);

        } catch (error) {
            console.error('图片加载失败:', error);
            alert('图片加载失败，请重试');
        } finally {
            this.hideLoading();
        }
    }

    /**
     * 更新图片信息显示
     * @param {Object} info - 图片信息
     */
    updateImageInfo(info) {
        this.imageSizeInfo.textContent = `${info.width} × ${info.height}`;
        this.fileSizeInfo.textContent = this.formatFileSize(info.size);
        this.fileFormatInfo.textContent = info.type.split('/')[1].toUpperCase();
    }

    /**
     * 格式化文件大小
     * @param {number} bytes - 字节数
     * @returns {string} 格式化后的字符串
     */
    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    /**
     * 显示Canvas
     */
    showCanvas() {
        this.uploadPrompt.style.display = 'none';
        this.mainCanvas.classList.remove('hidden');
        this.overlayCanvas.classList.remove('hidden');
    }

    /**
     * 显示加载提示
     * @param {string} text - 提示文本
     */
    showLoading(text = '处理中...') {
        this.isLoading = true;
        document.querySelector('.loading-text').textContent = text;
        this.loadingOverlay.classList.add('active');
    }

    /**
     * 隐藏加载提示
     */
    hideLoading() {
        this.isLoading = false;
        this.loadingOverlay.classList.remove('active');
    }

    /**
     * 更新按钮状态
     */
    updateButtons() {
        this.undoBtn.disabled = !this.processor.canUndo();
        this.redoBtn.disabled = !this.processor.canRedo();
        this.downloadBtn.disabled = !this.isImageLoaded;
    }

    /**
     * 处理工具选择
     * @param {string} tool - 工具名称
     */
    handleToolSelect(tool) {
        this.currentTool = tool;

        this.toolButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });

        this.paramGroups.forEach(group => {
            group.classList.toggle('active', group.dataset.tool === tool);
        });

        if (tool === 'brush') {
            this.overlayCanvas.style.cursor = 'crosshair';
        } else {
            this.overlayCanvas.style.cursor = 'crosshair';
        }
    }

    /**
     * 更新参数值显示
     * @param {Event} e - 事件对象
     */
    updateParamValue(e) {
        const input = e.target;
        const valueSpan = input.parentElement.querySelector('.param-value');
        if (valueSpan) {
            valueSpan.textContent = input.value;
        }
    }

    /**
     * 处理画笔模式切换
     * @param {string} mode - 模式 ('add' 或 'subtract')
     */
    handleBrushModeChange(mode) {
        this.brushMode = mode;
        
        this.brushAddModeBtn.classList.toggle('active', mode === 'add');
        this.brushSubtractModeBtn.classList.toggle('active', mode === 'subtract');
        
        const modeText = mode === 'add' ? '添加选区' : '取消选区';
        this.showNotification(`画笔模式：${modeText}`, 'info');
    }

    /**
     * 处理Canvas点击
     * @param {MouseEvent} e - 鼠标事件
     */
    handleCanvasClick(e) {
        if (!this.isImageLoaded || this.isLoading) return;
        if (this.currentTool === 'brush') return;

        const rect = this.canvasWrapper.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        
        const canvasPos = this.zoomManager.screenToCanvas(screenX, screenY);
        const x = canvasPos.x;
        const y = canvasPos.y;

        if (this.currentTool === 'magicWand') {
            const tolerance = parseInt(this.toleranceInput.value);
            const contiguous = this.contiguousInput.checked;

            if (e.shiftKey) {
                this.processor.addToSelection(x, y);
            } else if (e.altKey) {
                this.processor.subtractFromSelection(x, y);
            } else {
                this.processor.magicWandSelect(x, y, tolerance, contiguous, true);
            }

            this.updateButtons();
        }
    }

    /**
     * 处理Canvas鼠标按下
     * @param {MouseEvent} e - 鼠标事件
     */
    handleCanvasMouseDown(e) {
        if (!this.isImageLoaded || this.isLoading) return;

        if (e.button === 2) {
            e.preventDefault();
            this.handleRightClick();
            return;
        }

        if (e.button === 1) {
            e.preventDefault();
            this.handleMiddleClick();
            return;
        }

        if (this.currentTool === 'regionSelect') {
            const rect = this.canvasWrapper.getBoundingClientRect();
            const screenX = e.clientX - rect.left;
            const screenY = e.clientY - rect.top;
            
            this.handleRegionSelectStart(screenX, screenY);
            return;
        }

        if (this.currentTool !== 'brush') return;

        const rect = this.canvasWrapper.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        
        const canvasPos = this.zoomManager.screenToCanvas(screenX, screenY);
        const x = canvasPos.x;
        const y = canvasPos.y;

        const size = parseInt(this.brushSizeInput.value);
        const hardness = parseInt(this.brushHardnessInput.value);
        const mode = e.altKey ? (this.brushMode === 'add' ? 'subtract' : 'add') : this.brushMode;
        const scale = this.zoomManager.getScale();

        this.processor.startBrushDrawing(x, y, size, hardness, mode, scale);
    }

    /**
     * 处理Canvas鼠标移动
     * @param {MouseEvent} e - 鼠标事件
     */
    handleCanvasMouseMove(e) {
        if (!this.isImageLoaded || this.isLoading) return;

        if (this.currentTool === 'regionSelect') {
            const rect = this.canvasWrapper.getBoundingClientRect();
            const screenX = e.clientX - rect.left;
            const screenY = e.clientY - rect.top;
            
            this.handleRegionSelectUpdate(screenX, screenY);
            return;
        }

        if (this.currentTool !== 'brush') return;

        const rect = this.canvasWrapper.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        
        const canvasPos = this.zoomManager.screenToCanvas(screenX, screenY);
        const x = canvasPos.x;
        const y = canvasPos.y;
        const scale = this.zoomManager.getScale();

        this.processor.brushDraw(x, y, scale);
    }

    /**
     * 处理Canvas鼠标抬起
     */
    handleCanvasMouseUp() {
        if (!this.isImageLoaded) return;

        if (this.currentTool === 'regionSelect') {
            this.handleRegionSelectEnd();
            return;
        }

        if (this.currentTool !== 'brush') return;

        if (!this.processor.brushTool.isDrawing) {
            return;
        }

        this.processor.stopBrushDrawing();
        this.updateButtons();
    }

    /**
     * 处理右键点击（撤销最后一次选择）
     */
    handleRightClick() {
        if (!this.isImageLoaded || this.isLoading) return;

        const success = this.processor.undoLastSelection();
        
        if (success) {
            this.updateButtons();
            this.showNotification('已撤销最后一次选择', 'info');
        } else {
            this.showNotification('没有可撤销的选择', 'warning');
        }
    }

    /**
     * 处理中键点击（确认删除选区）
     */
    async handleMiddleClick() {
        if (!this.isImageLoaded || this.isLoading) return;

        const success = await this.processor.confirmDeleteSelection();
        
        if (success) {
            this.updateButtons();
            this.showNotification('已删除选中区域', 'success');
        } else {
            this.showNotification('没有选中的区域', 'warning');
        }
    }

    /**
     * 显示通知消息
     * @param {string} message - 消息内容
     * @param {string} type - 消息类型 ('success', 'warning', 'error', 'info')
     */
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 24px;
            border-radius: 8px;
            color: white;
            font-size: 14px;
            font-weight: 500;
            z-index: 10000;
            animation: slideIn 0.3s ease-out;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        `;

        const colors = {
            success: '#10B981',
            warning: '#F59E0B',
            error: '#EF4444',
            info: '#3B82F6'
        };
        notification.style.backgroundColor = colors[type] || colors.info;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease-in';
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 2000);
    }

    /**
     * 处理重新上传图片
     */
    handleReset() {
        this.fileInput.value = '';
        
        const ctx = this.mainCanvas.getContext('2d');
        ctx.clearRect(0, 0, this.mainCanvas.width, this.mainCanvas.height);
        
        const overlayCtx = this.overlayCanvas.getContext('2d');
        overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
        
        this.mainCanvas.width = 300;
        this.mainCanvas.height = 150;
        this.overlayCanvas.width = 300;
        this.overlayCanvas.height = 150;
        
        this.uploadPrompt.style.display = 'flex';
        this.mainCanvas.classList.add('hidden');
        this.overlayCanvas.classList.add('hidden');
        
        this.isImageLoaded = false;
        this.currentTool = 'smartCut';
        
        this.processor.originalImage = null;
        this.processor.currentMask = null;
        this.processor.history = [];
        this.processor.historyIndex = -1;
        this.processor.selectionHistory.clear();
        
        this.imageSizeInfo.textContent = '-';
        this.fileSizeInfo.textContent = '-';
        this.fileFormatInfo.textContent = '-';
        
        this.zoomManager.reset();
        
        this.resetBtn.style.display = 'none';
        
        this.undoBtn.disabled = true;
        this.redoBtn.disabled = true;
        this.downloadBtn.disabled = true;
        
        this.toolButtons.forEach(btn => {
            btn.classList.remove('active');
        });
        this.toolButtons[0].classList.add('active');
        
        this.paramGroups.forEach(group => {
            group.classList.remove('active');
        });
        this.paramGroups[0].classList.add('active');
        
        this.showNotification('正在打开文件选择器...', 'info');
        
        setTimeout(() => {
            this.fileInput.click();
        }, 100);
    }

    /**
     * 处理应用智能抠图
     */
    async handleApplySmartCut() {
        if (!this.isImageLoaded || this.isLoading) return;

        try {
            const mode = this.cutModeSelect.value;
            const smoothness = parseInt(this.smoothnessInput.value);
            
            if (mode === 'person') {
                this.showLoading('正在加载AI模型...');
            }
            
            this.showLoading('正在智能抠图...');
            
            this.processor.smartCutTool.setMode(mode);
            await this.processor.applySmartCut(smoothness);

            this.updateButtons();

        } catch (error) {
            console.error('智能抠图失败:', error);
            alert('智能抠图失败: ' + error.message);
        } finally {
            this.hideLoading();
        }
    }

    /**
     * 处理清除选区
     */
    handleClearSelection() {
        if (!this.isImageLoaded) return;

        this.processor.clearSelection();
        this.updateButtons();
    }

    /**
     * 处理反选
     */
    handleInvertSelection() {
        if (!this.isImageLoaded) return;

        this.processor.invertSelection();
        this.updateButtons();
    }

    /**
     * 处理删除选区
     */
    handleDeleteSelection() {
        if (!this.isImageLoaded) return;

        this.processor.deleteSelection();
        this.updateButtons();
    }

    /**
     * 处理选区降噪
     */
    handleSelectionDenoise() {
        if (!this.isImageLoaded) return;
        if (this.isLoading) return;

        const minArea = parseInt(this.minAreaThresholdInput.value);
        
        const result = this.processor.removeSmallRegionsFromSelection(minArea);
        
        this.updateButtons();
        this.showNotification(
            `已选噪点：${result.removedSelectedRegions}个区域/${result.removedSelectedPixels}像素；未选噪点：${result.removedUnselectedRegions}个区域/${result.removedUnselectedPixels}像素`,
            'success'
        );
    }

    /**
     * 处理去除小区域（噪点）
     */
    handleRemoveSmallRegions() {
        if (!this.isImageLoaded) return;
        if (this.isLoading) return;

        const minArea = parseInt(this.minAreaThresholdInput.value);
        
        const result = this.processor.removeSmallRegions(minArea);
        
        this.updateButtons();
        this.showNotification(
            `透明噪点：${result.removedOpaqueRegions}个区域/${result.removedOpaquePixels}像素；不透明噪点：${result.removedTransparentRegions}个区域/${result.removedTransparentPixels}像素`,
            'success'
        );
    }

    /**
     * 处理框选去除噪点
     */
    handle框选去除噪点() {
        if (!this.isImageLoaded) return;
        if (this.isLoading) return;

        if (this.currentTool === 'regionSelect') {
            this.currentTool = 'smartCut';
            this.processor.regionSelector.destroy();
            this.showNotification('已取消框选', 'info');
        } else {
            this.currentTool = 'regionSelect';
            this.processor.regionSelector.clearSelection();
            this.showNotification('请在图片上框选要处理的区域', 'info');
        }
    }

    /**
     * 处理框选开始
     */
    handleRegionSelectStart(x, y) {
        if (this.currentTool !== 'regionSelect') return;
        
        const canvasPos = this.zoomManager.screenToCanvas(x, y);
        const canvasX = canvasPos.x;
        const canvasY = canvasPos.y;
        
        this.processor.regionSelector.startSelection(canvasX, canvasY);
    }

    /**
     * 处理框选更新
     */
    handleRegionSelectUpdate(x, y) {
        if (this.currentTool !== 'regionSelect') return;
        
        const canvasPos = this.zoomManager.screenToCanvas(x, y);
        const canvasX = canvasPos.x;
        const canvasY = canvasPos.y;
        
        this.processor.regionSelector.updateSelection(canvasX, canvasY);
    }

    /**
     * 处理框选结束
     */
    handleRegionSelectEnd() {
        if (this.currentTool !== 'regionSelect') return;
        
        const rect = this.processor.regionSelector.endSelection();
        
        if (rect) {
            const minArea = parseInt(this.minAreaThresholdInput.value);
            const result = this.processor.removeSmallRegionsInArea(minArea, rect);
            
            this.updateButtons();
            this.showNotification(
                `框选区：透明噪点${result.removedOpaqueRegions}个/${result.removedOpaquePixels}像素；不透明噪点${result.removedTransparentRegions}个/${result.removedTransparentPixels}像素；深色噪点${result.removedDarkRegions}个/${result.removedDarkPixels}像素`,
                'success'
            );
        }
        
        this.processor.regionSelector.clearSelection();
    }

    /**
     * 处理撤销
     */
    handleUndo() {
        if (!this.isImageLoaded) return;

        this.processor.undo();
        this.updateButtons();
    }

    /**
     * 处理重做
     */
    handleRedo() {
        if (!this.isImageLoaded) return;

        this.processor.redo();
        this.updateButtons();
    }

    /**
     * 处理下载
     */
    handleDownload() {
        if (!this.isImageLoaded) return;

        this.processor.downloadImage();
    }

    /**
     * 处理放大
     */
    handleZoomIn() {
        if (!this.isImageLoaded) return;
        this.zoomManager.zoomIn();
    }

    /**
     * 处理缩小
     */
    handleZoomOut() {
        if (!this.isImageLoaded) return;
        this.zoomManager.zoomOut();
    }

    /**
     * 处理适应窗口
     */
    handleFitWindow() {
        if (!this.isImageLoaded) return;
        this.zoomManager.fitToWindow();
    }

    /**
     * 处理重置缩放
     */
    handleResetZoom() {
        if (!this.isImageLoaded) return;
        this.zoomManager.resetZoom();
    }

    /**
     * 处理键盘快捷键
     * @param {KeyboardEvent} e - 键盘事件
     */
    handleKeyboard(e) {
        if (!this.isImageLoaded) return;

        if (e.ctrlKey || e.metaKey) {
            switch (e.key.toLowerCase()) {
                case 'z':
                    e.preventDefault();
                    this.handleUndo();
                    break;
                case 'y':
                    e.preventDefault();
                    this.handleRedo();
                    break;
                case 's':
                    e.preventDefault();
                    this.handleDownload();
                    break;
                case '=':
                case '+':
                    e.preventDefault();
                    this.handleZoomIn();
                    break;
                case '-':
                    e.preventDefault();
                    this.handleZoomOut();
                    break;
                case '0':
                    e.preventDefault();
                    this.handleResetZoom();
                    break;
            }
        } else if (e.key === 'Delete') {
            e.preventDefault();
            this.handleDeleteSelection();
        }
    }
}

/**
 * 应用初始化
 */
document.addEventListener('DOMContentLoaded', () => {
    new App();
});
