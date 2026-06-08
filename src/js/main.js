/**
 * 主应用逻辑
 * 连接UI和图像处理功能
 */

// 预加载 TensorFlow.js（bodyPix 依赖）
import '@tensorflow/tfjs';

import { ImageProcessor } from './imageProcessor.js';
import { ZoomManager } from './utils/zoomManager.js';
import i18n from './i18n/i18n.js';

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
    }

    /**
     * 异步初始化应用（包括国际化系统）
     */
    async init() {
        // 初始化国际化系统
        await i18n.init();

        this.initElements();
        this.initEventListeners();
        this.initI18n();
        this.initProcessor();
        this.initZoomManager();

        // 首次更新界面文本
        i18n.updateUI();
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

        this.shapeButtons = document.querySelectorAll('.shape-btn');

        this.minAreaThresholdInput = document.getElementById('minAreaThreshold');
        this.removeSmallRegionsBtn = document.getElementById('removeSmallRegionsBtn');
        this.boxDenoiseBtn = document.getElementById('boxDenoiseBtn');

        this.smoothEdgesBtn = document.getElementById('smoothEdgesBtn');
        this.smoothEdgesParams = document.getElementById('smoothEdgesParams');
        this.smoothEdgesSlider = document.getElementById('smoothEdgesSlider');
        this.smoothEdgesValue = document.getElementById('smoothEdgesValue');

        this.shadowIntensityInput = document.getElementById('shadowIntensity');
        this.shadowMaxDistanceInput = document.getElementById('shadowMaxDistance');
        this.shadowDiffInput = document.getElementById('shadowDiff');
        this.detectEdgesBtn = document.getElementById('detectEdgesBtn');
        this.edgeBlurSlider = document.getElementById('edgeBlurSlider');
        this.edgeBlurValue = document.getElementById('edgeBlurValue');
        this.edgeLowThresholdSlider = document.getElementById('edgeLowThresholdSlider');
        this.edgeLowThresholdValue = document.getElementById('edgeLowThresholdValue');
        this.edgeHighThresholdSlider = document.getElementById('edgeHighThresholdSlider');
        this.edgeHighThresholdValue = document.getElementById('edgeHighThresholdValue');
        this.detectShadowsBtn = document.getElementById('detectShadowsBtn');
        this.shadowBrushAddModeBtn = document.getElementById('shadowBrushAddMode');
        this.shadowBrushSubtractModeBtn = document.getElementById('shadowBrushSubtractMode');
        this.shadowBrushSizeInput = document.getElementById('shadowBrushSize');
        this.shadowBrushHardnessInput = document.getElementById('shadowBrushHardness');
        this.applyShadowProcessBtn = document.getElementById('applyShadowProcess');
        this.shadowBrushMode = 'add';

        this.edgeBrushAddModeBtn = document.getElementById('edgeBrushAddMode');
        this.edgeBrushSubtractModeBtn = document.getElementById('edgeBrushSubtractMode');
        this.edgeBrushSizeInput = document.getElementById('edgeBrushSize');
        this.edgeBrushMode = 'add';
        this.isEdgeBrushMode = false; // 是否处于边缘画笔模式（与阴影画笔模式互斥）

        this.applySmartCutBtn = document.getElementById('applySmartCut');
        this.clearSelectionBtn = document.getElementById('clearSelection');
        this.invertSelectionBtn = document.getElementById('invertSelection');
        this.deleteSelectionBtn = document.getElementById('deleteSelection');
        this.selectionDenoiseBtn = document.getElementById('selectionDenoiseBtn');

        // AI 模型相关元素
        this.aiModelStatus = document.getElementById('aiModelStatus');
        this.aiStatusDot = document.getElementById('aiStatusDot');
        this.aiStatusText = document.getElementById('aiStatusText');
        this.loadAIModelBtn = document.getElementById('loadAIModelBtn');
        this.aiProgressContainer = document.getElementById('aiProgressContainer');
        this.aiProgressFill = document.getElementById('aiProgressFill');
        this.aiProgressPercent = document.getElementById('aiProgressPercent');
        this.aiProgressMessage = document.getElementById('aiProgressMessage');
        this.cancelModelLoadBtn = document.getElementById('cancelModelLoadBtn');
        this.advancedModelToggle = document.getElementById('advancedModelToggle');
        this.advancedModelPanel = document.getElementById('advancedModelPanel');
        this.modelList = document.getElementById('modelList');

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

        this.shapeButtons.forEach(btn => {
            btn.addEventListener('click', () => this.handleShapeSelect(btn.dataset.shape));
        });

        this.minAreaThresholdInput.addEventListener('input', (e) => this.updateParamValue(e));
        this.removeSmallRegionsBtn.addEventListener('click', () => this.handleRemoveSmallRegions());
        this.boxDenoiseBtn.addEventListener('click', () => this.handleBoxDenoise());

        this.applySmartCutBtn.addEventListener('click', () => this.handleApplySmartCut());
        this.clearSelectionBtn.addEventListener('click', () => this.handleClearSelection());
        this.invertSelectionBtn.addEventListener('click', () => this.handleInvertSelection());
        this.deleteSelectionBtn.addEventListener('click', () => this.handleDeleteSelection());
        this.selectionDenoiseBtn.addEventListener('click', () => this.handleSelectionDenoise());

        // AI 模型相关事件
        this.loadAIModelBtn.addEventListener('click', () => this.handleLoadAIModel());
        this.cancelModelLoadBtn.addEventListener('click', () => this.handleCancelModelLoad());
        this.advancedModelToggle.addEventListener('click', () => this.handleAdvancedModelToggle());

        this.smoothEdgesBtn.addEventListener('click', () => this.handleSmoothEdges());
        this.smoothEdgesSlider.addEventListener('input', (e) => {
            this.smoothEdgesValue.textContent = e.target.value;
        });

        this.shadowIntensityInput.addEventListener('input', (e) => this.updateParamValue(e));
        this.shadowMaxDistanceInput.addEventListener('input', (e) => this.updateParamValue(e));
        this.shadowDiffInput.addEventListener('input', (e) => this.updateParamValue(e));
        this.shadowBrushSizeInput.addEventListener('input', (e) => this.updateParamValue(e));
        this.shadowBrushHardnessInput.addEventListener('input', (e) => this.updateParamValue(e));
        this.edgeBlurSlider.addEventListener('input', (e) => this.updateParamValue(e));
        this.edgeLowThresholdSlider.addEventListener('input', (e) => this.updateParamValue(e));
        this.edgeHighThresholdSlider.addEventListener('input', (e) => this.updateParamValue(e));
        this.detectEdgesBtn.addEventListener('click', () => this.handleDetectEdges());
        this.detectShadowsBtn.addEventListener('click', () => this.handleDetectShadows());
        this.shadowBrushAddModeBtn.addEventListener('click', () => this.handleShadowBrushModeChange('add'));
        this.shadowBrushSubtractModeBtn.addEventListener('click', () => this.handleShadowBrushModeChange('subtract'));
        this.applyShadowProcessBtn.addEventListener('click', () => this.handleApplyShadowProcess());

        this.edgeBrushSizeInput.addEventListener('input', (e) => this.updateParamValue(e));
        this.edgeBrushAddModeBtn.addEventListener('click', () => this.handleEdgeBrushModeChange('add'));
        this.edgeBrushSubtractModeBtn.addEventListener('click', () => this.handleEdgeBrushModeChange('subtract'));

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
     * 初始化国际化系统
     * 绑定语言切换器事件，监听语言变更
     */
    initI18n() {
        this.langSwitcherBtn = document.getElementById('langSwitcherBtn');
        this.langDropdown = document.getElementById('langDropdown');
        this.currentLangLabel = document.getElementById('currentLangLabel');
        this.langOptions = document.querySelectorAll('.lang-option');

        // 语言切换按钮点击 - 切换下拉菜单
        this.langSwitcherBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.langDropdown.classList.toggle('show');
        });

        // 点击页面其他区域关闭下拉菜单
        document.addEventListener('click', () => {
            this.langDropdown.classList.remove('show');
        });

        // 阻止下拉菜单内部点击冒泡关闭
        this.langDropdown.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // 语言选项点击
        this.langOptions.forEach(option => {
            option.addEventListener('click', () => {
                const locale = option.dataset.locale;
                if (i18n.setLocale(locale)) {
                    this._updateLangSwitcherUI(locale);
                }
                this.langDropdown.classList.remove('show');
            });
        });

        // 初始化语言切换器显示状态
        this._updateLangSwitcherUI(i18n.getLocale());

        // 监听语言变更，更新 select 的 option 文本
        i18n.onChange(() => {
            this._updateSelectOptions();
        });
    }

    /**
     * 更新语言切换器 UI 状态
     * @param {string} locale - 当前语言代码
     */
    _updateLangSwitcherUI(locale) {
        // 更新当前语言标签
        this.currentLangLabel.textContent = i18n.getLocaleDisplayName(locale);

        // 更新选中状态
        this.langOptions.forEach(option => {
            option.classList.toggle('active', option.dataset.locale === locale);
        });
    }

    /**
     * 更新 select 下拉框的 option 文本
     * 语言切换后需要重新设置 option 的显示文本
     */
    _updateSelectOptions() {
        const cutModeSelect = document.getElementById('cutMode');
        if (cutModeSelect) {
            const options = cutModeSelect.options;
            options[0].textContent = i18n.t('toolbar.cutModeAuto');
            options[1].textContent = i18n.t('toolbar.cutModeAI');
            options[2].textContent = i18n.t('toolbar.cutModeColor');
            options[3].textContent = i18n.t('toolbar.cutModeEdge');
            options[4].textContent = i18n.t('toolbar.cutModePerson');
        }
    }

    /**
     * 处理文件选择
     * @param {Event} e - 事件对象
     */
    async handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            alert(i18n.t('notifications.selectImageFile'));
            return;
        }

        try {
            this.showLoading(i18n.t('loading.loadingImage'));

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
            alert(i18n.t('notifications.imageLoadFailed'));
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
    showLoading(text) {
        const defaultText = i18n.t('loading.processing');
        this.isLoading = true;
        document.querySelector('.loading-text').textContent = text || defaultText;
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

        if (tool === 'brush' || tool === 'shadowProcess') {
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
     * 处理形状选择
     * @param {string} shape - 形状类型
     */
    handleShapeSelect(shape) {
        this.shapeButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.shape === shape);
        });
        this.processor.setShapeType(shape);
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

        if (this.currentTool === 'shapeCut') {
            const rect = this.canvasWrapper.getBoundingClientRect();
            const screenX = e.clientX - rect.left;
            const screenY = e.clientY - rect.top;

            const canvasPos = this.zoomManager.screenToCanvas(screenX, screenY);
            const x = canvasPos.x;
            const y = canvasPos.y;

            const transformManager = this.processor.getShapeTransformManager();
            if (transformManager.isSelectionActive()) {
                if (transformManager.startDrag(x, y)) {
                    return;
                }
            }

            this.processor.clearShapeSelection();
            this.processor.startShapeDrawing(x, y);
            return;
        }

        if (this.currentTool !== 'brush' && this.currentTool !== 'shadowProcess' && !this.processor.isShadowBrushActive && !this.processor.isEdgeBrushActive) return;

        const rect = this.canvasWrapper.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        
        const canvasPos = this.zoomManager.screenToCanvas(screenX, screenY);
        const x = canvasPos.x;
        const y = canvasPos.y;

        if (this.currentTool === 'shadowProcess') {
            // 如果处于边缘画笔模式，使用边缘画笔
            if (this.isEdgeBrushMode) {
                const size = parseInt(this.edgeBrushSizeInput.value);
                const hardness = 50; // 边缘画笔硬度固定
                const mode = e.altKey ? (this.edgeBrushMode === 'add' ? 'subtract' : 'add') : this.edgeBrushMode;
                const scale = this.zoomManager.getScale();
                this.processor.startEdgeBrush(x, y, size, hardness, mode, scale);
                return;
            }

            const size = parseInt(this.shadowBrushSizeInput.value);
            const hardness = parseInt(this.shadowBrushHardnessInput.value);
            const mode = e.altKey ? (this.shadowBrushMode === 'add' ? 'subtract' : 'add') : this.shadowBrushMode;
            const scale = this.zoomManager.getScale();
            this.processor.startShadowBrush(x, y, size, hardness, mode, scale);
            return;
        }

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

        if (this.currentTool === 'shapeCut') {
            const rect = this.canvasWrapper.getBoundingClientRect();
            const screenX = e.clientX - rect.left;
            const screenY = e.clientY - rect.top;

            const canvasPos = this.zoomManager.screenToCanvas(screenX, screenY);
            const x = canvasPos.x;
            const y = canvasPos.y;

            const transformManager = this.processor.getShapeTransformManager();

            if (transformManager.isCurrentlyDragging()) {
                const newBounds = transformManager.updateDrag(x, y, e.shiftKey);
                if (newBounds) {
                    this.processor.updateShapeMaskFromBounds(newBounds);
                }
                return;
            }

            if (transformManager.isSelectionActive()) {
                const handleType = transformManager.hitTest(x, y);
                this.overlayCanvas.style.cursor = transformManager.getCursor(handleType);
                return;
            }

            this.processor.updateShapeDrawing(x, y);
            return;
        }

        if (this.currentTool !== 'brush' && this.currentTool !== 'shadowProcess' && !this.processor.isShadowBrushActive && !this.processor.isEdgeBrushActive) return;

        const rect = this.canvasWrapper.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;

        const canvasPos = this.zoomManager.screenToCanvas(screenX, screenY);
        const x = canvasPos.x;
        const y = canvasPos.y;
        const scale = this.zoomManager.getScale();

        if (this.processor.isShadowBrushActive) {
            this.processor.shadowBrushDraw(x, y, scale);
            return;
        }

        if (this.processor.isEdgeBrushActive) {
            this.processor.edgeBrushDraw(x, y, scale);
            return;
        }

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

        if (this.currentTool === 'shapeCut') {
            const transformManager = this.processor.getShapeTransformManager();
            if (transformManager.isCurrentlyDragging()) {
                const finalBounds = transformManager.endDrag();
                if (finalBounds) {
                    this.processor.updateShapeMaskFromBounds(finalBounds);
                }
                return;
            }
            this.processor.finishShapeDrawing();
            return;
        }

        if (this.currentTool !== 'brush' && this.currentTool !== 'shadowProcess' && !this.processor.isShadowBrushActive && !this.processor.isEdgeBrushActive) return;

        if (this.processor.isShadowBrushActive) {
            this.processor.stopShadowBrush();
            this.updateButtons();
            return;
        }

        if (this.processor.isEdgeBrushActive) {
            this.processor.stopEdgeBrush();
            this.updateButtons();
            return;
        }

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
        this.processor.undoRedoManager.clear();
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

            // AI 模式需要先加载模型
            if ((mode === 'ai' || mode === 'auto') && !this.processor.isAIModelReady()) {
                const loaded = await this.handleLoadAIModel();
                if (!loaded && mode === 'ai') {
                    this.showNotification(i18n.t('toolbar.aiModelError'), 'error');
                    return;
                }
            }

            this.showLoading(i18n.t('toolbar.applyingSmartCut'));

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
     * 处理加载 AI 模型
     * @returns {Promise<boolean>} 是否加载成功
     */
    async handleLoadAIModel() {
        if (this.processor.isAIModelReady()) return true;

        try {
            // 显示进度条
            this.aiProgressContainer.style.display = 'flex';
            this.loadAIModelBtn.style.display = 'none';
            this._updateAIStatus('loading', i18n.t('toolbar.aiModelLoading'));

            const success = await this.processor.initAIModel(
                (progressInfo) => this._handleModelProgress(progressInfo),
                (state, modelName) => this._handleModelStateChange(state, modelName)
            );

            if (success) {
                this._updateAIStatus('ready', i18n.t('toolbar.aiModelReady'));
                this.loadAIModelBtn.textContent = i18n.t('toolbar.aiModelReady');
                this.loadAIModelBtn.disabled = true;
                this.loadAIModelBtn.style.display = 'inline-flex';
                this._renderModelList();
            } else {
                this._updateAIStatus('error', i18n.t('toolbar.aiModelError'));
                this.loadAIModelBtn.style.display = 'inline-flex';
                this.loadAIModelBtn.disabled = false;
            }

            this.aiProgressContainer.style.display = 'none';
            return success;
        } catch (error) {
            if (error.message === '模型加载已取消') {
                this._updateAIStatus('not_loaded', i18n.t('toolbar.aiModelNotLoaded'));
                this.showNotification(i18n.t('toolbar.modelLoadCancelled'), 'info');
            } else {
                this._updateAIStatus('error', i18n.t('toolbar.aiModelError'));
                this.showNotification(i18n.t('toolbar.aiModelError') + ': ' + error.message, 'error');
            }
            this.loadAIModelBtn.style.display = 'inline-flex';
            this.loadAIModelBtn.disabled = false;
            this.aiProgressContainer.style.display = 'none';
            return false;
        }
    }

    /**
     * 处理取消模型加载
     */
    handleCancelModelLoad() {
        this.processor.cancelModelLoading();
    }

    /**
     * 处理高级模型选项面板切换
     */
    handleAdvancedModelToggle() {
        const isExpanded = this.advancedModelPanel.style.display !== 'none';
        this.advancedModelPanel.style.display = isExpanded ? 'none' : 'block';
        this.advancedModelToggle.classList.toggle('expanded', !isExpanded);

        // 首次展开时渲染模型列表
        if (!isExpanded && this.processor.isAIModelReady()) {
            this._renderModelList();
        }
    }

    /**
     * 更新 AI 模型状态指示器
     * @param {string} status - 状态类型: 'not_loaded', 'loading', 'ready', 'error'
     * @param {string} text - 状态文本
     */
    _updateAIStatus(status, text) {
        this.aiStatusDot.className = 'ai-status-dot';
        switch (status) {
            case 'loading':
                this.aiStatusDot.classList.add('loading');
                break;
            case 'ready':
                this.aiStatusDot.classList.add('ready');
                break;
            case 'error':
                this.aiStatusDot.classList.add('error');
                break;
            default:
                break;
        }
        this.aiStatusText.textContent = text;
    }

    /**
     * 处理模型加载进度回调
     * @param {Object} info - 进度信息
     */
    _handleModelProgress(info) {
        const percent = Math.round(info.progress || 0);
        this.aiProgressFill.style.width = percent + '%';
        this.aiProgressPercent.textContent = percent + '%';
        this.aiProgressMessage.textContent = info.message || '';
    }

    /**
     * 处理模型状态变更回调
     * @param {string} state - 状态
     * @param {string} modelName - 模型名称
     */
    _handleModelStateChange(state, modelName) {
        switch (state) {
            case 'loading':
                this._updateAIStatus('loading', i18n.t('toolbar.aiModelLoading'));
                break;
            case 'ready':
                this._updateAIStatus('ready', i18n.t('toolbar.aiModelReady'));
                break;
            case 'error':
                this._updateAIStatus('error', i18n.t('toolbar.aiModelError'));
                break;
            case 'cancelled':
                this._updateAIStatus('not_loaded', i18n.t('toolbar.aiModelNotLoaded'));
                break;
        }
    }

    /**
     * 渲染模型列表
     */
    _renderModelList() {
        if (!this.modelList) return;

        const models = this.processor.smartCutTool.modelManager.constructor.getAvailableModels();
        const currentModel = this.processor.getCurrentAIModel();

        this.modelList.innerHTML = '';
        models.forEach(model => {
            const item = document.createElement('div');
            item.className = 'model-item' + (model.id === currentModel ? ' active' : '');
            item.dataset.model = model.id;

            const qualityClass = model.quality === '极高' ? 'highest' :
                                 model.quality === '高' ? 'high' :
                                 model.quality === '快速' ? 'fast' : 'standard';

            item.innerHTML = `
                <div class="model-item-info">
                    <span class="model-item-name">${model.name}</span>
                    <span class="model-item-desc">${model.description}</span>
                </div>
                <div class="model-item-meta">
                    <span class="model-item-size">${model.size}</span>
                    <span class="model-item-quality ${qualityClass}">${model.quality}</span>
                    ${model.recommended ? '<span class="model-item-recommended">' + i18n.t('toolbar.modelRecommended') + '</span>' : ''}
                </div>
            `;

            item.addEventListener('click', () => this._handleModelSelect(model.id));
            this.modelList.appendChild(item);
        });
    }

    /**
     * 处理模型选择
     * @param {string} modelName - 模型名称
     */
    async _handleModelSelect(modelName) {
        const currentModel = this.processor.getCurrentAIModel();
        if (modelName === currentModel) return;

        try {
            // 显示进度条
            this.aiProgressContainer.style.display = 'flex';
            this._updateAIStatus('loading', i18n.t('toolbar.aiModelLoading'));

            const success = await this.processor.switchAIModel(modelName);

            if (success) {
                this._updateAIStatus('ready', i18n.t('toolbar.aiModelReady'));
                this.showNotification(i18n.t('toolbar.modelSwitchSuccess'), 'success');
                this._renderModelList();
            } else {
                this._updateAIStatus('error', i18n.t('toolbar.modelSwitchFailed'));
                this.showNotification(i18n.t('toolbar.modelSwitchFailed'), 'error');
            }

            this.aiProgressContainer.style.display = 'none';
        } catch (error) {
            this._updateAIStatus('error', i18n.t('toolbar.modelSwitchFailed'));
            this.showNotification(i18n.t('toolbar.modelSwitchFailed') + ': ' + error.message, 'error');
            this.aiProgressContainer.style.display = 'none';
        }
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
     * 处理边缘光滑
     */
    handleSmoothEdges() {
        if (!this.isImageLoaded) return;
        if (this.isLoading) return;

        const strength = parseInt(this.smoothEdgesSlider.value);
        
        this.showLoading('边缘光滑处理中...');
        
        setTimeout(() => {
            try {
                const success = this.processor.smoothEdges(strength);
                if (success) {
                    this.updateButtons();
                    this.showNotification(`边缘光滑处理完成（强度：${strength}）`, 'success');
                } else {
                    this.showNotification('边缘光滑处理失败', 'error');
                }
            } catch (error) {
                console.error('边缘光滑处理失败:', error);
                this.showNotification('边缘光滑处理失败', 'error');
            } finally {
                this.hideLoading();
            }
        }, 10);
    }

    /**
     * 处理边缘检测
     */
    handleDetectEdges() {
        if (!this.isImageLoaded) return;
        if (this.isLoading) return;

        // 读取边缘检测参数
        const blurKernelSize = parseInt(this.edgeBlurSlider.value);
        const lowThreshold = parseInt(this.edgeLowThresholdSlider.value);
        const highThreshold = parseInt(this.edgeHighThresholdSlider.value);

        this.showLoading('边缘检测中...');

        setTimeout(() => {
            try {
                const success = this.processor.detectEdges({
                    blurKernelSize,
                    lowThreshold,
                    highThreshold
                });
                if (success) {
                    // 重置边缘画笔模式状态
                    this.isEdgeBrushMode = false;
                    this.edgeBrushAddModeBtn.classList.remove('active');
                    this.edgeBrushSubtractModeBtn.classList.remove('active');
                    this.updateButtons();
                    this.showNotification('边缘检测完成，青色细线为物体轮廓', 'success');
                } else {
                    this.showNotification('边缘检测失败', 'error');
                }
            } catch (error) {
                console.error('边缘检测失败:', error);
                this.showNotification('边缘检测失败', 'error');
            } finally {
                this.hideLoading();
            }
        }, 10);
    }

    /**
     * 处理阴影检测
     */
    handleDetectShadows() {
        if (!this.isImageLoaded) return;
        if (this.isLoading) return;

        if (!this.processor.currentMask || this.processor.currentMask.every(v => v === 0)) {
            this.showNotification('请先使用智能抠图或魔术棒确定紫色选区', 'warning');
            return;
        }

        const maxDistance = parseInt(this.shadowMaxDistanceInput.value);
        const shadowDiff = parseInt(this.shadowDiffInput.value);

        this.showLoading('阴影检测中...');

        setTimeout(() => {
            try {
                const success = this.processor.detectShadows({
                    maxDistance,
                    shadowDiff
                });

                if (success) {
                    this.showNotification('阴影检测完成，粉色区域为阴影选区', 'success');
                } else {
                    this.showNotification('没有活跃的选区，请先进行抠图', 'warning');
                }
            } catch (error) {
                console.error('阴影检测失败:', error);
                this.showNotification('阴影检测失败', 'error');
            } finally {
                this.hideLoading();
            }
        }, 10);
    }

    /**
     * 处理阴影画笔模式切换
     * @param {string} mode - 模式 ('add' 或 'subtract')
     */
    handleShadowBrushModeChange(mode) {
        this.shadowBrushMode = mode;
        this.isEdgeBrushMode = false; // 退出边缘画笔模式

        this.shadowBrushAddModeBtn.classList.toggle('active', mode === 'add');
        this.shadowBrushSubtractModeBtn.classList.toggle('active', mode === 'subtract');

        // 退出边缘画笔模式，取消边缘画笔按钮的激活状态
        this.edgeBrushAddModeBtn.classList.remove('active');
        this.edgeBrushSubtractModeBtn.classList.remove('active');

        const modeText = mode === 'add' ? '添加阴影选区' : '取消阴影选区';
        this.showNotification(`阴影画笔模式：${modeText}`, 'info');
    }

    /**
     * 处理边缘画笔模式切换
     * 切换到边缘画笔模式时，自动退出阴影画笔模式
     * @param {string} mode - 模式（'add'=正画笔 / 'subtract'=负画笔）
     */
    handleEdgeBrushModeChange(mode) {
        this.edgeBrushMode = mode;
        this.isEdgeBrushMode = true; // 进入边缘画笔模式

        this.edgeBrushAddModeBtn.classList.toggle('active', mode === 'add');
        this.edgeBrushSubtractModeBtn.classList.toggle('active', mode === 'subtract');

        // 退出阴影画笔模式，取消阴影画笔按钮的激活状态
        this.shadowBrushAddModeBtn.classList.remove('active');
        this.shadowBrushSubtractModeBtn.classList.remove('active');

        const modeText = mode === 'add' ? '正画笔（描绘边缘）' : '负画笔（抹除边缘）';
        this.showNotification(`边缘画笔模式：${modeText}`, 'info');
    }

    /**
     * 应用阴影处理
     */
    handleApplyShadowProcess() {
        if (!this.isImageLoaded) return;
        if (this.isLoading) return;

        if (!this.processor.currentMask || this.processor.currentMask.every(v => v === 0)) {
            this.showNotification('请先使用智能抠图或魔术棒确定紫色选区', 'warning');
            return;
        }

        const intensity = parseInt(this.shadowIntensityInput.value);

        this.showLoading('应用阴影处理中...');

        setTimeout(() => {
            try {
                const success = this.processor.applyShadowProcess(intensity);

                if (success) {
                    this.updateButtons();
                    this.showNotification('阴影处理完成', 'success');
                } else {
                    this.showNotification('阴影处理失败', 'error');
                }
            } catch (error) {
                console.error('阴影处理失败:', error);
                this.showNotification('阴影处理失败', 'error');
            } finally {
                this.hideLoading();
            }
        }, 10);
    }

    /**
     * 处理框选去除噪点
     */
    handleBoxDenoise() {
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
                `框选区：透明噪点${result.removedOpaqueRegions}个/${result.removedOpaquePixels}像素；不透明噪点${result.removedTransparentRegions}个/${result.removedTransparentPixels}像素`,
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
document.addEventListener('DOMContentLoaded', async () => {
    const app = new App();
    await app.init();
});
