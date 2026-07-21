#!/usr/bin/env python3
"""
生成 SnowLuma 托盘图标 - 字母 Q

要点（解决"发虚 / 不居中"）：
  - 每个尺寸都按原生分辨率现画，绝不缩小大图（缩小才会糊）
  - 补齐 Windows 任务栏全套尺寸，避免 Windows 插值缩放
  - 字母加描边变粗，小尺寸也清晰
  - Q 的尾巴在右下，按整字包围盒居中会让圆圈偏左上，这里做视觉重心修正
"""
from PIL import Image, ImageDraw, ImageFont
import os

RIM = '#1D4ED8'     # 外圈深蓝（提供边缘对比，抗缩放发虚）
MAIN = '#2563EB'    # 主蓝
LETTER = 'white'


def make(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = size // 2

    # 外圈 + 主圆（用两个同心圆制造硬朗的环，缩放后仍有清晰边界）
    r_rim = int(size * 0.47)
    r_main = int(size * 0.42)
    d.ellipse([c - r_rim, c - r_rim, c + r_rim, c + r_rim], fill=RIM)
    d.ellipse([c - r_main, c - r_main, c + r_main, c + r_main], fill=MAIN)

    # 字母 Q 单独画在图层上，做硬阈值二值化（alpha>200 才保留），
    # 消除抗锯齿产生的半透明灰边 -> 小尺寸在任务栏上不发虚
    letter = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ld = ImageDraw.Draw(letter)
    fs = int(size * 0.62)
    try:
        font = ImageFont.truetype('arial.ttf', fs)
    except Exception:
        font = ImageFont.load_default()

    stroke = max(1, size // 32)          # 描边让字母更扛缩放
    # Q 的尾巴在右下 -> 整字包围盒居中会让圆圈偏左上，向"右下"回正
    dx = int(size * 0.030)
    dy = int(size * 0.075)
    # 极小尺寸(<=32)尾巴会把视觉重心往右推，再整体左移一点点抵消
    if size <= 32:
        dx -= int(size * 0.020)

    ld.text(
        (c + dx, c + dy),
        'Q',
        fill=LETTER,
        font=font,
        anchor='mm',
        stroke_width=stroke,
        stroke_fill=LETTER,
    )

    # 硬阈值化字母图层
    lp = letter.load()
    for y in range(size):
        for x in range(size):
            r, g, b, a = lp[x, y]
            if a > 200:
                lp[x, y] = (255, 255, 255, 255)
            else:
                lp[x, y] = (0, 0, 0, 0)
    img.alpha_composite(letter)

    # 主圆也做硬边缘（消除 1px 半透明灰边）
    if size <= 48:
        px = img.load()
        for y in range(size):
            for x in range(size):
                r, g, b, a = px[x, y]
                px[x, y] = (r, g, b, 255 if a > 200 else 0)
    return img


if __name__ == '__main__':
    sd = os.path.dirname(os.path.abspath(__file__))

    # 托盘运行时读取的 PNG（256）
    png = make(256)
    png.save(os.path.join(sd, 'icon.png'), 'PNG')
    print('PNG generated: icon.png (256)')

    # EXE / 任务栏用 ICO：Windows 全套尺寸，256 放首位
    sizes = [256, 192, 128, 96, 64, 48, 40, 32, 24, 20, 16]
    imgs = [make(s) for s in sizes]
    ico = os.path.join(sd, 'icon.ico')
    imgs[0].save(
        ico,
        format='ICO',
        sizes=[(i.width, i.height) for i in imgs],
        append_images=imgs[1:],
    )
    print('ICO generated:', ico)
    print('ICO sizes:', sorted(imgs[0].info.get('sizes', [])) if hasattr(imgs[0], 'info') else sizes)
