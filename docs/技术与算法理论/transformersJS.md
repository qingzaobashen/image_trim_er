# Transformers.js库
1、Transformers.js库可以在浏览器中直接运行预训练模型；
2、Transformers.js库使用ONNX Runtime在浏览器中运行ONNX模型；
3、ONNX 是通过Optimum将预训练的PyTorch\Tensorflow\JAX模型转换来的；
4、默认情况下，在浏览器运行时，模型将在CPU上运行（通过WASM），也可以通过设置device: 'webgpu' 通过webGPU在GPU上运行；
5、WebGPU API在许多浏览器中仍处于实验阶段；
6、在资源受限的环境（如web浏览器）中，可用模型的量化版，这可以通过设置dtype: 'q4'来实现；
7、Transformers.js将在主UI线程中加载和运行模型，在生产环境时，可以使用Web Worker来后台下载和运行模型；
