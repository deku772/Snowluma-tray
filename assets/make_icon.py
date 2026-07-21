#!/usr/bin/env python3
"""
生成 SnowLuma 托盘图标 - 字母 Q（超采样抗锯齿版）
"""
from PIL import Image, ImageDraw, ImageFont
import os

# 超采样倍数（越大越平滑）
SUPERSAMPLE = 8


def create_icon(size, output_path):
    """生成指定尺寸的图标，使用超采样抗锯齿"""
    ss = size * SUPERSAMPLE

    # 在高分辨率画布上绘制
    img = Image.new('RGBA', (ss, ss), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    center = ss // 2
    radius = int(ss * 0.45)

    # 外圈（道奇蓝）
    draw.ellipse(
        [center - radius, center - radius, center + radius, center + radius],
        fill='#1E90FF',
        outline='#0066CC',
        width=max(1, ss // 64)
    )

    # 内圈（皇家蓝）
    inner_radius = int(radius * 0.85)
    draw.ellipse(
        [center - inner_radius, center - inner_radius, center + inner_radius, center + inner_radius],
        fill='#4169E1',
    )

    # 字母 Q（使用较细的字体）
    font_size = int(ss * 0.5)
    font = None
    # 优先使用较细的字体（Light/Thin 变体）
    for font_name in ['arial.ttf', 'calibri.ttf', 'segoeui.ttf', 'tahoma.ttf']:
        try:
            font = ImageFont.truetype(font_name, font_size)
            break
        except:
            continue
    if font is None:
        font = ImageFont.load_default()

    text = "Q"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]

    x = center - text_width // 2
    y = center - text_height // 2 - int(ss * 0.02)

    draw.text((x, y), text, fill='white', font=font)

    # 缩小到目标尺寸（LANCZOS 抗锯齿）
    img = img.resize((size, size), Image.LANCZOS)
    img.save(output_path, 'PNG')
    print(f"Generated {size}x{size}: {output_path}")


if __name__ == '__main__':
    script_dir = os.path.dirname(os.path.abspath(__file__))

    # 生成主图标
    create_icon(256, os.path.join(script_dir, 'icon.png'))

    # 生成 ICO（多尺寸）
    try:
        ico_sizes = [16, 32, 48, 64, 128, 256]
        images = []
        for size in ico_sizes:
            img_path = os.path.join(script_dir, f'icon-{size}.png')
            create_icon(size, img_path)
            images.append(Image.open(img_path))

        ico_path = os.path.join(script_dir, 'icon.ico')
        # ICO 需要保存最大的图像，sizes 参数指定包含的尺寸
        largest = images[-1]  # 256x256
        largest.save(
            ico_path,
            format='ICO',
            sizes=[(img.width, img.height) for img in images],
            append_images=images[:-1]
        )
        print(f"ICO generated: {ico_path}")
    except Exception as e:
        print(f"Warning: ICO generation failed: {e}")

    print(f"\nIcon generated in: {script_dir}")
