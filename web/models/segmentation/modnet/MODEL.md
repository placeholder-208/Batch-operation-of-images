# MODNet FP32

Source: https://huggingface.co/Xenova/modnet

Pinned revision: `fa2fa546052fba4c08921230a26cc69a333fca12`.
Original project: https://github.com/ZHKKKe/MODNet (Apache-2.0; LICENSE.txt retained).

`onnx/model.onnx`: 25,888,640 bytes; SHA-256
`07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9`.
Only FP32 is shipped. Runtime is single-thread browser WASM, not Worker server inference.

This is a portrait alpha-matting model, not a general text-/box-/point-prompted
segmenter. Production input: RGB /255 normalized with mean/std 0.5; short edge
512, longest edge capped at 1024, dimensions divisible by 32. Output is continuous
alpha, bilinearly mapped to the cropped working image without thresholding.
Extreme crops above 16:1 are rejected before loading the model.
