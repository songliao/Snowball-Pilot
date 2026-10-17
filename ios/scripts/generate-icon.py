#!/usr/bin/env python3
"""从 Web 版图标生成 iOS App 图标（标准/深色/着色三变体）。

图标设计沿用 SnowballDemo（衍问）的 PWA 图标：全出血蓝紫渐变 + 大号白色雪花。
源文件 resources/icon-web-512.png（512x512，复制自 SnowballDemo/public/icon-512.png），
Lanczos 放大到 1024 后输出三变体。

用法（仓库根目录）：python3 ios/scripts/generate-icon.py
依赖：Pillow（pip install pillow）
"""
from PIL import Image
import os

SOURCE = 'resources/icon-web-512.png'
ICONSET = 'ios/SnowballPilot/Resources/Assets.xcassets/AppIcon.appiconset'

src = Image.open(SOURCE).convert('RGB')
full = src.resize((1024, 1024), Image.LANCZOS)

os.makedirs(ICONSET, exist_ok=True)
full.save(f'{ICONSET}/AppIcon.png')                                    # 标准
full.save(f'{ICONSET}/AppIconDark.png')                                # 深色外观：同一图形
full.convert('L').convert('RGB').save(f'{ICONSET}/AppIconTinted.png')  # 着色外观：灰度
print(f'icons written to {ICONSET}/ (AppIcon / AppIconDark / AppIconTinted)')
