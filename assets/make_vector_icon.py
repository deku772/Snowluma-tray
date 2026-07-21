#!/usr/bin/env python3
"""
生成 SnowLuma 托盘矢量图标
- 使用字母 "Q" 作为主体（代表 QQ）
- 蓝色圆形背景
- 多尺寸输出（16x16 ~ 512x512）
"""

from PIL import Image, ImageDraw, ImageFont
import os

def create_icon(size: int, output_path: str):
    """创建指定尺寸的图标"""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # 背景圆形（蓝色渐变效果）
    center = size // 2
    radius = int(size * 0.45)
    
    # 外圈（深蓝）
    draw.ellipse(
        [center - radius, center - radius, center + radius, center + radius],
        fill='#1E90FF',  # 道奇蓝
        outline='#0066CC',
        width=max(1, size // 64)
    )
    
    # 内圈（浅蓝，稍微偏移营造立体感）
    inner_radius = int(radius * 0.85)
    draw.ellipse(
        [center - inner_radius, center - inner_radius, center + inner_radius, center + inner_radius],
        fill='#4169E1',  # 皇家蓝
    )
    
    # 字母 "Q"
    font_size = int(size * 0.6)
    try:
        # 尝试使用系统字体（Arial 支持更多字符）
        font = ImageFont.truetype("arial.ttf", font_size)
    except:
        # 回退到默认字体
        font = ImageFont.load_default()
    
    # 计算文字位置（居中）
    text = "Q"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    
    x = center - text_width // 2
    y = center - text_height // 2 - int(size * 0.02)  # 微调垂直位置
    
    # 绘制文字（白色）
    draw.text((x, y), text, fill='white', font=font)
    
    # 保存
    img.save(output_path, 'PNG')
    print(f"Generated {size}x{size}: {output_path}")

def main():
    # 输出目录
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_dir = os.path.join(script_dir, '..', 'assets')
    os.makedirs(output_dir, exist_ok=True)
    
    # 生成多种尺寸
    sizes = [16, 24, 32, 48, 64, 128, 256, 512]
    
    for size in sizes:
        output_path = os.path.join(output_dir, f'icon-{size}.png')
        create_icon(size, output_path)
    
    # 生成主图标（256x256，兼容旧代码）
    main_icon_path = os.path.join(output_dir, 'icon.png')
    create_icon(256, main_icon_path)
    print(f"\nMain icon generated: {main_icon_path}")
    
    # 生成 ICO 文件（Windows 托盘推荐）
    try:
        ico_sizes = [16, 32, 48, 64, 128, 256]
        images = []
        for size in ico_sizes:
            img_path = os.path.join(output_dir, f'icon-{size}.png')
            images.append(Image.open(img_path))
        
        ico_path = os.path.join(output_dir, 'icon.ico')
        images[0].save(ico_path, format='ICO', sizes=[(img.width, img.height) for img in images])
        print(f"ICO icon generated: {ico_path}")
    except Exception as e:
        print(f"Warning: ICO generation failed (optional): {e}")

if __name__ == '__main__':
    main()
