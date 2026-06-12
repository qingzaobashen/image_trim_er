# Transformers.js库
1、Transformers.js库可以在浏览器中直接运行预训练模型；
2、Transformers.js库使用ONNX Runtime在浏览器中运行ONNX模型；
3、ONNX 是通过Optimum将预训练的PyTorch\Tensorflow\JAX模型转换来的；
4、默认情况下，在浏览器运行时，模型将在CPU上运行（通过WASM），也可以通过设置device: 'webgpu' 通过webGPU在GPU上运行；
5、WebGPU API在许多浏览器中仍处于实验阶段；
6、在资源受限的环境（如web浏览器）中，可用模型的量化版，这可以通过设置dtype: 'q4'来实现；
7、Transformers.js将在主UI线程中加载和运行模型，在生产环境时，可以使用Web Worker来后台下载和运行模型；
8、Transformers.js库加载本地模型：
```javascript
import { env } from '@huggingface/transformers';
// 设置本地模型路径
env.localModelPath = '/path/to/your/custom/models/';
// 禁用远程模型加载
env.allowRemoteModels = false;
// 设置WASM文件路径
env.backends.onnx.wasm.wasmPaths = '/path/to/wasm/files/';
// 启用文件系统缓存
env.useFSCache = true;

//onnx模型存放
models/
├── config.json
└── onnx/
   ├── model.onnx
   └── model_quantized.onnx # 可选量化版本

import { pipeline } from '@huggingface/transformers';

// 方法2：相对路径（基于 localModelPath）
env.localModelPath = '/models/';
const pipe2 = await pipeline('sentiment-analysis', 'bert-base-uncased');
```