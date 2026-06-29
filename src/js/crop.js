/**
 * 图片裁剪页面逻辑
 * 支持矩形/圆形/椭圆/多边形形状裁剪、宫格模式切图、
 * 实时预览、拖拽缩放调整，与主应用无缝协作
 *
 * @module crop
 */

import i18n from './i18n/i18n.js';
import { createZip } from './zip-writer.js';

/** 裁剪形状常量 */
const SHAPE_RECT = 'rect';
const SHAPE_CIRCLE = 'circle';
const SHAPE_ELLIPSE = 'ellipse';
const SHAPE_POLYGON = 'polygon';

/** 手柄尺寸（像素） */
const HANDLE_SIZE = 10;
/** 最小裁剪区域（像素） */
const MIN_CROP_SIZE = 20;
/** 边框颜色 */
const OVERLAY_COLOR = 'rgba(99, 102, 241, 0.75)';
/** 暗色遮罩颜色 */
const MASK_COLOR = 'rgba(0, 0, 0, 0.55)';
/** 网格线颜色 */
const GRID_COLOR = 'rgba(255, 255, 255, 0.25)';
/** 多边形顶点颜色 */
const POLYGON_POINT_COLOR = '#6366f1';

/**
 * 图片裁剪应用主类
 * 管理图片加载、裁剪区域交互、渲染及导出
 */
class CropApp {
    /**
     * 构造函数
     */
    constructor() {
        /** @type {HTMLImageElement|null} 原始图片 */
        this.image = null;
        /** @type {HTMLCanvasElement} 主画布 */
        this.canvas = null;
        /** @type {CanvasRenderingContext2D} 画布上下文 */
        this.ctx = null;

        /** @type {string} 当前裁剪形状 */
        this.shape = SHAPE_RECT;
        /** @type {string} 宫格模式 */
        this.gridMode = 'none';
        /** @type {number} 宫格列数 */
        this.gridCols = 1;
        /** @type {number} 宫格行数 */
        this.gridRows = 1;
        /** @type {{row:number,col:number}|null} 当前选中的宫格单元格 */
        this.selectedCell = null;
        /** @type {number[]} 宫格竖线位置（相对裁剪框的百分比，0-1） */
        this.gridVerticalLines = [];
        /** @type {number[]} 宫格横线位置（相对裁剪框的百分比，0-1） */
        this.gridHorizontalLines = [];
        /** @type {string|null} 当前拖拽的宫格线类型：'vertical' | 'horizontal' */
        this.draggingGridLine = null;
        /** @type {number} 当前拖拽的宫格线索引 */
        this.draggingGridLineIndex = -1;
        /** @type {{x:number,y:number}} 拖拽起始点（画布坐标） */
        this.gridLineDragStart = { x: 0, y: 0 };

        /**
         * 裁剪区域（相对图片坐标，非画布坐标）
         * @type {{x:number, y:number, width:number, height:number}}
         */
        this.cropRegion = { x: 0, y: 0, width: 0, height: 0 };

        /**
         * 多边形顶点列表（相对图片坐标）
         * @type {{x:number, y:number}[]}
         */
        this.polygonPoints = [];

        /** @type {boolean} 是否正在拖拽 */
        this.isDragging = false;
        /** @type {string|null} 拖拽目标：'move' | 'nw'|'ne'|'sw'|'se'|'n'|'s'|'w'|'e' */
        this.dragHandle = null;
        /** @type {{x:number,y:number}} 拖拽起始点（画布坐标） */
        this.dragStart = { x: 0, y: 0 };
        /** @type {{x:number,y:number,width:number,height:number}} 拖拽开始时的裁剪区域快照 */
        this.dragStartRegion = null;

        /** @type {number} 当前多边形拖拽的顶点索引 */
        this.dragPointIndex = -1;

        /** @type {number} 图片在画布上的缩放比例 */
        this.scale = 1;
        /** @type {number} 图片在画布上的 X 偏移 */
        this.offsetX = 0;
        /** @type {number} 图片在画布上的 Y 偏移 */
        this.offsetY = 0;

        /** @type {boolean} 是否已加载图片 */
        this.isImageLoaded = false;

        /** 存储导出用的裁剪后 blob */
        this._lastCropBlob = null;
    }

    /**
     * 异步初始化应用
     * @returns {Promise<void>}
     */
    async init() {
        // 初始化国际化
        await i18n.init();

        this._initElements();
        this._initEventListeners();
        this._initMobileNav();
        this._initLangSwitcher();
        i18n.updateUI();

        // 尝试从主应用恢复图片
        await this._maybeRestoreFromMain();
    }

    /**
     * 初始化 DOM 元素引用
     * @private
     */
    _initElements() {
        this.dom = {
            uploadSection: document.getElementById('uploadSection'),
            uploadArea: document.getElementById('uploadArea'),
            fileInput: document.getElementById('fileInput'),
            selectFileBtn: document.getElementById('selectFileBtn'),

            cropWorkspace: document.getElementById('cropWorkspace'),
            shapeBtnGroup: document.getElementById('shapeBtnGroup'),
            gridModeSelect: document.getElementById('gridModeSelect'),
            gridCustomInputs: document.getElementById('gridCustomInputs'),
            gridCustomCols: document.getElementById('gridCustomCols'),
            gridCustomRows: document.getElementById('gridCustomRows'),
            resetCropBtn: document.getElementById('resetCropBtn'),

            canvasContainer: document.getElementById('canvasContainer'),
            cropCanvas: document.getElementById('cropCanvas'),
            cropInfoRow: document.getElementById('cropInfoRow'),
            cropSizeInfo: document.getElementById('cropSizeInfo'),
            originalSizeInfo: document.getElementById('originalSizeInfo'),

            gridCellsPanel: document.getElementById('gridCellsPanel'),
            gridCellsGrid: document.getElementById('gridCellsGrid'),
            exportSelectedCellBtn: document.getElementById('exportSelectedCellBtn'),
            exportAllCellsBtn: document.getElementById('exportAllCellsBtn'),

            applyCropBtn: document.getElementById('applyCropBtn'),
            reselectBtn: document.getElementById('reselectBtn')
        };

        this.canvas = this.dom.cropCanvas;
        this.ctx = this.canvas.getContext('2d');
    }

    /**
     * 初始化所有事件监听
     * @private
     */
    _initEventListeners() {
        // 上传相关
        this.dom.selectFileBtn.addEventListener('click', () => this.dom.fileInput.click());
        this.dom.fileInput.addEventListener('change', (e) => this._handleFileSelect(e));
        this.dom.uploadArea.addEventListener('click', (e) => {
            if (e.target !== this.dom.selectFileBtn && !this.dom.selectFileBtn.contains(e.target)) {
                this.dom.fileInput.click();
            }
        });
        this.dom.uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.dom.uploadArea.style.borderColor = 'var(--primary-color)';
        });
        this.dom.uploadArea.addEventListener('dragleave', () => {
            this.dom.uploadArea.style.borderColor = '';
        });
        this.dom.uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            this.dom.uploadArea.style.borderColor = '';
            const files = e.dataTransfer.files;
            if (files && files.length > 0) {
                this._loadImageFromFile(files[0]);
            }
        });

        // 形状选择
        this.dom.shapeBtnGroup.addEventListener('click', (e) => {
            const btn = e.target.closest('.shape-btn');
            if (!btn) return;
            this._setShape(btn.dataset.shape);
        });

        // 宫格模式
        this.dom.gridModeSelect.addEventListener('change', () => {
            this._updateGridMode();
            this._render();
        });
        this.dom.gridCustomCols.addEventListener('input', () => {
            if (this.dom.gridModeSelect.value === 'custom') {
                this._updateGridMode();
                this._render();
            }
        });
        this.dom.gridCustomRows.addEventListener('input', () => {
            if (this.dom.gridModeSelect.value === 'custom') {
                this._updateGridMode();
                this._render();
            }
        });

        // 重置
        this.dom.resetCropBtn.addEventListener('click', () => this._resetCrop());

        // Canvas 交互
        this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
        window.addEventListener('mouseup', (e) => this._onMouseUp(e));
        this.canvas.addEventListener('dblclick', (e) => this._onDoubleClick(e));
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this._resetCrop();
        });

        // 键盘事件
        window.addEventListener('keydown', (e) => this._onKeyDown(e));

        // 窗口大小变化
        window.addEventListener('resize', () => this._fitCanvas());

        // 导出按钮
        this.dom.applyCropBtn.addEventListener('click', () => this._exportCrop());
        this.dom.reselectBtn.addEventListener('click', () => this._showUpload());
        this.dom.exportSelectedCellBtn.addEventListener('click', () => this._exportSelectedCell());
        this.dom.exportAllCellsBtn.addEventListener('click', () => this._exportAllCells());
    }

    /**
     * 初始化移动端导航
     * @private
     */
    _initMobileNav() {
        const toggle = document.getElementById('navMobileToggle');
        const links = document.getElementById('navLinks');
        if (toggle && links) {
            toggle.addEventListener('click', () => links.classList.toggle('open'));
        }
    }

    /**
     * 初始化语言切换器
     * @private
     */
    _initLangSwitcher() {
        const btn = document.getElementById('langSwitcherBtn');
        const dropdown = document.getElementById('langDropdown');
        const label = document.getElementById('currentLangLabel');
        const options = document.querySelectorAll('#langDropdown .lang-option');
        if (!btn || !dropdown) return;

        btn.addEventListener('click', () => dropdown.classList.toggle('show'));
        document.addEventListener('click', (e) => {
            const sw = document.getElementById('langSwitcher');
            if (sw && !sw.contains(e.target)) {
                dropdown.classList.remove('show');
            }
        });

        options.forEach(opt => {
            opt.addEventListener('click', () => {
                const locale = opt.dataset.locale;
                if (i18n.setLocale(locale)) {
                    // 更新语言标签和选项状态
                    if (label) label.textContent = i18n.getLocaleDisplayName(locale);
                    options.forEach(o => o.classList.toggle('active', o.dataset.locale === locale));
                }
                dropdown.classList.remove('show');
            });
        });

        // 初始设置当前语言标签
        i18n.onChange((locale) => {
            if (label) label.textContent = i18n.getLocaleDisplayName(locale);
            options.forEach(o => o.classList.toggle('active', o.dataset.locale === locale));
        });
    }

    /**
     * 尝试从主应用（抠图工具或压缩页）恢复图片
     * 通过 sessionStorage 传递 dataUrl
     * @private
     * @returns {Promise<void>}
     */
    async _maybeRestoreFromMain() {
        const STORAGE_KEY = 'crop-restore-blob';
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return;

        let payload;
        try {
            payload = JSON.parse(raw);
        } catch {
            sessionStorage.removeItem(STORAGE_KEY);
            return;
        }

        if (!payload || !payload.dataUrl) {
            sessionStorage.removeItem(STORAGE_KEY);
            return;
        }

        try {
            await this._loadImageFromDataUrl(payload.dataUrl);
            sessionStorage.removeItem(STORAGE_KEY);
        } catch (err) {
            console.warn('[CropApp] 从主应用恢复图片失败', err);
            sessionStorage.removeItem(STORAGE_KEY);
        }
    }

    /**
     * 处理文件选择事件
     * @private
     * @param {Event} e - 文件选择事件
     */
    _handleFileSelect(e) {
        const files = e.target.files;
        if (files && files.length > 0) {
            this._loadImageFromFile(files[0]);
        }
        // 允许重复选择同一文件
        e.target.value = '';
    }

    /**
     * 从 File 对象加载图片
     * @private
     * @param {File} file - 图片文件
     * @returns {Promise<void>}
     */
    async _loadImageFromFile(file) {
        if (!file.type.startsWith('image/')) {
            alert(i18n.t('cropPage.invalidType') || '请选择图片文件');
            return;
        }
        const reader = new FileReader();
        const dataUrl = await new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
        await this._loadImageFromDataUrl(dataUrl);
    }

    /**
     * 从 Data URL 加载图片
     * @private
     * @param {string} dataUrl - 图片 Data URL
     * @returns {Promise<void>}
     */
    async _loadImageFromDataUrl(dataUrl) {
        const img = new Image();
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error('图片加载失败'));
            img.src = dataUrl;
        });

        this.image = img;
        this.isImageLoaded = true;

        // 初始化裁剪区域为图片的 80% 居中
        const margin = 0.1;
        this.cropRegion = {
            x: Math.round(img.width * margin),
            y: Math.round(img.height * margin),
            width: Math.round(img.width * (1 - margin * 2)),
            height: Math.round(img.height * (1 - margin * 2))
        };
        this.polygonPoints = [];
        this.selectedCell = null;

        // 切换到工作区视图
        this.dom.uploadSection.classList.remove('visible');
        this.dom.cropWorkspace.classList.add('visible');

        // 拟合画布尺寸
        this._fitCanvas();
        this._updateInfoDisplay();
        this._updateGridCellsPanel();
        this._render();
    }

    /**
     * 设置裁剪形状
     * @private
     * @param {string} shape - 形状类型
     */
    _setShape(shape) {
        if (![SHAPE_RECT, SHAPE_CIRCLE, SHAPE_ELLIPSE, SHAPE_POLYGON].includes(shape)) return;
        this.shape = shape;

        // 更新按钮状态
        this.dom.shapeBtnGroup.querySelectorAll('.shape-btn').forEach(b => b.classList.remove('active'));
        const activeBtn = this.dom.shapeBtnGroup.querySelector(`[data-shape="${shape}"]`);
        if (activeBtn) activeBtn.classList.add('active');

        // 切换到多边形模式时，根据当前矩形区域生成初始顶点
        if (shape === SHAPE_POLYGON && this.polygonPoints.length === 0) {
            const r = this.cropRegion;
            this.polygonPoints = [
                { x: r.x, y: r.y },
                { x: r.x + r.width, y: r.y },
                { x: r.x + r.width, y: r.y + r.height },
                { x: r.x, y: r.y + r.height }
            ];
        }

        this._render();
    }

    /**
     * 更新宫格模式设置
     * @private
     */
    _updateGridMode() {
        const value = this.dom.gridModeSelect.value;
        if (value === 'none') {
            this.gridMode = 'none';
            this.gridCols = 1;
            this.gridRows = 1;
            this.dom.gridCustomInputs.classList.remove('visible');
        } else if (value === 'custom') {
            this.gridMode = 'custom';
            this.gridCols = Math.max(1, Math.min(10, parseInt(this.dom.gridCustomCols.value) || 2));
            this.gridRows = Math.max(1, Math.min(10, parseInt(this.dom.gridCustomRows.value) || 2));
            this.dom.gridCustomInputs.classList.add('visible');
        } else {
            const [cols, rows] = value.split('x').map(Number);
            this.gridMode = value;
            this.gridCols = cols;
            this.gridRows = rows;
            this.dom.gridCustomInputs.classList.remove('visible');
        }
        
        // 初始化宫格线位置（均匀分布）
        this._initializeGridLines();
        this.selectedCell = null;
        this._updateGridCellsPanel();
    }

    /**
     * 初始化宫格线位置
     * @private
     */
    _initializeGridLines() {
        // 竖线位置（不包括边界）
        this.gridVerticalLines = [];
        for (let i = 1; i < this.gridCols; i++) {
            this.gridVerticalLines.push(i / this.gridCols);
        }
        
        // 横线位置（不包括边界）
        this.gridHorizontalLines = [];
        for (let i = 1; i < this.gridRows; i++) {
            this.gridHorizontalLines.push(i / this.gridRows);
        }
    }

    /**
     * 计算画布适配尺寸
     * @private
     */
    _fitCanvas() {
        if (!this.image) return;

        const container = this.dom.canvasContainer;
        const maxWidth = container.clientWidth - 32;
        const maxHeight = Math.min(window.innerHeight * 0.7, 800);

        const imgRatio = this.image.width / this.image.height;
        let canvasWidth = maxWidth;
        let canvasHeight = canvasWidth / imgRatio;

        if (canvasHeight > maxHeight) {
            canvasHeight = maxHeight;
            canvasWidth = canvasHeight * imgRatio;
        }

        this.scale = canvasWidth / this.image.width;
        this.offsetX = 0;
        this.offsetY = 0;

        this.canvas.width = canvasWidth;
        this.canvas.height = canvasHeight;
        this.canvas.style.width = canvasWidth + 'px';
        this.canvas.style.height = canvasHeight + 'px';

        this._render();
    }

    /**
     * 主渲染函数
     * @private
     */
    _render() {
        if (!this.image || !this.ctx) return;

        const ctx = this.ctx;
        const cw = this.canvas.width;
        const ch = this.canvas.height;

        ctx.clearRect(0, 0, cw, ch);

        // 1. 绘制图片
        ctx.drawImage(this.image, 0, 0, cw, ch);

        // 2. 如果是多边形模式
        if (this.shape === SHAPE_POLYGON) {
            this._renderPolygonMode(ctx, cw, ch);
        } else {
            this._renderShapeMode(ctx, cw, ch);
        }

        // 3. 绘制宫格线
        if (this.gridMode !== 'none') {
            this._renderGridLines(ctx, cw, ch);
        }
    }

    /**
     * 在画布坐标与图片坐标之间转换裁剪区域
     * @private
     * @returns {{x:number,y:number,width:number,height:number}} 画布坐标下的裁剪区域
     */
    _getCropRegionCanvas() {
        const r = this.cropRegion;
        return {
            x: r.x * this.scale,
            y: r.y * this.scale,
            width: r.width * this.scale,
            height: r.height * this.scale
        };
    }

    /**
     * 绘制形状模式的裁剪叠加层（矩形/圆形/椭圆）
     * @private
     * @param {CanvasRenderingContext2D} ctx - 画布上下文
     * @param {number} cw - 画布宽度
     * @param {number} ch - 画布高度
     */
    _renderShapeMode(ctx, cw, ch) {
        const cr = this._getCropRegionCanvas();

        // 暗色遮罩（裁剪区域外）
        ctx.save();
        ctx.fillStyle = MASK_COLOR;
        ctx.fillRect(0, 0, cw, ch);

        // 裁剪区域镂空
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        if (this.shape === SHAPE_CIRCLE) {
            const cx = cr.x + cr.width / 2;
            const cy = cr.y + cr.height / 2;
            const radius = Math.min(cr.width, cr.height) / 2;
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        } else if (this.shape === SHAPE_ELLIPSE) {
            const cx = cr.x + cr.width / 2;
            const cy = cr.y + cr.height / 2;
            ctx.ellipse(cx, cy, cr.width / 2, cr.height / 2, 0, 0, Math.PI * 2);
        } else {
            ctx.rect(cr.x, cr.y, cr.width, cr.height);
        }
        ctx.fill();
        ctx.restore();

        // 裁剪区域边框
        ctx.save();
        ctx.strokeStyle = OVERLAY_COLOR;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        if (this.shape === SHAPE_CIRCLE) {
            const cx = cr.x + cr.width / 2;
            const cy = cr.y + cr.height / 2;
            const radius = Math.min(cr.width, cr.height) / 2;
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        } else if (this.shape === SHAPE_ELLIPSE) {
            const cx = cr.x + cr.width / 2;
            const cy = cr.y + cr.height / 2;
            ctx.ellipse(cx, cy, cr.width / 2, cr.height / 2, 0, 0, Math.PI * 2);
        } else {
            ctx.strokeRect(cr.x, cr.y, cr.width, cr.height);
        }
        ctx.stroke();
        ctx.restore();

        // 绘制拖拽手柄（矩形/圆形/椭圆共用 8 个方向的角点）
        if (this.shape === SHAPE_CIRCLE || this.shape === SHAPE_ELLIPSE) {
            const cx = cr.x + cr.width / 2;
            const cy = cr.y + cr.height / 2;
            const rx = cr.width / 2;
            const ry = cr.height / 2;
            const handles = [
                { x: cx, y: cy - ry },     // n
                { x: cx, y: cy + ry },     // s
                { x: cx - rx, y: cy },     // w
                { x: cx + rx, y: cy },     // e
                { x: cx - rx, y: cy - ry },// nw
                { x: cx + rx, y: cy - ry },// ne
                { x: cx - rx, y: cy + ry },// sw
                { x: cx + rx, y: cy + ry } // se
            ];
            this._drawHandles(ctx, handles);
        } else {
            const handles = [
                { x: cr.x, y: cr.y },
                { x: cr.x + cr.width, y: cr.y },
                { x: cr.x, y: cr.y + cr.height },
                { x: cr.x + cr.width, y: cr.y + cr.height },
                { x: cr.x + cr.width / 2, y: cr.y },
                { x: cr.x + cr.width / 2, y: cr.y + cr.height },
                { x: cr.x, y: cr.y + cr.height / 2 },
                { x: cr.x + cr.width, y: cr.y + cr.height / 2 }
            ];
            this._drawHandles(ctx, handles);
        }
    }

    /**
     * 绘制拖拽手柄
     * @private
     * @param {CanvasRenderingContext2D} ctx - 画布上下文
     * @param {{x:number,y:number}[]} handles - 手柄坐标列表
     */
    _drawHandles(ctx, handles) {
        const hs = HANDLE_SIZE;
        handles.forEach(h => {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
            ctx.strokeStyle = OVERLAY_COLOR;
            ctx.lineWidth = 2;
            ctx.strokeRect(h.x - hs / 2, h.y - hs / 2, hs, hs);
        });
    }

    /**
     * 绘制宫格线
     * @private
     * @param {CanvasRenderingContext2D} ctx - 画布上下文
     * @param {number} cw - 画布宽度
     * @param {number} ch - 画布高度
     */
    _renderGridLines(ctx, cw, ch) {
        const cr = this._getCropRegionCanvas();
        const cropX = cr.x;
        const cropY = cr.y;
        const cropW = cr.width;
        const cropH = cr.height;

        ctx.save();
        ctx.strokeStyle = GRID_COLOR;
        ctx.lineWidth = 1;

        // 绘制竖线（限制在裁剪框内）
        for (let i = 0; i < this.gridVerticalLines.length; i++) {
            const linePos = this.gridVerticalLines[i];
            const x = cropX + linePos * cropW;
            
            // 检查是否是当前拖拽的线
            const isDragging = this.draggingGridLine === 'vertical' && this.draggingGridLineIndex === i;
            
            ctx.beginPath();
            ctx.moveTo(x, cropY);
            ctx.lineTo(x, cropY + cropH);
            ctx.stroke();
            
            // 如果是拖拽中的线，添加高亮效果
            if (isDragging) {
                ctx.save();
                ctx.strokeStyle = OVERLAY_COLOR;
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(x, cropY);
                ctx.lineTo(x, cropY + cropH);
                ctx.stroke();
                ctx.restore();
            }
            
            // 绘制可拖拽的手柄
            this._drawGridLineHandle(ctx, x, cropY + cropH / 2, 'vertical', isDragging);
        }
        
        // 绘制横线（限制在裁剪框内）
        for (let i = 0; i < this.gridHorizontalLines.length; i++) {
            const linePos = this.gridHorizontalLines[i];
            const y = cropY + linePos * cropH;
            
            // 检查是否是当前拖拽的线
            const isDragging = this.draggingGridLine === 'horizontal' && this.draggingGridLineIndex === i;
            
            ctx.beginPath();
            ctx.moveTo(cropX, y);
            ctx.lineTo(cropX + cropW, y);
            ctx.stroke();
            
            // 如果是拖拽中的线，添加高亮效果
            if (isDragging) {
                ctx.save();
                ctx.strokeStyle = OVERLAY_COLOR;
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(cropX, y);
                ctx.lineTo(cropX + cropW, y);
                ctx.stroke();
                ctx.restore();
            }
            
            // 绘制可拖拽的手柄
            this._drawGridLineHandle(ctx, cropX + cropW / 2, y, 'horizontal', isDragging);
        }

        // 高亮选中单元格
        if (this.selectedCell) {
            // 计算竖线位置（包括边界）
            let xPositions = [0];
            xPositions.push(...this.gridVerticalLines);
            xPositions.push(1);
            
            // 计算横线位置（包括边界）
            let yPositions = [0];
            yPositions.push(...this.gridHorizontalLines);
            yPositions.push(1);
            
            // 获取当前单元格的边界
            const x1 = xPositions[this.selectedCell.col];
            const x2 = xPositions[this.selectedCell.col + 1];
            const y1 = yPositions[this.selectedCell.row];
            const y2 = yPositions[this.selectedCell.row + 1];
            
            const sx = cropX + x1 * cropW;
            const sy = cropY + y1 * cropH;
            const sw = (x2 - x1) * cropW;
            const sh = (y2 - y1) * cropH;
            
            ctx.fillStyle = 'rgba(99, 102, 241, 0.2)';
            ctx.fillRect(sx, sy, sw, sh);
            ctx.strokeStyle = OVERLAY_COLOR;
            ctx.lineWidth = 2;
            ctx.strokeRect(sx, sy, sw, sh);
        }

        ctx.restore();
    }

    /**
     * 绘制宫格线拖拽手柄
     * @private
     * @param {CanvasRenderingContext2D} ctx - 画布上下文
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @param {string} type - 线类型：'vertical' | 'horizontal'
     * @param {boolean} isDragging - 是否正在拖拽
     */
    _drawGridLineHandle(ctx, x, y, type, isDragging) {
        const hs = HANDLE_SIZE + 4; // 稍大的手柄
        ctx.save();
        
        // 手柄背景
        ctx.fillStyle = isDragging ? OVERLAY_COLOR : '#ffffff';
        ctx.beginPath();
        if (type === 'vertical') {
            ctx.ellipse(x, y, hs / 2, hs / 3, 0, 0, Math.PI * 2);
        } else {
            ctx.ellipse(x, y, hs / 3, hs / 2, 0, 0, Math.PI * 2);
        }
        ctx.fill();
        
        // 手柄边框
        ctx.strokeStyle = OVERLAY_COLOR;
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (type === 'vertical') {
            ctx.ellipse(x, y, hs / 2, hs / 3, 0, 0, Math.PI * 2);
        } else {
            ctx.ellipse(x, y, hs / 3, hs / 2, 0, 0, Math.PI * 2);
        }
        ctx.stroke();
        
        ctx.restore();
    }

    /**
     * 绘制多边形模式的裁剪叠加层
     * @private
     * @param {CanvasRenderingContext2D} ctx - 画布上下文
     * @param {number} cw - 画布宽度
     * @param {number} ch - 画布高度
     */
    _renderPolygonMode(ctx, cw, ch) {
        if (this.polygonPoints.length < 2) return;

        const scaledPoints = this.polygonPoints.map(p => ({
            x: p.x * this.scale,
            y: p.y * this.scale
        }));

        // 暗色遮罩 + 多边形镂空
        ctx.save();
        ctx.fillStyle = MASK_COLOR;
        ctx.fillRect(0, 0, cw, ch);
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.moveTo(scaledPoints[0].x, scaledPoints[0].y);
        for (let i = 1; i < scaledPoints.length; i++) {
            ctx.lineTo(scaledPoints[i].x, scaledPoints[i].y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        // 多边形边框
        ctx.save();
        ctx.strokeStyle = OVERLAY_COLOR;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.beginPath();
        ctx.moveTo(scaledPoints[0].x, scaledPoints[0].y);
        for (let i = 1; i < scaledPoints.length; i++) {
            ctx.lineTo(scaledPoints[i].x, scaledPoints[i].y);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();

        // 顶点手柄
        scaledPoints.forEach((p, idx) => {
            ctx.fillStyle = idx === this.dragPointIndex ? '#ffffff' : POLYGON_POINT_COLOR;
            ctx.beginPath();
            ctx.arc(p.x, p.y, HANDLE_SIZE / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();
        });
    }

    /**
     * Canvas 鼠标按下事件
     * @private
     * @param {MouseEvent} e - 鼠标事件
     */
    _onMouseDown(e) {
        if (!this.isImageLoaded) return;

        const pos = this._getCanvasPos(e);
        const imagePos = { x: pos.x / this.scale, y: pos.y / this.scale };

        // 宫格模式下检测宫格线拖拽
        if (this.gridMode !== 'none') {
            const gridLineHit = this._hitTestGridLine(pos);
            if (gridLineHit) {
                this.draggingGridLine = gridLineHit.type;
                this.draggingGridLineIndex = gridLineHit.index;
                this.gridLineDragStart = { ...pos };
                this._render();
                return;
            }
        }

        if (this.shape === SHAPE_POLYGON) {
            // 检查是否点击了现有多边形顶点
            const pointIdx = this._hitTestPolygonPoints(pos);
            if (pointIdx >= 0) {
                this.dragPointIndex = pointIdx;
                this.isDragging = true;
                this._render();
                return;
            }
            // 检查是否点击在多边形内部（移动整个多边形）
            if (this._isInsidePolygon(imagePos)) {
                this.isDragging = true;
                this.dragHandle = 'move';
                this.dragStart = pos;
                this.dragStartRegion = { ...this.cropRegion };
                this._dragPolygonStart = {
                    points: this.polygonPoints.map(p => ({ ...p }))
                };
                this._render();
                return;
            }
            // 否则不处理，由双击添加新点
            return;
        }

        // 形状模式：检测手柄
        const handle = this._hitTestHandle(pos);
        if (handle) {
            this.isDragging = true;
            this.dragHandle = handle;
            this.dragStart = pos;
            this.dragStartRegion = { ...this.cropRegion };
            this._render();
            return;
        }

        // 检测是否在裁剪区域内部（移动模式）
        if (this._isInsideCropRegion(imagePos)) {
            this.isDragging = true;
            this.dragHandle = 'move';
            this.dragStart = pos;
            this.dragStartRegion = { ...this.cropRegion };
            this.canvas.style.cursor = 'move';
            this._render();
            return;
        }

        // 不在裁剪区域内：开始绘制新的裁剪区域
        this.isDragging = true;
        this.dragHandle = 'draw';
        this.dragStart = imagePos;
        this.dragStartRegion = { ...this.cropRegion };
        this.cropRegion = {
            x: imagePos.x,
            y: imagePos.y,
            width: 0,
            height: 0
        };
        this._render();
    }

    /**
     * Canvas 鼠标移动事件
     * @private
     * @param {MouseEvent} e - 鼠标事件
     */
    _onMouseMove(e) {
        if (!this.isImageLoaded) return;

        const pos = this._getCanvasPos(e);
        const imagePos = { x: pos.x / this.scale, y: pos.y / this.scale };

        // 宫格线拖拽处理
        if (this.draggingGridLine !== null) {
            this._handleGridLineDrag(pos);
            return;
        }

        if (this.isDragging) {
            this._handleDrag(imagePos);
            return;
        }

        // 更新鼠标样式
        if (this.shape === SHAPE_POLYGON) {
            if (this._hitTestPolygonPoints(pos) >= 0) {
                this.canvas.style.cursor = 'pointer';
            } else if (this._isInsidePolygon(imagePos)) {
                this.canvas.style.cursor = 'move';
            } else {
                this.canvas.style.cursor = 'crosshair';
            }
        } else {
            // 宫格线手柄检测
            if (this.gridMode !== 'none') {
                const gridLineHit = this._hitTestGridLine(pos);
                if (gridLineHit) {
                    this.canvas.style.cursor = gridLineHit.type === 'vertical' ? 'ew-resize' : 'ns-resize';
                    return;
                }
            }
            
            const handle = this._hitTestHandle(pos);
            if (handle) {
                const cursors = {
                    nw: 'nwse-resize', se: 'nwse-resize',
                    ne: 'nesw-resize', sw: 'nesw-resize',
                    n: 'ns-resize', s: 'ns-resize',
                    w: 'ew-resize', e: 'ew-resize'
                };
                this.canvas.style.cursor = cursors[handle] || 'default';
            } else if (this._isInsideCropRegion(imagePos)) {
                this.canvas.style.cursor = 'move';
            } else {
                this.canvas.style.cursor = 'crosshair';
            }
        }
    }

    /**
     * Canvas 鼠标抬起事件
     * @private
     * @param {MouseEvent} e - 鼠标事件
     */
    _onMouseUp(e) {
        // 宫格线拖拽结束
        if (this.draggingGridLine !== null) {
            this.draggingGridLine = null;
            this.draggingGridLineIndex = -1;
            this._updateGridCellsPanel();
            this._render();
            return;
        }

        if (!this.isDragging) return;

        // 如果是绘制模式且区域太小，重置为初始
        if (this.dragHandle === 'draw') {
            if (Math.abs(this.cropRegion.width) < MIN_CROP_SIZE ||
                Math.abs(this.cropRegion.height) < MIN_CROP_SIZE) {
                this.cropRegion = { ...this.dragStartRegion };
            }
        }

        this.isDragging = false;
        this.dragHandle = null;
        this.dragPointIndex = -1;
        this._dragPolygonStart = null;
        this.canvas.style.cursor = 'crosshair';
        this._normalizeCropRegion();
        this._updateInfoDisplay();
        this._render();
    }

    /**
     * 处理拖拽逻辑
     * @private
     * @param {{x:number,y:number}} imagePos - 当前鼠标在图片坐标系中的位置
     */
    _handleDrag(imagePos) {
        if (this.shape === SHAPE_POLYGON) {
            this._handlePolygonDrag(imagePos);
            return;
        }

        const r = this.dragStartRegion;
        if (!r) return;

        switch (this.dragHandle) {
            case 'draw':
                this.cropRegion = {
                    x: Math.min(this.dragStart.x, imagePos.x),
                    y: Math.min(this.dragStart.y, imagePos.y),
                    width: Math.abs(imagePos.x - this.dragStart.x),
                    height: Math.abs(imagePos.y - this.dragStart.y)
                };
                break;

            case 'move': {
                const dx = imagePos.x - this.dragStart.x / this.scale;
                const dy = imagePos.y - this.dragStart.y / this.scale;
                this.cropRegion = {
                    x: Math.max(0, Math.min(this.image.width - r.width, r.x + dx)),
                    y: Math.max(0, Math.min(this.image.height - r.height, r.y + dy)),
                    width: r.width,
                    height: r.height
                };
                break;
            }

            case 'nw':
                this.cropRegion = {
                    x: Math.min(imagePos.x, r.x + r.width - MIN_CROP_SIZE),
                    y: Math.min(imagePos.y, r.y + r.height - MIN_CROP_SIZE),
                    width: r.x + r.width - Math.max(0, imagePos.x),
                    height: r.y + r.height - Math.max(0, imagePos.y)
                };
                break;

            case 'ne':
                this.cropRegion = {
                    x: r.x,
                    y: Math.min(imagePos.y, r.y + r.height - MIN_CROP_SIZE),
                    width: Math.max(MIN_CROP_SIZE, imagePos.x - r.x),
                    height: r.y + r.height - Math.max(0, imagePos.y)
                };
                break;

            case 'sw':
                this.cropRegion = {
                    x: Math.min(imagePos.x, r.x + r.width - MIN_CROP_SIZE),
                    y: r.y,
                    width: r.x + r.width - Math.max(0, imagePos.x),
                    height: Math.max(MIN_CROP_SIZE, imagePos.y - r.y)
                };
                break;

            case 'se':
                this.cropRegion = {
                    x: r.x,
                    y: r.y,
                    width: Math.max(MIN_CROP_SIZE, imagePos.x - r.x),
                    height: Math.max(MIN_CROP_SIZE, imagePos.y - r.y)
                };
                break;

            case 'n':
                this.cropRegion = {
                    x: r.x,
                    y: Math.min(imagePos.y, r.y + r.height - MIN_CROP_SIZE),
                    width: r.width,
                    height: r.y + r.height - Math.max(0, imagePos.y)
                };
                break;

            case 's':
                this.cropRegion = {
                    x: r.x, y: r.y,
                    width: r.width,
                    height: Math.max(MIN_CROP_SIZE, imagePos.y - r.y)
                };
                break;

            case 'w':
                this.cropRegion = {
                    x: Math.min(imagePos.x, r.x + r.width - MIN_CROP_SIZE),
                    y: r.y,
                    width: r.x + r.width - Math.max(0, imagePos.x),
                    height: r.height
                };
                break;

            case 'e':
                this.cropRegion = {
                    x: r.x, y: r.y,
                    width: Math.max(MIN_CROP_SIZE, imagePos.x - r.x),
                    height: r.height
                };
                break;
        }

        this._clampCropRegion();
        this._updateInfoDisplay();
        this._render();
    }

    /**
     * 处理多边形的拖拽
     * @private
     * @param {{x:number,y:number}} imagePos - 当前鼠标位置
     */
    _handlePolygonDrag(imagePos) {
        if (this.dragPointIndex >= 0 && this._dragPolygonStart) {
            this.polygonPoints[this.dragPointIndex] = {
                x: Math.max(0, Math.min(this.image.width, imagePos.x)),
                y: Math.max(0, Math.min(this.image.height, imagePos.y))
            };
        } else if (this.dragHandle === 'move' && this._dragPolygonStart) {
            const dx = imagePos.x - this.dragStart.x / this.scale;
            const dy = imagePos.y - this.dragStart.y / this.scale;
            const bbox = this._getPolygonBBox(this._dragPolygonStart.points);
            const clampDx = Math.max(-bbox.minX, Math.min(this.image.width - bbox.maxX, dx));
            const clampDy = Math.max(-bbox.minY, Math.min(this.image.height - bbox.maxY, dy));
            this.polygonPoints = this._dragPolygonStart.points.map(p => ({
                x: p.x + clampDx,
                y: p.y + clampDy
            }));
        }
        this._updateInfoDisplay();
        this._render();
    }

    /**
     * 检测宫格线手柄点击
     * @private
     * @param {{x:number,y:number}} pos - 画布坐标
     * @returns {object|null} 点击信息或null
     */
    _hitTestGridLine(pos) {
        const cr = this._getCropRegionCanvas();
        const cropX = cr.x;
        const cropY = cr.y;
        const cropW = cr.width;
        const cropH = cr.height;
        const hs = HANDLE_SIZE + 8; // 稍大的命中区域

        // 检测竖线
        for (let i = 0; i < this.gridVerticalLines.length; i++) {
            const linePos = this.gridVerticalLines[i];
            const x = cropX + linePos * cropW;
            const y = cropY + cropH / 2;
            if (Math.abs(pos.x - x) <= hs / 2 && Math.abs(pos.y - y) <= hs / 2) {
                return { type: 'vertical', index: i };
            }
        }

        // 检测横线
        for (let i = 0; i < this.gridHorizontalLines.length; i++) {
            const linePos = this.gridHorizontalLines[i];
            const x = cropX + cropW / 2;
            const y = cropY + linePos * cropH;
            if (Math.abs(pos.x - x) <= hs / 2 && Math.abs(pos.y - y) <= hs / 2) {
                return { type: 'horizontal', index: i };
            }
        }

        return null;
    }

    /**
     * 处理宫格线拖拽
     * @private
     * @param {{x:number,y:number}} pos - 当前画布坐标
     */
    _handleGridLineDrag(pos) {
        const cr = this._getCropRegionCanvas();
        const cropX = cr.x;
        const cropY = cr.y;
        const cropW = cr.width;
        const cropH = cr.height;

        if (this.draggingGridLine === 'vertical') {
            // 限制在裁剪框内且与相邻线保持最小距离
            const minDistance = 0.05; // 最小5%的距离
            let newPos = (pos.x - cropX) / cropW;
            
            // 限制在裁剪框内
            newPos = Math.max(0.01, Math.min(0.99, newPos));
            
            // 与前一条线保持最小距离
            if (this.draggingGridLineIndex > 0) {
                const prevLine = this.gridVerticalLines[this.draggingGridLineIndex - 1];
                newPos = Math.max(prevLine + minDistance, newPos);
            }
            
            // 与后一条线保持最小距离
            if (this.draggingGridLineIndex < this.gridVerticalLines.length - 1) {
                const nextLine = this.gridVerticalLines[this.draggingGridLineIndex + 1];
                newPos = Math.min(nextLine - minDistance, newPos);
            }
            
            this.gridVerticalLines[this.draggingGridLineIndex] = newPos;
        } else if (this.draggingGridLine === 'horizontal') {
            // 限制在裁剪框内且与相邻线保持最小距离
            const minDistance = 0.05; // 最小5%的距离
            let newPos = (pos.y - cropY) / cropH;
            
            // 限制在裁剪框内
            newPos = Math.max(0.01, Math.min(0.99, newPos));
            
            // 与前一条线保持最小距离
            if (this.draggingGridLineIndex > 0) {
                const prevLine = this.gridHorizontalLines[this.draggingGridLineIndex - 1];
                newPos = Math.max(prevLine + minDistance, newPos);
            }
            
            // 与后一条线保持最小距离
            if (this.draggingGridLineIndex < this.gridHorizontalLines.length - 1) {
                const nextLine = this.gridHorizontalLines[this.draggingGridLineIndex + 1];
                newPos = Math.min(nextLine - minDistance, newPos);
            }
            
            this.gridHorizontalLines[this.draggingGridLineIndex] = newPos;
        }
        
        this._render();
    }

    /**
     * 获取多边形的包围盒
     * @private
     * @param {{x:number,y:number}[]} points - 多边形顶点
     * @returns {{minX:number,minY:number,maxX:number,maxY:number}}
     */
    _getPolygonBBox(points) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        points.forEach(p => {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        });
        return { minX, minY, maxX, maxY };
    }

    /**
     * 双击事件：多边形模式下添加新顶点
     * @private
     * @param {MouseEvent} e - 鼠标事件
     */
    _onDoubleClick(e) {
        if (this.shape !== SHAPE_POLYGON) return;
        e.preventDefault();

        const pos = this._getCanvasPos(e);
        const imagePos = { x: pos.x / this.scale, y: pos.y / this.scale };

        // 如果双击靠近第一个点，闭合多边形
        if (this.polygonPoints.length >= 3) {
            const first = this.polygonPoints[0];
            const dist = Math.hypot(imagePos.x - first.x, imagePos.y - first.y);
            if (dist < 15 / this.scale) {
                // 已经闭合，不操作
                return;
            }
        }

        // 添加新顶点
        this.polygonPoints.push({
            x: Math.max(0, Math.min(this.image.width, imagePos.x)),
            y: Math.max(0, Math.min(this.image.height, imagePos.y))
        });
        this._updateInfoDisplay();
        this._render();
    }

    /**
     * 键盘事件处理
     * @private
     * @param {KeyboardEvent} e - 键盘事件
     */
    _onKeyDown(e) {
        if (!this.isImageLoaded) return;

        if (e.key === 'Enter' && this.shape === SHAPE_POLYGON) {
            e.preventDefault();
            // Enter 闭合多边形（至少3个顶点）
            if (this.polygonPoints.length >= 3) {
                // 多边形已自动闭合，只需完成编辑
                this._render();
            }
        } else if (e.key === 'Escape') {
            this._resetCrop();
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            if (this.shape === SHAPE_POLYGON && this.polygonPoints.length > 0) {
                this.polygonPoints.pop();
                this._updateInfoDisplay();
                this._render();
            }
        }
    }

    /**
     * 测试是否点击在多边形内部（射线法）
     * @private
     * @param {{x:number,y:number}} pos - 图片坐标
     * @returns {boolean}
     */
    _isInsidePolygon(pos) {
        if (this.polygonPoints.length < 3) return false;
        let inside = false;
        const pts = this.polygonPoints;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const xi = pts[i].x, yi = pts[i].y;
            const xj = pts[j].x, yj = pts[j].y;
            if ((yi > pos.y) !== (yj > pos.y) &&
                pos.x < (xj - xi) * (pos.y - yi) / (yj - yi) + xi) {
                inside = !inside;
            }
        }
        return inside;
    }

    /**
     * 测试是否在多边形顶点上点击
     * @private
     * @param {{x:number,y:number}} canvasPos - 画布坐标
     * @returns {number} 顶点索引，-1 表示未命中
     */
    _hitTestPolygonPoints(canvasPos) {
        for (let i = 0; i < this.polygonPoints.length; i++) {
            const p = this.polygonPoints[i];
            const sx = p.x * this.scale;
            const sy = p.y * this.scale;
            if (Math.hypot(canvasPos.x - sx, canvasPos.y - sy) < HANDLE_SIZE) {
                return i;
            }
        }
        return -1;
    }

    /**
     * 测试点是否在裁剪区域内
     * @private
     * @param {{x:number,y:number}} imagePos - 图片坐标
     * @returns {boolean}
     */
    _isInsideCropRegion(imagePos) {
        const r = this.cropRegion;
        if (this.shape === SHAPE_CIRCLE) {
            const cx = r.x + r.width / 2;
            const cy = r.y + r.height / 2;
            const radiusX = Math.min(r.width, r.height) / 2;
            const radiusY = Math.min(r.width, r.height) / 2;
            return ((imagePos.x - cx) ** 2) / (radiusX ** 2) + ((imagePos.y - cy) ** 2) / (radiusY ** 2) <= 1;
        }
        if (this.shape === SHAPE_ELLIPSE) {
            const cx = r.x + r.width / 2;
            const cy = r.y + r.height / 2;
            const rx = r.width / 2;
            const ry = r.height / 2;
            return ((imagePos.x - cx) ** 2) / (rx ** 2) + ((imagePos.y - cy) ** 2) / (ry ** 2) <= 1;
        }
        return imagePos.x >= r.x && imagePos.x <= r.x + r.width &&
               imagePos.y >= r.y && imagePos.y <= r.y + r.height;
    }

    /**
     * 检测手柄命中（形状模式）
     * @private
     * @param {{x:number,y:number}} canvasPos - 画布坐标
     * @returns {string|null} 手柄标识或 null
     */
    _hitTestHandle(canvasPos) {
        const cr = this._getCropRegionCanvas();
        const hs = HANDLE_SIZE + 4; // 稍大的命中区域

        if (this.shape === SHAPE_CIRCLE || this.shape === SHAPE_ELLIPSE) {
            const cx = cr.x + cr.width / 2;
            const cy = cr.y + cr.height / 2;
            const rx = cr.width / 2;
            const ry = cr.height / 2;
            const testPoints = [
                { id: 'n', x: cx, y: cy - ry },
                { id: 's', x: cx, y: cy + ry },
                { id: 'w', x: cx - rx, y: cy },
                { id: 'e', x: cx + rx, y: cy },
                { id: 'nw', x: cx - rx, y: cy - ry },
                { id: 'ne', x: cx + rx, y: cy - ry },
                { id: 'sw', x: cx - rx, y: cy + ry },
                { id: 'se', x: cx + rx, y: cy + ry }
            ];
            for (const tp of testPoints) {
                if (Math.abs(canvasPos.x - tp.x) <= hs / 2 && Math.abs(canvasPos.y - tp.y) <= hs / 2) {
                    return tp.id;
                }
            }
        } else {
            const handleDefs = [
                { id: 'nw', x: cr.x, y: cr.y },
                { id: 'ne', x: cr.x + cr.width, y: cr.y },
                { id: 'sw', x: cr.x, y: cr.y + cr.height },
                { id: 'se', x: cr.x + cr.width, y: cr.y + cr.height },
                { id: 'n', x: cr.x + cr.width / 2, y: cr.y },
                { id: 's', x: cr.x + cr.width / 2, y: cr.y + cr.height },
                { id: 'w', x: cr.x, y: cr.y + cr.height / 2 },
                { id: 'e', x: cr.x + cr.width, y: cr.y + cr.height / 2 }
            ];
            for (const hd of handleDefs) {
                if (Math.abs(canvasPos.x - hd.x) <= hs / 2 && Math.abs(canvasPos.y - hd.y) <= hs / 2) {
                    return hd.id;
                }
            }
        }
        return null;
    }

    /**
     * 获取鼠标在画布上的坐标
     * @private
     * @param {MouseEvent} e - 鼠标事件
     * @returns {{x:number,y:number}}
     */
    _getCanvasPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    /**
     * 将裁剪区域限制在图片范围内
     * @private
     */
    _clampCropRegion() {
        const r = this.cropRegion;
        const imgW = this.image.width;
        const imgH = this.image.height;

        if (r.x < 0) { r.width += r.x; r.x = 0; }
        if (r.y < 0) { r.height += r.y; r.y = 0; }
        if (r.x + r.width > imgW) r.width = imgW - r.x;
        if (r.y + r.height > imgH) r.height = imgH - r.y;
        if (r.width < MIN_CROP_SIZE) r.width = MIN_CROP_SIZE;
        if (r.height < MIN_CROP_SIZE) r.height = MIN_CROP_SIZE;
    }

    /**
     * 规范化裁剪区域（确保 width/height 为正）
     * @private
     */
    _normalizeCropRegion() {
        const r = this.cropRegion;
        if (r.width < 0) {
            r.x += r.width;
            r.width = -r.width;
        }
        if (r.height < 0) {
            r.y += r.height;
            r.height = -r.height;
        }
        this._clampCropRegion();
    }

    /**
     * 重置裁剪区域
     * @private
     */
    _resetCrop() {
        if (!this.image) return;

        const margin = 0.1;
        this.cropRegion = {
            x: Math.round(this.image.width * margin),
            y: Math.round(this.image.height * margin),
            width: Math.round(this.image.width * (1 - margin * 2)),
            height: Math.round(this.image.height * (1 - margin * 2))
        };

        if (this.shape === SHAPE_POLYGON) {
            const r = this.cropRegion;
            this.polygonPoints = [
                { x: r.x, y: r.y },
                { x: r.x + r.width, y: r.y },
                { x: r.x + r.width, y: r.y + r.height },
                { x: r.x, y: r.y + r.height }
            ];
        }

        this.selectedCell = null;
        this._updateInfoDisplay();
        this._updateGridCellsPanel();
        this._render();
    }

    /**
     * 更新信息显示
     * @private
     */
    _updateInfoDisplay() {
        if (!this.image) return;
        this.dom.cropInfoRow.style.display = 'flex';
        this.dom.originalSizeInfo.textContent = `${this.image.width} × ${this.image.height} px`;

        if (this.shape === SHAPE_POLYGON) {
            const bbox = this._getPolygonBBox(this.polygonPoints);
            const w = Math.round(bbox.maxX - bbox.minX);
            const h = Math.round(bbox.maxY - bbox.minY);
            this.dom.cropSizeInfo.textContent = this.polygonPoints.length >= 3 ?
                `~${w} × ${h} px (${this.polygonPoints.length} 顶点)` : '—';
        } else {
            this.dom.cropSizeInfo.textContent =
                `${Math.round(this.cropRegion.width)} × ${Math.round(this.cropRegion.height)} px`;
        }
    }

    // ==================== 宫格单元格面板 ====================

    /**
     * 更新宫格单元格面板
     * @private
     */
    _updateGridCellsPanel() {
        const panel = this.dom.gridCellsPanel;
        const grid = this.dom.gridCellsGrid;

        if (this.gridMode === 'none' || !this.isImageLoaded) {
            panel.classList.remove('visible');
            return;
        }

        panel.classList.add('visible');
        grid.style.gridTemplateColumns = `repeat(${this.gridCols}, 1fr)`;
        grid.innerHTML = '';

        for (let row = 0; row < this.gridRows; row++) {
            for (let col = 0; col < this.gridCols; col++) {
                const cell = this._createGridCellElement(row, col);
                grid.appendChild(cell);
            }
        }

        this.dom.exportSelectedCellBtn.disabled = !this.selectedCell;
    }

    /**
     * 创建宫格单元格 DOM 元素
     * @private
     * @param {number} row - 行索引
     * @param {number} col - 列索引
     * @returns {HTMLElement}
     */
    _createGridCellElement(row, col) {
        const item = document.createElement('div');
        item.className = 'grid-cell-item';
        if (this.selectedCell && this.selectedCell.row === row && this.selectedCell.col === col) {
            item.classList.add('selected');
        }

        // 缩略图
        const thumb = document.createElement('canvas');
        thumb.width = 100;
        thumb.height = 100;
        this._drawGridCellThumb(thumb, row, col);
        item.appendChild(thumb);

        // 标签
        const label = document.createElement('span');
        label.className = 'cell-label';
        label.textContent = `${row + 1}-${col + 1}`;
        item.appendChild(label);

        // 选中标记
        const check = document.createElement('span');
        check.className = 'cell-check';
        check.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
        item.appendChild(check);

        item.addEventListener('click', () => {
            this.selectedCell = { row, col };
            this._updateGridCellsPanel();
            this._render();
        });

        return item;
    }

    /**
     * 获取宫格单元格的位置和大小（相对裁剪框）
     * @private
     * @param {number} row - 行索引
     * @param {number} col - 列索引
     * @returns {{x:number, y:number, width:number, height:number}}
     */
    _getGridCellBounds(row, col) {
        // 计算裁剪框内的宫格单元格位置
        const cropR = this.cropRegion;
        
        // 计算竖线位置（包括边界）
        let xPositions = [0];
        xPositions.push(...this.gridVerticalLines);
        xPositions.push(1);
        
        // 计算横线位置（包括边界）
        let yPositions = [0];
        yPositions.push(...this.gridHorizontalLines);
        yPositions.push(1);
        
        // 获取当前单元格的边界
        const x1 = xPositions[col];
        const x2 = xPositions[col + 1];
        const y1 = yPositions[row];
        const y2 = yPositions[row + 1];
        
        // 转换为图片坐标
        return {
            x: cropR.x + x1 * cropR.width,
            y: cropR.y + y1 * cropR.height,
            width: (x2 - x1) * cropR.width,
            height: (y2 - y1) * cropR.height
        };
    }

    /**
     * 绘制宫格单元格缩略图
     * @private
     * @param {HTMLCanvasElement} canvas - 目标画布
     * @param {number} row - 行索引
     * @param {number} col - 列索引
     */
    _drawGridCellThumb(canvas, row, col) {
        if (!this.image) return;
        const ctx = canvas.getContext('2d');
        const cell = this._getGridCellBounds(row, col);
        ctx.drawImage(this.image,
            cell.x, cell.y, cell.width, cell.height,
            0, 0, canvas.width, canvas.height
        );
    }

    // ==================== 导出功能 ====================

    /**
     * 导出当前裁剪结果
     * @private
     */
    _exportCrop() {
        if (!this.image) return;

        const outputCanvas = document.createElement('canvas');
        let cropX, cropY, cropW, cropH;

        if (this.shape === SHAPE_POLYGON && this.polygonPoints.length >= 3) {
            const bbox = this._getPolygonBBox(this.polygonPoints);
            cropX = bbox.minX;
            cropY = bbox.minY;
            cropW = bbox.maxX - bbox.minX;
            cropH = bbox.maxY - bbox.minY;

            outputCanvas.width = cropW;
            outputCanvas.height = cropH;
            const octx = outputCanvas.getContext('2d');

            // 使用多边形裁剪路径
            octx.beginPath();
            octx.moveTo(
                this.polygonPoints[0].x - cropX,
                this.polygonPoints[0].y - cropY
            );
            for (let i = 1; i < this.polygonPoints.length; i++) {
                octx.lineTo(
                    this.polygonPoints[i].x - cropX,
                    this.polygonPoints[i].y - cropY
                );
            }
            octx.closePath();
            octx.clip();
            octx.drawImage(this.image, -cropX, -cropY);
        } else if (this.shape === SHAPE_CIRCLE || this.shape === SHAPE_ELLIPSE) {
            const r = this.cropRegion;
            cropX = r.x;
            cropY = r.y;
            cropW = r.width;
            cropH = r.height;

            outputCanvas.width = cropW;
            outputCanvas.height = cropH;
            const octx = outputCanvas.getContext('2d');

            // 椭圆/圆形裁剪
            octx.beginPath();
            if (this.shape === SHAPE_CIRCLE) {
                const radius = Math.min(cropW, cropH) / 2;
                octx.arc(cropW / 2, cropH / 2, radius, 0, Math.PI * 2);
            } else {
                octx.ellipse(cropW / 2, cropH / 2, cropW / 2, cropH / 2, 0, 0, Math.PI * 2);
            }
            octx.clip();
            octx.drawImage(this.image, -cropX, -cropY);
        } else {
            const r = this.cropRegion;
            cropX = r.x;
            cropY = r.y;
            cropW = r.width;
            cropH = r.height;

            outputCanvas.width = cropW;
            outputCanvas.height = cropH;
            const octx = outputCanvas.getContext('2d');
            octx.drawImage(this.image, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        }

        this._downloadCanvas(outputCanvas, 'cropped.png');
    }

    /**
     * 导出选中的宫格单元格
     * @private
     */
    _exportSelectedCell() {
        if (!this.image || !this.selectedCell) return;
        this._exportGridCell(this.selectedCell.row, this.selectedCell.col);
    }

    /**
     * 导出全部宫格单元格（压缩包形式）
     * @private
     */
    async _exportAllCells() {
        if (!this.image || this.gridMode === 'none') return;

        try {
            const files = [];
            
            // 生成所有单元格的图像
            for (let row = 0; row < this.gridRows; row++) {
                for (let col = 0; col < this.gridCols; col++) {
                    const blob = await this._getGridCellBlob(row, col);
                    if (blob) {
                        files.push({
                            name: `grid_${row + 1}x${col + 1}.png`,
                            blob: blob
                        });
                    }
                }
            }
            
            // 创建压缩包并下载
            const zipBlob = await createZip(files);
            const zipName = `cropped_images_${Date.now()}.zip`;
            this._downloadBlob(zipBlob, zipName);
        } catch (error) {
            console.error('Failed to export all cells:', error);
            alert('批量下载失败，请重试');
        }
    }

    /**
     * 导出单个宫格单元格
     * @private
     * @param {number} row - 行索引
     * @param {number} col - 列索引
     */
    async _exportGridCell(row, col) {
        if (!this.image) return;
        const blob = await this._getGridCellBlob(row, col);
        if (blob) {
            this._downloadBlob(blob, `grid_${row + 1}x${col + 1}.png`);
        }
    }

    /**
     * 获取宫格单元格的Blob对象
     * @private
     * @param {number} row - 行索引
     * @param {number} col - 列索引
     * @returns {Promise<Blob>}
     */
    _getGridCellBlob(row, col) {
        return new Promise((resolve) => {
            const cell = this._getGridCellBounds(row, col);
            
            const outputCanvas = document.createElement('canvas');
            outputCanvas.width = Math.round(cell.width);
            outputCanvas.height = Math.round(cell.height);
            const octx = outputCanvas.getContext('2d');
            octx.drawImage(this.image,
                cell.x, cell.y, cell.width, cell.height,
                0, 0,
                Math.round(cell.width), Math.round(cell.height)
            );
            
            outputCanvas.toBlob(resolve, 'image/png');
        });
    }

    /**
     * 下载 Canvas 为 PNG 文件
     * @private
     * @param {HTMLCanvasElement} canvas - 画布
     * @param {string} filename - 文件名
     */
    _downloadCanvas(canvas, filename) {
        canvas.toBlob(blob => {
            if (!blob) return;
            this._downloadBlob(blob, filename);
        }, 'image/png');
    }

    /**
     * 下载 Blob 对象
     * @private
     * @param {Blob} blob - Blob 对象
     * @param {string} filename - 文件名
     */
    _downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * 返回到上传视图
     * @private
     */
    _showUpload() {
        this.isImageLoaded = false;
        this.image = null;
        this.polygonPoints = [];
        this.selectedCell = null;
        this.dom.cropWorkspace.classList.remove('visible');
        this.dom.uploadSection.classList.add('visible');
        this.dom.cropInfoRow.style.display = 'none';
    }
}

/** 页面入口：DOM 加载完成后初始化 */
document.addEventListener('DOMContentLoaded', () => {
    const app = new CropApp();
    app.init().catch(console.error);
});
