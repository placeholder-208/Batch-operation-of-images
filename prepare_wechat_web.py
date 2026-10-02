import copy
import json
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
from onnx import TensorProto, helper


SOURCE = Path("models/detect.onnx")
OUTPUT = Path("models/detect-web.onnx")
CONFIG = Path("models/detect-web.json")

# 第一轮使用固定尺寸，便于验证和浏览器接入。
INPUT_SIZE = 400


def node_attributes(node):
    return {
        attr.name: helper.get_attribute_value(attr)
        for attr in node.attribute
    }


model = onnx.load(str(SOURCE))
graph = model.graph

detection_nodes = [
    node for node in graph.node
    if node.op_type == "DetectionOutput"
]
prior_nodes = [
    node for node in graph.node
    if node.op_type == "PriorBox"
]

if len(detection_nodes) != 1 or len(prior_nodes) != 5:
    raise RuntimeError(
        "模型结构与预期不一致："
        f"DetectionOutput={len(detection_nodes)}, "
        f"PriorBox={len(prior_nodes)}"
    )

detection_node = detection_nodes[0]

location_name = detection_node.input[0]
confidence_name = detection_node.input[1]

# 导出特征图，使浏览器按实际 H/W 生成 prior boxes。
feature_names = list(dict.fromkeys(
    node.input[0] for node in prior_nodes
))

output_names = [
    location_name,
    confidence_name,
    *feature_names,
]

# 从所需输出向前追踪，只保留其计算依赖。
# 因此 PriorBox、DetectionOutput 及无用的 prior 拼接会被移除。
required = set(output_names)
kept_nodes = []

for node in reversed(graph.node):
    if any(name in required for name in node.output):
        kept_nodes.append(copy.deepcopy(node))
        required.update(name for name in node.input if name)

kept_nodes.reverse()

kept_initializers = [
    copy.deepcopy(item)
    for item in graph.initializer
    if item.name in required
]

initializer_names = {
    item.name for item in graph.initializer
}

kept_inputs = [
    copy.deepcopy(item)
    for item in graph.input
    if item.name in required
    and item.name not in initializer_names
]

if len(kept_inputs) != 1:
    raise RuntimeError("预期只有一个图像输入")

image_input = kept_inputs[0]
dimensions = image_input.type.tensor_type.shape.dim

if len(dimensions) != 4:
    raise RuntimeError("预期输入为 NCHW 四维张量")

for dimension, value in zip(
    dimensions,
    [1, 1, INPUT_SIZE, INPUT_SIZE],
):
    dimension.ClearField("dim_param")
    dimension.dim_value = value

outputs = [
    helper.make_tensor_value_info(
        location_name, TensorProto.FLOAT, [1, None]
    ),
    helper.make_tensor_value_info(
        confidence_name, TensorProto.FLOAT, [1, None]
    ),
]

outputs.extend(
    helper.make_tensor_value_info(
        name, TensorProto.FLOAT, [1, None, None, None]
    )
    for name in feature_names
)

new_graph = helper.make_graph(
    kept_nodes,
    "wechat_qr_browser_detector",
    kept_inputs,
    outputs,
    initializer=kept_initializers,
)

converted = copy.deepcopy(model)
converted.graph.CopyFrom(new_graph)

# 现在图中应只剩标准 ONNX 算子。
converted = onnx.shape_inference.infer_shapes(converted)
onnx.checker.check_model(converted)
onnx.save(converted, str(OUTPUT))

config = {
    "input": image_input.name,
    "inputSize": INPUT_SIZE,
    "locationOutput": location_name,
    "confidenceOutput": confidence_name,
    "priorLayers": [
        {
            "featureOutput": node.input[0],
            "attributes": node_attributes(node),
        }
        for node in prior_nodes
    ],
    "detectionAttributes": node_attributes(detection_node),
}

CONFIG.write_text(
    json.dumps(config, ensure_ascii=False, indent=2),
    encoding="utf-8",
)

print("标准 ONNX 校验通过")
print("生成：", OUTPUT)
print("生成：", CONFIG)

session = ort.InferenceSession(
    str(OUTPUT),
    providers=["CPUExecutionProvider"],
)

# 仅检查模型是否能够执行，尚不测试识别准确率。
test_input = np.linspace(
    0,
    1,
    INPUT_SIZE * INPUT_SIZE,
    dtype=np.float32,
).reshape(1, 1, INPUT_SIZE, INPUT_SIZE)

results = session.run(
    output_names,
    {image_input.name: test_input},
)

print("\n推理输出：")

for name, result in zip(output_names, results):
    finite = bool(np.isfinite(result).all())

    print(
        name,
        "shape=", result.shape,
        "finite=", finite,
    )

    if not finite:
        raise RuntimeError(f"{name} 含有 NaN 或 Inf")

location = results[0]
confidence = results[1]

if location.size % 4 != 0:
    raise RuntimeError("位置输出元素数不是 4 的倍数")

anchor_count = location.size // 4

if confidence.size != anchor_count * 2:
    raise RuntimeError("位置输出与两类分类输出数量不匹配")

print("\n候选 anchor 数量：", anchor_count)
print("模型转换及推理检查通过")