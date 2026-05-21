/**
 * 选区变换管理器模块
 * 提供选区的平移和缩放功能
 */

/**
 * 控制点类型枚举
 */
export const HandleType = {
    NONE: 'none',
    TOP_LEFT: 'topLeft',
    TOP: 'top',
    TOP_RIGHT: 'topRight',
    RIGHT: 'right',
    BOTTOM_RIGHT: 'bottomRight',
    BOTTOM: 'bottom',
    BOTTOM_LEFT: 'bottomLeft',
    LEFT: 'left',
    MOVE: 'move'
};

/**
 * 选区变换管理器类
 */
export class SelectionTransformManager {
    /**
     * 构造函数
     * @param {HTMLCanvasElement} overlayCanvas - 覆盖层Canvas
     */
    constructor(overlayCanvas) {
        this.overlayCanvas = overlayCanvas;
        this.ctx = overlayCanvas.getContext('2d');

        this.selectionBounds = null;
        this.isActive = false;

        this.handleSize = 10;
        this.handleColor = '#ff6b35';
        this.borderColor = '#ff6b35';
        this.fillColor = 'rgba(255, 107, 53, 0.1)';

        this.currentHandle = HandleType.NONE;
        this.isDragging = false;
        this.dragStart = { x: 0, y: 0 };
        this.originalBounds = null;

        this.minSize = 20;
    }

    /**
     * 设置选区边界
     * @param {Object} bounds - 边界对象 {x, y, width, height}
     */
    setSelectionBounds(bounds) {
        this.selectionBounds = { ...bounds };
        this.isActive = true;
        this.draw();
    }

    /**
     * 获取当前选区边界
     * @returns {Object|null} 边界对象
     */
    getSelectionBounds() {
        return this.selectionBounds;
    }

    /**
     * 清除选区
     */
    clear() {
        this.selectionBounds = null;
        this.isActive = false;
        this.currentHandle = HandleType.NONE;
        this.isDragging = false;
        this.ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    }

    /**
     * 绘制选择框和控制点
     */
    draw() {
        if (!this.isActive || !this.selectionBounds) return;

        const { x, y, width, height } = this.selectionBounds;

        this.ctx.fillStyle = this.fillColor;
        this.ctx.fillRect(x, y, width, height);

        this.ctx.strokeStyle = this.borderColor;
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 5]);
        this.ctx.strokeRect(x, y, width, height);
        this.ctx.setLineDash([]);

        this.drawHandles();
    }

    /**
     * 绘制控制点
     */
    drawHandles() {
        const handles = this.getHandlePositions();

        this.ctx.fillStyle = this.handleColor;
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 2;

        for (const handle of Object.values(handles)) {
            this.ctx.beginPath();
            this.ctx.rect(
                handle.x - this.handleSize / 2,
                handle.y - this.handleSize / 2,
                this.handleSize,
                this.handleSize
            );
            this.ctx.fill();
            this.ctx.stroke();
        }
    }

    /**
     * 获取所有控制点位置
     * @returns {Object} 控制点位置映射
     */
    getHandlePositions() {
        if (!this.selectionBounds) return {};

        const { x, y, width, height } = this.selectionBounds;
        const cx = x + width / 2;
        const cy = y + height / 2;

        return {
            [HandleType.TOP_LEFT]: { x: x, y: y },
            [HandleType.TOP]: { x: cx, y: y },
            [HandleType.TOP_RIGHT]: { x: x + width, y: y },
            [HandleType.RIGHT]: { x: x + width, y: cy },
            [HandleType.BOTTOM_RIGHT]: { x: x + width, y: y + height },
            [HandleType.BOTTOM]: { x: cx, y: y + height },
            [HandleType.BOTTOM_LEFT]: { x: x, y: y + height },
            [HandleType.LEFT]: { x: x, y: cy }
        };
    }

    /**
     * 检测鼠标位置对应的控制点类型
     * @param {number} mx - 鼠标X坐标
     * @param {number} my - 鼠标Y坐标
     * @returns {string} 控制点类型
     */
    hitTest(mx, my) {
        if (!this.isActive || !this.selectionBounds) {
            return HandleType.NONE;
        }

        const handles = this.getHandlePositions();
        const hitRadius = this.handleSize + 4;

        for (const [type, pos] of Object.entries(handles)) {
            const dx = mx - pos.x;
            const dy = my - pos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist <= hitRadius) {
                return type;
            }
        }

        const { x, y, width, height } = this.selectionBounds;
        if (mx >= x && mx <= x + width && my >= y && my <= y + height) {
            return HandleType.MOVE;
        }

        return HandleType.NONE;
    }

    /**
     * 获取控制点对应的鼠标光标样式
     * @param {string} handleType - 控制点类型
     * @returns {string} 光标样式
     */
    getCursor(handleType) {
        switch (handleType) {
            case HandleType.TOP_LEFT:
            case HandleType.BOTTOM_RIGHT:
                return 'nwse-resize';
            case HandleType.TOP_RIGHT:
            case HandleType.BOTTOM_LEFT:
                return 'nesw-resize';
            case HandleType.TOP:
            case HandleType.BOTTOM:
                return 'ns-resize';
            case HandleType.LEFT:
            case HandleType.RIGHT:
                return 'ew-resize';
            case HandleType.MOVE:
                return 'move';
            default:
                return 'default';
        }
    }

    /**
     * 开始拖拽操作
     * @param {number} mx - 鼠标X坐标
     * @param {number} my - 鼠标Y坐标
     * @returns {boolean} 是否开始拖拽
     */
    startDrag(mx, my) {
        if (!this.isActive || !this.selectionBounds) return false;

        this.currentHandle = this.hitTest(mx, my);
        if (this.currentHandle === HandleType.NONE) return false;

        this.isDragging = true;
        this.dragStart = { x: mx, y: my };
        this.originalBounds = { ...this.selectionBounds };

        return true;
    }

    /**
     * 更新拖拽操作
     * @param {number} mx - 鼠标X坐标
     * @param {number} my - 鼠标Y坐标
     * @param {boolean} shiftKey - 是否按下Shift键（等比例缩放）
     * @returns {Object|null} 新的边界对象
     */
    updateDrag(mx, my, shiftKey = false) {
        if (!this.isDragging || !this.originalBounds) return null;

        const dx = mx - this.dragStart.x;
        const dy = my - this.dragStart.y;

        let newBounds = { ...this.originalBounds };

        switch (this.currentHandle) {
            case HandleType.MOVE:
                newBounds.x = this.originalBounds.x + dx;
                newBounds.y = this.originalBounds.y + dy;
                break;

            case HandleType.TOP_LEFT:
                newBounds.x = this.originalBounds.x + dx;
                newBounds.y = this.originalBounds.y + dy;
                newBounds.width = this.originalBounds.width - dx;
                newBounds.height = this.originalBounds.height - dy;
                if (shiftKey) {
                    const scale = Math.max(
                        newBounds.width / this.originalBounds.width,
                        newBounds.height / this.originalBounds.height
                    );
                    newBounds.width = this.originalBounds.width * scale;
                    newBounds.height = this.originalBounds.height * scale;
                    newBounds.x = this.originalBounds.x + this.originalBounds.width - newBounds.width;
                    newBounds.y = this.originalBounds.y + this.originalBounds.height - newBounds.height;
                }
                break;

            case HandleType.TOP:
                newBounds.y = this.originalBounds.y + dy;
                newBounds.height = this.originalBounds.height - dy;
                break;

            case HandleType.TOP_RIGHT:
                newBounds.y = this.originalBounds.y + dy;
                newBounds.width = this.originalBounds.width + dx;
                newBounds.height = this.originalBounds.height - dy;
                if (shiftKey) {
                    const scale = Math.max(
                        newBounds.width / this.originalBounds.width,
                        newBounds.height / this.originalBounds.height
                    );
                    newBounds.width = this.originalBounds.width * scale;
                    newBounds.height = this.originalBounds.height * scale;
                    newBounds.y = this.originalBounds.y + this.originalBounds.height - newBounds.height;
                }
                break;

            case HandleType.RIGHT:
                newBounds.width = this.originalBounds.width + dx;
                break;

            case HandleType.BOTTOM_RIGHT:
                newBounds.width = this.originalBounds.width + dx;
                newBounds.height = this.originalBounds.height + dy;
                if (shiftKey) {
                    const scale = Math.max(
                        newBounds.width / this.originalBounds.width,
                        newBounds.height / this.originalBounds.height
                    );
                    newBounds.width = this.originalBounds.width * scale;
                    newBounds.height = this.originalBounds.height * scale;
                }
                break;

            case HandleType.BOTTOM:
                newBounds.height = this.originalBounds.height + dy;
                break;

            case HandleType.BOTTOM_LEFT:
                newBounds.x = this.originalBounds.x + dx;
                newBounds.width = this.originalBounds.width - dx;
                newBounds.height = this.originalBounds.height + dy;
                if (shiftKey) {
                    const scale = Math.max(
                        newBounds.width / this.originalBounds.width,
                        newBounds.height / this.originalBounds.height
                    );
                    newBounds.width = this.originalBounds.width * scale;
                    newBounds.height = this.originalBounds.height * scale;
                    newBounds.x = this.originalBounds.x + this.originalBounds.width - newBounds.width;
                }
                break;

            case HandleType.LEFT:
                newBounds.x = this.originalBounds.x + dx;
                newBounds.width = this.originalBounds.width - dx;
                break;
        }

        if (newBounds.width < this.minSize) {
            if (this.currentHandle.includes('Left')) {
                newBounds.x = this.originalBounds.x + this.originalBounds.width - this.minSize;
            }
            newBounds.width = this.minSize;
        }
        if (newBounds.height < this.minSize) {
            if (this.currentHandle.includes('Top')) {
                newBounds.y = this.originalBounds.y + this.originalBounds.height - this.minSize;
            }
            newBounds.height = this.minSize;
        }

        this.selectionBounds = newBounds;

        return newBounds;
    }

    /**
     * 结束拖拽操作
     * @returns {Object|null} 最终边界对象
     */
    endDrag() {
        if (!this.isDragging) return null;

        const result = this.selectionBounds;
        this.isDragging = false;
        this.originalBounds = null;

        return result;
    }

    /**
     * 检查是否正在拖拽
     * @returns {boolean}
     */
    isCurrentlyDragging() {
        return this.isDragging;
    }

    /**
     * 检查选区是否激活
     * @returns {boolean}
     */
    isSelectionActive() {
        return this.isActive && this.selectionBounds !== null;
    }
}
