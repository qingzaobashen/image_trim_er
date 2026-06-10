/**
 * Vite 构建配置
 * 多页面应用配置，支持主应用和子页面
 */
import { defineConfig } from 'vite';
import { resolve } from 'path';
import { globSync } from 'glob';

/**
 * 获取所有 HTML 入口文件
 * @returns {Object} Vite rollupOptions.input 配置对象
 */
function getHtmlInputs() {
    const inputs = {
        main: resolve(__dirname, 'index.html'),
    };

    // 扫描 pages/ 下所有 HTML 文件（排除 articles 目录下包含未转义代码块的页面）
    const pageFiles = globSync('pages/**/*.html', { cwd: __dirname });
    pageFiles.forEach((file) => {
        if (file.includes('pages/articles/') || file.includes('pages\\articles\\')) return;
        const name = file.replace(/\.html$/, '').replace(/[\\/]/g, '_');
        inputs[name] = resolve(__dirname, file);
    });

    return inputs;
}

export default defineConfig({
    // 项目根目录
    root: __dirname,

    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
        },
    },

    // 依赖预构建配置
    optimizeDeps: {
        include: [
            '@huggingface/transformers',
            '@tensorflow/tfjs',
            '@tensorflow-models/body-pix',
        ],
    },

    // esbuild 配置：支持 top-level await
    esbuild: {
        target: 'esnext',
    },

    build: {
        // 构建目标：支持 top-level await
        target: 'esnext',
        rollupOptions: {
            input: getHtmlInputs(),
            output: {
                // 保持目录结构
                entryFileNames: 'assets/[name]-[hash].js',
                chunkFileNames: 'assets/[name]-[hash].js',
                assetFileNames: 'assets/[name]-[hash].[ext]',
            },
        },
        // 输出目录
        outDir: 'dist',
        // 资源内联阈值（4KB 以下内联为 base64）
        assetsInlineLimit: 4096,
    },

    // 开发服务器配置
    server: {
        port: 18080,
        open: true,
        // CORS 头（用于 SharedArrayBuffer，Transformers.js WASM 后端需要）
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'credentialless',
            'Cross-Origin-Resource-Policy': 'same-origin',
        },
    },

    // 预览服务器配置
    preview: {
        port: 18080,
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'credentialless',
            'Cross-Origin-Resource-Policy': 'same-origin',
        },
    },

    // CSS 配置
    css: {
        devSourcemap: true,
    },

    // 静态资源处理
    publicDir: 'public',
});
