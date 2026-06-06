/**
 * 中文（zh-CN）翻译文件
 * 包含界面所有可翻译文本的中文版本
 */

export default {
    /** 页面标题 */
    pageTitle: '智能抠图工具 - 在线图片处理',

    /** 顶部导航栏 */
    header: {
        logoText: '智能抠图',
        undo: '撤销',
        redo: '重做',
        reUpload: '重新上传',
        download: '下载图片',
        tutorials: '教程',
        about: '关于我们',
        contact: '联系我们',
        language: '语言'
    },

    /** 左侧工具栏 */
    toolbar: {
        smartTools: '智能工具',
        toolParams: '工具参数',
        postProcess: '后处理操作',
        shadowProcess: '阴影处理',
        operations: '操作',

        /** 智能抠图 */
        smartCut: '智能抠图',
        magicWand: '魔术棒',
        brush: '画笔涂抹',
        shapeCut: '形状抠图',

        /** 智能抠图参数 */
        cutMode: '抠图模式',
        cutModeAuto: '自动选择',
        cutModeColor: '颜色聚类',
        cutModeEdge: '边缘检测',
        cutModePerson: '人体分割',
        smoothness: '边缘平滑度',
        applySmartCut: '应用智能抠图',

        /** 魔术棒参数 */
        contiguous: '连续区域',
        tolerance: '魔术棒容差值',

        /** 画笔参数 */
        brushMode: '画笔模式',
        brushAdd: '添加',
        brushSubtract: '取消',
        brushSize: '画笔大小',
        brushHardness: '画笔硬度',
        brushHintTitle: '提示：',
        brushHintAdd: '• 添加模式：涂抹添加选区',
        brushHintSubtract: '• 取消模式：涂抹取消选区',
        brushHintAlt: '• 按住 Alt 键临时切换模式',

        /** 形状抠图参数 */
        shapeType: '形状类型',
        shapeRectangle: '矩形',
        shapeCircle: '圆形',
        shapeEllipse: '椭圆',
        shapePetal: '花瓣',
        shapeStar: '星形',
        shapeHeart: '心形',
        shapeHintTitle: '提示：',
        shapeHint1: '• 选择形状后在画布上拖动绘制',
        shapeHint2: '• 拖动时显示形状预览和尺寸',
        shapeHint3: '• 松开鼠标完成抠图',

        /** 后处理参数 */
        minArea: '最小区域面积',
        selectionDenoise: '选区降噪',
        boxDenoise: '框选去噪',
        fullDenoise: '全图去噪',
        smoothEdgesStrength: '边缘光滑强度：',
        smoothEdges: '边缘光滑',
        postProcessHintTitle: '说明：',
        postProcessHint1: '• 选区降噪：抠图前清理选区噪点',
        postProcessHint2: '• 框选去噪：局部区域清理噪点',
        postProcessHint3: '• 全图去噪：抠图后清理图像噪点',
        postProcessHint4: '• 边缘光滑：平滑图像边缘锯齿',
        postProcessHint5: '• 阈值越小，保留的区域越多',
        postProcessHint6: '• 建议值：50-200 像素',

        /** 阴影处理参数 */
        edgeBrushSize: '边缘画笔大小',
        edgeBrush: '边缘画笔',
        edgeBrushAdd: '增加边缘',
        edgeBrushSubtract: '抹除边缘',
        edgeBlur: '边缘模糊度',
        edgeBlurHint: '高斯模糊核大小：值越大边缘越平滑，但会丢失细节。奇数3~9',
        edgeLowThreshold: '弱边缘灵敏度',
        edgeLowThresholdHint: '低于此值的像素被忽略，值越低保留的弱边缘越多',
        edgeHighThreshold: '强边缘灵敏度',
        edgeHighThresholdHint: '高于此值的像素直接判定为强边缘，值越低检测到的边缘越多',
        detectEdges: '边缘检测',
        shadowMaxDistance: '最大阴影距离',
        shadowDiff: '阴影差异度',
        detectShadows: '阴影检测',
        shadowBrushSize: '阴影画笔大小',
        shadowBrushHardness: '阴影画笔硬度',
        shadowBrushMode: '阴影画笔模式',
        shadowBrushAdd: '添加阴影',
        shadowBrushSubtract: '抹除阴影',
        shadowIntensity: '阴影半透明度',
        applyShadowProcess: '应用阴影处理',
        shadowFlowTitle: '操作流程：',
        shadowFlow1: '1. 先用智能抠图/魔法棒确定紫色选区',
        shadowFlow2: '2. 点击"边缘检测"检测物体轮廓',
        shadowFlow3: '3. 调整参数后点击"阴影检测"',
        shadowFlow4: '4. 用阴影画笔调整粉色阴影选区',
        shadowFlow5: '5. 点击"应用阴影处理"完成',
        selectionInfoTitle: '选区说明：',
        selectionInfo1: '• 紫色 = 完全抠除区域',
        selectionInfo2: '• 粉色 = 阴影半透明区域',
        selectionInfo3: '• 青色细线 = 边缘轮廓',

        /** 操作按钮 */
        clearSelection: '清除选区',
        invertSelection: '反选',
        deleteSelection: '删除选区'
    },

    /** 画布区域 */
    canvas: {
        zoomOut: '缩小 (Ctrl+-)',
        zoomIn: '放大 (Ctrl++)',
        fitWindow: '适应窗口',
        resetZoom: '重置缩放 (Ctrl+0)'
    },

    /** 上传提示区域 */
    upload: {
        title: '上传图片开始处理',
        supportedFormats: '支持 JPG、PNG、WebP 格式',
        selectImage: '选择图片'
    },

    /** 右侧信息面板 */
    infoPanel: {
        imageInfo: '图片信息',
        imageSize: '尺寸',
        fileSize: '文件大小',
        fileFormat: '格式',
        instructions: '使用说明',
        instruction1: '点击"选择图片"上传需要处理的图片',
        instruction2: '选择智能抠图工具自动识别主体，或使用魔术棒点击选择相似颜色区域',
        instruction3: '使用画笔工具精细调整边缘',
        instruction4: '点击"下载图片"保存处理结果',
        shortcuts: '快捷键',
        shortcutUndo: '撤销',
        shortcutRedo: '重做',
        shortcutDownload: '下载',
        shortcutDelete: '删除选区'
    },

    /** 加载提示 */
    loading: {
        processing: '处理中...',
        loadingImage: '加载图片中...'
    },

    /** 页脚 */
    footer: {
        about: '关于我们',
        privacy: '隐私政策',
        contact: '联系方式',
        tutorials: '使用教程',
        copyright: '© 2025 智能抠图工具. 保留所有权利.'
    },

    /** 提示消息 */
    notifications: {
        brushModeAdd: '画笔模式：添加选区',
        brushModeSubtract: '画笔模式：取消选区',
        selectImageFile: '请选择图片文件',
        imageLoadFailed: '图片加载失败，请重试'
    }
};
