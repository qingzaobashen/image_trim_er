/**
 * 英文（en-US）翻译文件
 * Contains all translatable text in English
 */

export default {
    /** Page title */
    pageTitle: 'Smart Cutout Tool - Online Image Processing',

    /** Header navigation */
    header: {
        logoText: 'Smart Cutout',
        undo: 'Undo',
        redo: 'Redo',
        reUpload: 'Re-upload',
        download: 'Download',
        tutorials: 'Tutorials',
        about: 'About',
        contact: 'Contact',
        language: 'Language'
    },

    /** Left toolbar */
    toolbar: {
        smartTools: 'Smart Tools',
        toolParams: 'Parameters',
        postProcess: 'Post-processing',
        shadowProcess: 'Shadow Processing',
        operations: 'Operations',

        /** Smart cutout */
        smartCut: 'Smart Cut',
        magicWand: 'Magic Wand',
        brush: 'Brush',
        shapeCut: 'Shape Cut',

        /** Smart cutout params */
        cutMode: 'Cut Mode',
        cutModeAuto: 'Auto',
        cutModeColor: 'Color Clustering',
        cutModeEdge: 'Edge Detection',
        cutModePerson: 'Person Segmentation',
        smoothness: 'Edge Smoothness',
        applySmartCut: 'Apply Smart Cut',

        /** Magic wand params */
        contiguous: 'Contiguous',
        tolerance: 'Tolerance',

        /** Brush params */
        brushMode: 'Brush Mode',
        brushAdd: 'Add',
        brushSubtract: 'Subtract',
        brushSize: 'Brush Size',
        brushHardness: 'Brush Hardness',
        brushHintTitle: 'Tips:',
        brushHintAdd: '• Add mode: paint to add selection',
        brushHintSubtract: '• Subtract mode: paint to remove selection',
        brushHintAlt: '• Hold Alt to temporarily switch mode',

        /** Shape cut params */
        shapeType: 'Shape Type',
        shapeRectangle: 'Rectangle',
        shapeCircle: 'Circle',
        shapeEllipse: 'Ellipse',
        shapePetal: 'Petal',
        shapeStar: 'Star',
        shapeHeart: 'Heart',
        shapeHintTitle: 'Tips:',
        shapeHint1: '• Select a shape and drag on canvas to draw',
        shapeHint2: '• Preview and dimensions shown while dragging',
        shapeHint3: '• Release mouse to complete cutout',

        /** Post-processing params */
        minArea: 'Min Region Area',
        selectionDenoise: 'Selection Denoise',
        boxDenoise: 'Box Denoise',
        fullDenoise: 'Full Denoise',
        smoothEdgesStrength: 'Edge Smoothness: ',
        smoothEdges: 'Smooth Edges',
        postProcessHintTitle: 'Info:',
        postProcessHint1: '• Selection Denoise: clean selection noise before cutout',
        postProcessHint2: '• Box Denoise: clean noise in local area',
        postProcessHint3: '• Full Denoise: clean image noise after cutout',
        postProcessHint4: '• Smooth Edges: smooth edge jaggedness',
        postProcessHint5: '• Lower threshold preserves more regions',
        postProcessHint6: '• Recommended: 50-200 pixels',

        /** Shadow processing params */
        edgeBrushSize: 'Edge Brush Size',
        edgeBrush: 'Edge Brush',
        edgeBrushAdd: 'Add Edge',
        edgeBrushSubtract: 'Erase Edge',
        edgeBlur: 'Edge Blur',
        edgeBlurHint: 'Gaussian blur kernel size: larger = smoother but loses detail. Odd 3~9',
        edgeLowThreshold: 'Weak Edge Sensitivity',
        edgeLowThresholdHint: 'Pixels below this value are ignored; lower = more weak edges kept',
        edgeHighThreshold: 'Strong Edge Sensitivity',
        edgeHighThresholdHint: 'Pixels above this value are strong edges; lower = more edges detected',
        detectEdges: 'Detect Edges',
        shadowMaxDistance: 'Max Shadow Distance',
        shadowDiff: 'Shadow Difference',
        detectShadows: 'Detect Shadows',
        shadowBrushSize: 'Shadow Brush Size',
        shadowBrushHardness: 'Shadow Brush Hardness',
        shadowBrushMode: 'Shadow Brush Mode',
        shadowBrushAdd: 'Add Shadow',
        shadowBrushSubtract: 'Erase Shadow',
        shadowIntensity: 'Shadow Opacity',
        applyShadowProcess: 'Apply Shadow',
        shadowFlowTitle: 'Workflow:',
        shadowFlow1: '1. Use Smart Cut / Magic Wand to create purple selection',
        shadowFlow2: '2. Click "Detect Edges" to detect object contours',
        shadowFlow3: '3. Adjust parameters then click "Detect Shadows"',
        shadowFlow4: '4. Use shadow brush to adjust pink shadow selection',
        shadowFlow5: '5. Click "Apply Shadow" to finish',
        selectionInfoTitle: 'Selection Info:',
        selectionInfo1: '• Purple = fully removed area',
        selectionInfo2: '• Pink = shadow semi-transparent area',
        selectionInfo3: '• Cyan line = edge contour',

        /** Operation buttons */
        clearSelection: 'Clear Selection',
        invertSelection: 'Invert Selection',
        deleteSelection: 'Delete Selection'
    },

    /** Canvas area */
    canvas: {
        zoomOut: 'Zoom Out (Ctrl+-)',
        zoomIn: 'Zoom In (Ctrl++)',
        fitWindow: 'Fit Window',
        resetZoom: 'Reset Zoom (Ctrl+0)'
    },

    /** Upload prompt */
    upload: {
        title: 'Upload Image to Start',
        supportedFormats: 'Supports JPG, PNG, WebP formats',
        selectImage: 'Select Image'
    },

    /** Right info panel */
    infoPanel: {
        imageInfo: 'Image Info',
        imageSize: 'Size',
        fileSize: 'File Size',
        fileFormat: 'Format',
        instructions: 'Instructions',
        instruction1: 'Click "Select Image" to upload an image',
        instruction2: 'Use Smart Cut to auto-detect subject, or Magic Wand to select similar colors',
        instruction3: 'Use Brush tool to fine-tune edges',
        instruction4: 'Click "Download" to save the result',
        shortcuts: 'Shortcuts',
        shortcutUndo: 'Undo',
        shortcutRedo: 'Redo',
        shortcutDownload: 'Download',
        shortcutDelete: 'Delete Selection'
    },

    /** Loading messages */
    loading: {
        processing: 'Processing...',
        loadingImage: 'Loading image...'
    },

    /** Footer */
    footer: {
        about: 'About',
        privacy: 'Privacy Policy',
        contact: 'Contact',
        tutorials: 'Tutorials',
        copyright: '© 2025 Smart Cutout Tool. All rights reserved.'
    },

    /** Notification messages */
    notifications: {
        brushModeAdd: 'Brush mode: Add selection',
        brushModeSubtract: 'Brush mode: Subtract selection',
        selectImageFile: 'Please select an image file',
        imageLoadFailed: 'Image load failed, please try again'
    }
};
