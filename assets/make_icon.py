from PIL import Image, ImageDraw, ImageFont

# 创建 256x256 蓝色圆形 + 白色 "S" 图标
size = 256
img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# 蓝色圆形背景
circle_color = (37, 99, 235)  # #2563eb
draw.ellipse([8, 8, size - 8, size - 8], fill=circle_color)

# 白色字母 S
try:
    font = ImageFont.truetype('arial.ttf', 140)
except Exception:
    font = ImageFont.load_default()

text = 'S'
bbox = draw.textbbox((0, 0), text, font=font)
text_w = bbox[2] - bbox[0]
text_h = bbox[3] - bbox[1]
x = (size - text_w) // 2 - bbox[0]
y = (size - text_h) // 2 - bbox[1]
draw.text((x, y), text, fill='white', font=font)

img.save('D:/projects/SnowLumaTray/assets/icon.png')
print('Icon saved to D:/projects/SnowLumaTray/assets/icon.png')
print(f'Size: {img.size}')
