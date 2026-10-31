"""生成扩展图标（可选工具，不是插件运行所必需）。

用法（在项目根目录执行）：
    python tools/generate_icons.py

依赖：Pillow（pip install pillow）
输出：icons/icon16.png、icon32.png、icon48.png、icon128.png

设计：蓝色渐变圆角方块 + 白色纸张 + 绿色对勾，寓意“课程题库 / 已掌握”。
先在 1024px 画布上绘制，再缩小到目标尺寸，边缘更平滑。
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ICON_DIR = ROOT / "icons"
SIZES = (16, 32, 48, 128)

CANVAS = 1024  # 超采样画布边长

BLUE_TOP = (59, 130, 246)
BLUE_BOTTOM = (29, 78, 216)
WHITE = (255, 255, 255, 255)
LINE_BLUE = (147, 197, 253, 255)
GREEN = (22, 163, 74, 255)


def mix(start: tuple, end: tuple, ratio: float) -> tuple:
    """按比例混合两个 RGB 颜色。"""
    return tuple(round(start[i] + (end[i] - start[i]) * ratio) for i in range(3))


def rounded_mask(size: int, radius: int) -> Image.Image:
    """生成圆角矩形蒙版。"""
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=radius, fill=255
    )
    return mask


def build_master() -> Image.Image:
    """绘制 1024×1024 的母版图标。"""
    # 1. 垂直渐变背景
    gradient = Image.new("RGBA", (CANVAS, CANVAS))
    drawer = ImageDraw.Draw(gradient)
    for y in range(CANVAS):
        color = mix(BLUE_TOP, BLUE_BOTTOM, y / (CANVAS - 1))
        drawer.line([(0, y), (CANVAS, y)], fill=color + (255,))

    # 2. 裁成圆角方块
    icon = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    icon.paste(gradient, (0, 0), rounded_mask(CANVAS, int(CANVAS * 0.225)))

    drawer = ImageDraw.Draw(icon)

    # 3. 白色纸张
    page_left = int(CANVAS * 0.225)
    page_top = int(CANVAS * 0.185)
    page_right = int(CANVAS * 0.775)
    page_bottom = int(CANVAS * 0.815)
    drawer.rounded_rectangle(
        (page_left, page_top, page_right, page_bottom),
        radius=int(CANVAS * 0.055),
        fill=WHITE,
    )

    # 4. 纸张上的三条浅蓝文本线
    line_x = page_left + int(CANVAS * 0.065)
    for index, width in enumerate((0.56, 0.46, 0.36)):
        line_y = page_top + int(CANVAS * 0.105) + index * int(CANVAS * 0.085)
        drawer.rounded_rectangle(
            (line_x, line_y, line_x + int(CANVAS * width), line_y + int(CANVAS * 0.032)),
            radius=int(CANVAS * 0.016),
            fill=LINE_BLUE,
        )

    # 5. 绿色对勾
    points = [
        (int(CANVAS * 0.345), int(CANVAS * 0.625)),
        (int(CANVAS * 0.455), int(CANVAS * 0.735)),
        (int(CANVAS * 0.665), int(CANVAS * 0.475)),
    ]
    stroke = int(CANVAS * 0.055)
    drawer.line(points, fill=GREEN, width=stroke, joint="curve")

    # 圆头端点，避免对勾两端过尖
    cap = stroke // 2
    for x, y in points:
        drawer.ellipse((x - cap, y - cap, x + cap, y + cap), fill=GREEN)

    return icon


def main() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    master = build_master()

    for size in SIZES:
        icons = master.resize((size, size), Image.LANCZOS)
        output = ICON_DIR / f"icon{size}.png"
        icons.save(output, "PNG", optimize=True)
        print(f"已生成 {output.relative_to(ROOT)} ({size}×{size})")


if __name__ == "__main__":
    main()
