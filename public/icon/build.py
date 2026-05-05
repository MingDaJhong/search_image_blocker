#!/usr/bin/env python3
"""
從 icon.svg 派生 5 個尺寸的 PNG icon。

需求：
  pip3 install --user Pillow
  macOS（用 Chrome headless 渲染 SVG，原生支援透明背景）

策略：
- 大尺寸（48 / 96 / 128）：直接渲染原始 SVG
- 小尺寸（16 / 32）：對 SVG 動三個手腳補強小尺寸辨識度：
  1. stroke-width 抬高到至少 1.6 物理像素的等效 viewBox 值
  2. 太陽放大 1.6 倍、稍往中心移
  3. 移除山脈的 mountainMask（那條切開山脈的縫隙在小尺寸會變成大破洞）

執行：python3 public/icon/build.py
"""
import os
import re
import subprocess
from PIL import Image

ICON_DIR = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ICON_DIR, 'icon.svg')
TMP = '/tmp/icon-build'
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
SIZES = [16, 32, 48, 96, 128]
SMALL_THRESHOLD = 32  # <= 這個尺寸套用小尺寸補強


def thicken(svg: str, min_vw: float) -> str:
    return re.sub(
        r'stroke-width="([\d.]+)"',
        lambda m: f'stroke-width="{max(float(m.group(1)), min_vw)}"',
        svg,
    )


def enlarge_sun(svg: str, factor: float) -> str:
    return re.sub(
        r'<circle cx="68" cy="42" r="10"',
        f'<circle cx="64" cy="40" r="{int(10 * factor)}"',
        svg,
    )


def remove_mountain_mask(svg: str) -> str:
    return svg.replace('mask="url(#mountainMask)" ', '')


def optimize_for_small(svg: str, size: int) -> str:
    min_vw = 1.6 * 128 / size
    svg = thicken(svg, min_vw)
    svg = enlarge_sun(svg, 1.6)
    svg = remove_mountain_mask(svg)
    return svg


def render(svg_text: str, size: int) -> None:
    os.makedirs(TMP, exist_ok=True)
    # 以 256 渲染再 LANCZOS 縮放，比直接小尺寸渲染更銳利。
    # 不能再大：Chrome headless 在 --window-size ≥ 320 時會把 SVG 內容
    # 截在約 90% 寬高（已實測），所以固定上限 256。
    render_size = 256
    html = (
        '<!DOCTYPE html><html><head><style>'
        'html,body{margin:0;padding:0;background:transparent}'
        f'svg{{display:block;width:{render_size}px;height:{render_size}px}}'
        '</style></head><body>'
        f'{svg_text}'
        '</body></html>'
    )
    tmp_html = os.path.join(TMP, '_render.html')
    with open(tmp_html, 'w') as f:
        f.write(html)
    raw = os.path.join(TMP, '_shot.png')
    subprocess.run(
        [
            CHROME,
            '--headless',
            '--disable-gpu',
            '--hide-scrollbars',
            '--default-background-color=00000000',
            f'--screenshot={raw}',
            f'--window-size={render_size},{render_size}',
            f'file://{tmp_html}',
        ],
        capture_output=True,
        check=True,
    )
    out = os.path.join(ICON_DIR, f'{size}.png')
    Image.open(raw).convert('RGBA').resize((size, size), Image.LANCZOS).save(
        out, optimize=True
    )
    os.remove(raw)
    print(f'  {size}.png ({os.path.getsize(out)} bytes)')


def main() -> None:
    with open(SRC) as f:
        svg_src = f.read()
    for size in SIZES:
        svg = optimize_for_small(svg_src, size) if size <= SMALL_THRESHOLD else svg_src
        render(svg, size)
    print('done')


if __name__ == '__main__':
    main()
