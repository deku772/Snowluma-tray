#!/usr/bin/env python3
"""
生成 SnowLuma 托盘图标 - 字母 Q
"""
from PIL import Image, ImageDraw, ImageFont
import os

def create_icon(size, output_path):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    center = size // 2
    radius = int(size * 0.45)
    
    # 背景圆形（蓝色）
    draw.ellipse(
        [center - radius, center - radius, center + radius, center + radius],
        fill='#1E90FF',  # 道奇蓝
        outline='#0066CC',
        width=max(1, size // 64)
    )
    
    # 内圈（皇家蓝）
    inner_radius = int(radius * 0.85)
    draw.ellipse(
        [center - inner_radius, center - inner_radius, center + inner_radius, center + inner_radius],
        fill='#4169E1',
    )
    
    # 字母 Q
    font_size = int(size * 0.6)
    try:
        font = ImageFont.truetype("arial.ttf", font_size)
    except:
        font = ImageFont.load_default()
    
    text = "Q"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    
    x = center - text_width // 2
    y = center - text_height // 2 - int(size * 0.02)
    
    draw.text((x, y), text, fill='white', font=font)
    img.save(output_path, 'PNG')
    print(f"Generated {size}x{size}: {output_path}")

if __name__ == '__main__':
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    # 生成主图标
    create_icon(256, os.path.join(script_dir, 'icon.png'))
    
    # 生成 ICO
    try:
        ico_sizes = [16, 32, 48, 64, 128, 256]
        images = []
        for size in ico_sizes:
            img_path = os.path.join(script_dir, f'icon-{size}.png')
            create_icon(size, img_path)
            images.append(Image.open(img_path))
        
        ico_path = os.path.join(script_dir, 'icon.ico')
        images[0].save(ico_path, format='ICO', sizes=[(img.width, img.height) for img in images])
        print(f"ICO generated: {ico_path}")
    except Exception as e:
        print(f"Warning: ICO generation failed: {e}")
    
    print(f"\nIcon generated in: {script_dir}")
