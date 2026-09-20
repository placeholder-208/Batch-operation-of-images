from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile
import csv

import cv2
import numpy as np
import zxingcpp


class QRCodeProcessor:
    def __init__(self):
        pass

    def detect(self, image):
        """
        使用 ZXing-C++ 检测并解码图片中的二维码。
        """
        barcodes = zxingcpp.read_barcodes(image)

        results = []

        for barcode in barcodes:
            position = barcode.position

            points = np.array(
                [
                    [position.top_left.x, position.top_left.y],
                    [position.top_right.x, position.top_right.y],
                    [position.bottom_right.x, position.bottom_right.y],
                    [position.bottom_left.x, position.bottom_left.y],
                ],
                dtype=np.float32,
            )

            center_x = float(np.mean(points[:, 0]))
            center_y = float(np.mean(points[:, 1]))

            results.append(
                {
                    "text": barcode.text or "",
                    "format": str(barcode.format),
                    "points": points,
                    "center": (center_x, center_y),
                }
            )

        # 先按 y，再按 x 排序
        results.sort(
            key=lambda item: (
                item["center"][1],
                item["center"][0],
            )
        )

        # 按最终顺序编号
        for index, item in enumerate(results, start=1):
            item["id"] = index

        return results

    @staticmethod
    def crop_qrcode(image, points):
        """
        根据 ZXing 返回的四个角点进行透视裁剪。
        """
        points = np.asarray(points, dtype=np.float32)

        # ZXing:
        # top_left
        # top_right
        # bottom_right
        # bottom_left

        width_top = np.linalg.norm(points[1] - points[0])
        width_bottom = np.linalg.norm(points[2] - points[3])

        height_left = np.linalg.norm(points[3] - points[0])
        height_right = np.linalg.norm(points[2] - points[1])

        width = max(int(round(width_top)), int(round(width_bottom)))
        height = max(int(round(height_left)), int(round(height_right)))

        width = max(width, 1)
        height = max(height, 1)

        destination = np.array(
            [
                [0, 0],
                [width - 1, 0],
                [width - 1, height - 1],
                [0, height - 1],
            ],
            dtype=np.float32,
        )

        matrix = cv2.getPerspectiveTransform(points, destination)

        cropped = cv2.warpPerspective(
            image,
            matrix,
            (width, height),
        )

        return cropped

    @staticmethod
    def create_image_zip(image, filename, results):
        """
        创建当前这一张原图对应的 ZIP。

        ZIP 内只包含：
            001.png
            002.png
            ...
            result.csv
        """

        buffer = BytesIO()

        with ZipFile(
            buffer,
            mode="w",
            compression=ZIP_DEFLATED,
        ) as zip_file:

            csv_buffer = BytesIO()

            # CSV 使用 utf-8-sig，Excel 打开中文不会乱码
            csv_text = BytesIO()

            import io

            text_buffer = io.StringIO()

            writer = csv.writer(text_buffer)

            writer.writerow(
                [
                    "id",
                    "format",
                    "text",
                ]
            )

            for result in results:
                cropped = QRCodeProcessor.crop_qrcode(
                    image,
                    result["points"],
                )

                success, encoded = cv2.imencode(
                    ".png",
                    cropped,
                )

                if not success:
                    continue

                image_name = f"{result['id']:03d}.png"

                zip_file.writestr(
                    image_name,
                    encoded.tobytes(),
                )

                writer.writerow(
                    [
                        result["id"],
                        result["format"],
                        result["text"],
                    ]
                )

            csv_data = text_buffer.getvalue().encode("utf-8-sig")

            zip_file.writestr(
                "result.csv",
                csv_data,
            )

        return buffer.getvalue()

    def process_image(
        self,
        image_bytes,
        filename,
        create_zip=False,
    ):
        """
        处理单张图片。

        返回：
            {
                filename,
                width,
                height,
                image_data,
                qrcodes,
                _zip_bytes
            }
        """

        array = np.frombuffer(
            image_bytes,
            dtype=np.uint8,
        )

        image = cv2.imdecode(
            array,
            cv2.IMREAD_COLOR,
        )

        if image is None:
            raise ValueError(
                f"无法读取图片：{filename}"
            )

        height, width = image.shape[:2]

        results = self.detect(image)

        qrcodes = []

        for result in results:
            points = result["points"]

            qrcodes.append(
                {
                    "id": result["id"],
                    "text": result["text"],
                    "format": result["format"],
                    "points": [
                        {
                            "x": float(point[0]),
                            "y": float(point[1]),
                        }
                        for point in points
                    ],
                    "center": {
                        "x": result["center"][0],
                        "y": result["center"][1],
                    },
                }
            )

        # 将原图编码成 PNG，前端直接显示
        success, encoded_image = cv2.imencode(
            ".png",
            image,
        )

        if not success:
            raise ValueError(
                f"无法编码图片：{filename}"
            )

        import base64

        image_base64 = base64.b64encode(
            encoded_image.tobytes()
        ).decode("ascii")

        result_data = {
            "filename": filename,
            "width": width,
            "height": height,
            "image": (
                "data:image/png;base64,"
                + image_base64
            ),
            "count": len(qrcodes),
            "qrcodes": qrcodes,
        }

        if create_zip:
            result_data["_zip_bytes"] = (
                self.create_image_zip(
                    image,
                    filename,
                    results,
                )
            )

        return result_data


processor = QRCodeProcessor()