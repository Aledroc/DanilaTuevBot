"""
generate_tower_textures.py
Generates high-definition Dark Gym brick textures with neon signboards for Tower Game.
Floors:
- GYM (Neon Cyan / Electric Blue with barbell emblem & dark gym bricks)
- BAR (Neon Hot Pink / Amber with cocktail/glass motif)
- DUNGEON (Neon Acid Purple / Crimson with chains/locker motif)
- CLUB (Neon Violet / Deep Indigo with VIP music/pulse motif)
- BOSS (Neon Gold / Flame Amber with crown/skull & heavy industrial steel)
Also generates:
- block.png & block-perfect.png (default fallback & perfect glowing gold/cyan)
- block-rope.png (hook block with steel suspension cables/chains)
- hook.png (heavy industrial steel hook & chain)
- background.png (dark atmospheric gym dungeon with neon accents & steel floor)
"""

import os
import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ASSETS_DIR = os.path.join(os.path.dirname(__file__), 'miniapp', 'games', 'tower', 'assets')

def get_font(size, bold=True):
    fonts = [
        'C:/Windows/Fonts/impact.ttf',
        'C:/Windows/Fonts/arialbd.ttf',
        'C:/Windows/Fonts/segoeuib.ttf',
        'C:/Windows/Fonts/tahomabd.ttf'
    ]
    for fp in fonts:
        if os.path.exists(fp):
            try:
                return ImageFont.truetype(fp, size)
            except Exception:
                pass
    return ImageFont.load_default()

def get_small_font(size):
    fonts = [
        'C:/Windows/Fonts/segoeui.ttf',
        'C:/Windows/Fonts/arial.ttf',
        'C:/Windows/Fonts/tahoma.ttf'
    ]
    for fp in fonts:
        if os.path.exists(fp):
            try:
                return ImageFont.truetype(fp, size)
            except Exception:
                pass
    return ImageFont.load_default()

def draw_dark_bricks(draw, bounds, brick_w=34, brick_h=18, is_perfect=False, neon_rgb=(0, 229, 255)):
    min_x, min_y, max_x, max_y = bounds
    # Mortar / deep background
    mortar_col = (11, 14, 20, 255)
    draw.rectangle([min_x, min_y, max_x, max_y], fill=mortar_col)

    rows = int((max_y - min_y) // brick_h) + 2
    cols = int((max_x - min_x) // brick_w) + 2

    for r in range(rows):
        y0 = min_y + r * brick_h
        y1 = min(max_y, y0 + brick_h - 2)
        if y0 >= max_y:
            break
        offset_x = (brick_w // 2) if (r % 2 == 1) else 0

        for c in range(-1, cols):
            x0 = min_x + c * brick_w + offset_x
            x1 = x0 + brick_w - 2
            # Clip
            bx0 = max(min_x, x0)
            bx1 = min(max_x, x1)
            if bx0 >= bx1 or y0 >= y1:
                continue

            # Deterministic variation
            seed = (r * 73 + c * 37) % 7
            # Dark charcoal brick colors
            if seed == 0:
                base_c = (28, 33, 44)
            elif seed == 1:
                base_c = (22, 26, 36)
            elif seed == 2:
                base_c = (34, 40, 52)
            elif seed == 3:
                base_c = (19, 23, 31)
            elif seed == 4:
                base_c = (25, 30, 40)
            elif seed == 5:
                base_c = (31, 37, 48)
            else:
                base_c = (24, 28, 38)

            if is_perfect:
                # Add subtle warm/gold tint to bricks
                base_c = (int(base_c[0] * 1.2 + 15), int(base_c[1] * 1.1 + 10), int(base_c[2] * 0.9))

            # Brick face
            draw.rectangle([bx0, y0, bx1, y1], fill=(*base_c, 255))

            # Brick top bevel highlight
            hl_c = (min(255, base_c[0] + 25), min(255, base_c[1] + 28), min(255, base_c[2] + 32), 255)
            draw.line([(bx0, y0), (bx1, y0)], fill=hl_c, width=1)
            # Brick left highlight
            draw.line([(bx0, y0), (bx0, y1)], fill=hl_c, width=1)

            # Brick bottom & right shadow
            sh_c = (max(0, base_c[0] - 14), max(0, base_c[1] - 14), max(0, base_c[2] - 14), 255)
            draw.line([(bx0, y1), (bx1, y1)], fill=sh_c, width=1)
            draw.line([(bx1, y0), (bx1, y1)], fill=sh_c, width=1)

            # Micro-texture noise dots
            if seed % 2 == 0 and bx1 - bx0 > 8:
                draw.point((bx0 + 4, y0 + 5), fill=(min(255, base_c[0]+35), min(255, base_c[1]+35), min(255, base_c[2]+35), 180))
                draw.point((bx1 - 5, y1 - 4), fill=(max(0, base_c[0]-15), max(0, base_c[1]-15), max(0, base_c[2]-15), 200))


def render_block_theme(theme_name, neon_rgb, accent_rgb, subtitle, icon_type='barbell', is_perfect=False):
    SCALE = 2
    W, H = 188 * SCALE, 134 * SCALE
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))

    # Mask for rounded rectangle outer body
    mask = Image.new('L', (W, H), 0)
    draw_mask = ImageDraw.Draw(mask)
    margin = 4 * SCALE
    radius = 12 * SCALE
    draw_mask.rounded_rectangle([margin, margin, W - margin, H - margin], radius=radius, fill=255)

    # Bricks layer
    bricks_img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw_bricks = ImageDraw.Draw(bricks_img)
    draw_dark_bricks(draw_bricks, (margin, margin, W - margin, H - margin), 
                     brick_w=32 * SCALE, brick_h=16 * SCALE, 
                     is_perfect=is_perfect, neon_rgb=neon_rgb)

    # Composite bricks with mask
    bricks_img.putalpha(mask)
    img = Image.alpha_composite(img, bricks_img)

    draw = ImageDraw.Draw(img)

    # Industrial Metallic Corner Brackets & Heavy Screws
    # Top metal beam
    beam_h = 10 * SCALE
    draw.rectangle([margin, margin, W - margin, margin + beam_h], fill=(30, 36, 48, 255))
    draw.line([(margin, margin + beam_h), (W - margin, margin + beam_h)], fill=(55, 65, 82, 255), width=2)
    # Bottom metal beam
    draw.rectangle([margin, H - margin - beam_h, W - margin, H - margin], fill=(22, 26, 36, 255))
    draw.line([(margin, H - margin - beam_h), (W - margin, H - margin - beam_h)], fill=(45, 52, 68, 255), width=2)

    # Bolts / Rivets along the beams
    rivet_color = (130, 145, 165, 255)
    rivet_shadow = (10, 15, 22, 255)
    rivet_radius = 2 * SCALE
    for rx in [margin + 16 * SCALE, margin + 44 * SCALE, W // 2, W - margin - 44 * SCALE, W - margin - 16 * SCALE]:
        # Top rivets
        ry1 = margin + beam_h // 2
        draw.ellipse([rx - rivet_radius, ry1 - rivet_radius, rx + rivet_radius, ry1 + rivet_radius], fill=rivet_color)
        draw.point((rx, ry1), fill=rivet_shadow)
        # Bottom rivets
        ry2 = H - margin - beam_h // 2
        draw.ellipse([rx - rivet_radius, ry2 - rivet_radius, rx + rivet_radius, ry2 + rivet_radius], fill=rivet_color)
        draw.point((rx, ry2), fill=rivet_shadow)

    # Central Neon Signboard Box
    box_w = int(W * 0.72)
    box_h = int(H * 0.48)
    box_x0 = (W - box_w) // 2
    box_y0 = (H - box_h) // 2 + (2 * SCALE)
    box_x1 = box_x0 + box_w
    box_y1 = box_y0 + box_h

    # Signboard shadow layer
    glow_layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow_layer)

    # Neon glow backdrop behind the sign
    glow_col = (*neon_rgb, 90 if not is_perfect else 140)
    for spread in range(12 * SCALE, 0, -2 * SCALE):
        alpha = int((glow_col[3] * (1.0 - spread / (14 * SCALE))))
        glow_draw.rounded_rectangle([box_x0 - spread, box_y0 - spread, box_x1 + spread, box_y1 + spread],
                                    radius=8 * SCALE, outline=(*neon_rgb, alpha), width=3)

    # Signboard inner dark panel
    draw.rounded_rectangle([box_x0, box_y0, box_x1, box_y1], radius=8 * SCALE, 
                           fill=(12, 15, 22, 245), 
                           outline=(neon_rgb[0]//2, neon_rgb[1]//2, neon_rgb[2]//2, 220), width=2 * SCALE)

    # Neon inner border
    draw.rounded_rectangle([box_x0 + 3 * SCALE, box_y0 + 3 * SCALE, box_x1 - 3 * SCALE, box_y1 - 3 * SCALE],
                           radius=6 * SCALE, outline=(*neon_rgb, 200), width=SCALE)

    # Title Typography
    font_title = get_font(26 * SCALE, bold=True)
    font_sub = get_small_font(8 * SCALE)

    # Center text
    bbox = font_title.getbbox(theme_name)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]

    text_x = (W - tw) // 2
    text_y = box_y0 + (box_h - th) // 2 - (6 * SCALE)

    # Neon text bloom
    for ox, oy in [(-2, 0), (2, 0), (0, -2), (0, 2), (-1, -1), (1, 1), (-1, 1), (1, -1)]:
        glow_draw.text((text_x + ox * SCALE, text_y + oy * SCALE), theme_name, font=font_title, fill=(*neon_rgb, 120))

    # Sharp text core
    draw.text((text_x, text_y), theme_name, font=font_title, fill=(255, 255, 255, 255))

    # Icon / Subtitle under title
    # Subtitle pill or icon
    sub_bbox = font_sub.getbbox(subtitle)
    sw = sub_bbox[2] - sub_bbox[0]
    sub_x = (W - sw) // 2
    sub_y = text_y + th + 5 * SCALE

    # Subtitle decorative neon capsule
    pill_padding = 4 * SCALE
    draw.rounded_rectangle([sub_x - pill_padding, sub_y - 1 * SCALE, 
                            sub_x + sw + pill_padding, sub_y + (sub_bbox[3] - sub_bbox[1]) + 2 * SCALE],
                           radius=3 * SCALE, fill=(*accent_rgb, 40), outline=(*accent_rgb, 160), width=1)
    draw.text((sub_x, sub_y), subtitle, font=font_sub, fill=(*accent_rgb, 255))

    # If barbell icon: draw mini neon weight dumbbells on the left and right of the sign
    if icon_type == 'barbell':
        for ic_center_x in [box_x0 - 10 * SCALE, box_x1 + 10 * SCALE]:
            ic_y = (box_y0 + box_y1) // 2
            # Dumbbell bar
            draw.line([(ic_center_x, ic_y - 12 * SCALE), (ic_center_x, ic_y + 12 * SCALE)], fill=(180, 200, 220, 255), width=2 * SCALE)
            # Weights
            draw.rectangle([ic_center_x - 5 * SCALE, ic_y - 12 * SCALE, ic_center_x + 5 * SCALE, ic_y - 8 * SCALE], fill=(*neon_rgb, 240))
            draw.rectangle([ic_center_x - 5 * SCALE, ic_y + 8 * SCALE, ic_center_x + 5 * SCALE, ic_y + 12 * SCALE], fill=(*neon_rgb, 240))
    elif icon_type == 'beer':
        # Mini cocktail or mug indicator
        for ic_center_x in [box_x0 - 10 * SCALE, box_x1 + 10 * SCALE]:
            ic_y = (box_y0 + box_y1) // 2
            draw.polygon([(ic_center_x - 5 * SCALE, ic_y - 8 * SCALE),
                          (ic_center_x + 5 * SCALE, ic_y - 8 * SCALE),
                          (ic_center_x, ic_y + 4 * SCALE)], fill=(*neon_rgb, 240))
            draw.line([(ic_center_x, ic_y + 4 * SCALE), (ic_center_x, ic_y + 10 * SCALE)], fill=(*neon_rgb, 240), width=2 * SCALE)
    elif icon_type == 'chain':
        # Hanging chain links
        for ch_x in [margin + 10 * SCALE, W - margin - 10 * SCALE]:
            draw.ellipse([ch_x - 3 * SCALE, box_y0, ch_x + 3 * SCALE, box_y0 + 10 * SCALE], outline=(*accent_rgb, 220), width=2)
            draw.ellipse([ch_x - 3 * SCALE, box_y0 + 7 * SCALE, ch_x + 3 * SCALE, box_y0 + 17 * SCALE], outline=(*accent_rgb, 220), width=2)
    elif icon_type == 'crown':
        # VIP stars or crown
        for cr_x in [box_x0 - 10 * SCALE, box_x1 + 10 * SCALE]:
            cr_y = (box_y0 + box_y1) // 2
            draw.polygon([(cr_x, cr_y - 8 * SCALE), (cr_x - 6 * SCALE, cr_y + 4 * SCALE), (cr_x + 6 * SCALE, cr_y + 4 * SCALE)], fill=(*neon_rgb, 255))

    # Blend glow layer
    glow_blurred = glow_layer.filter(ImageFilter.GaussianBlur(radius=3 * SCALE))
    img = Image.alpha_composite(glow_blurred, img)

    # Outer Block Border & Glow
    draw_final = ImageDraw.Draw(img)
    outer_border_col = (*neon_rgb, 230) if is_perfect else (70, 85, 105, 230)
    outer_border_w = (3 * SCALE) if is_perfect else (2 * SCALE)
    draw_final.rounded_rectangle([margin, margin, W - margin, H - margin], radius=radius, outline=outer_border_col, width=outer_border_w)

    if is_perfect:
        # Add brilliant golden / radiant outer aura
        aura = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        aura_draw = ImageDraw.Draw(aura)
        aura_draw.rounded_rectangle([margin, margin, W - margin, H - margin], radius=radius, outline=(255, 215, 0, 220), width=4 * SCALE)
        aura = aura.filter(ImageFilter.GaussianBlur(radius=5 * SCALE))
        img = Image.alpha_composite(aura, img)

    # Resize down with high quality antialiasing
    final_img = img.resize((188, 134), Image.Resampling.LANCZOS)
    return final_img

def render_block_rope():
    # Size 188 x 179 (height is 179: top 45px is steel suspension chains/cables, bottom 134 is the swinging block)
    SCALE = 2
    W, H = 188 * SCALE, 179 * SCALE
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    cable_top = 0
    cable_bottom = int(45 * SCALE)

    # Draw two heavy industrial steel suspension chains/cables
    cable_x1 = int(W * 0.28)
    cable_x2 = int(W * 0.72)

    for cx in [cable_x1, cable_x2]:
        # Cable shadow
        draw.line([(cx + SCALE, cable_top), (cx + SCALE, cable_bottom + 4 * SCALE)], fill=(10, 15, 22, 220), width=4 * SCALE)
        # Steel cable core
        draw.line([(cx, cable_top), (cx, cable_bottom + 4 * SCALE)], fill=(148, 163, 184, 255), width=3 * SCALE)
        draw.line([(cx, cable_top), (cx, cable_bottom + 4 * SCALE)], fill=(226, 232, 240, 255), width=1 * SCALE)
        # Chain links or ring bracket at the block mount
        draw.rounded_rectangle([cx - 4 * SCALE, cable_bottom - 4 * SCALE, cx + 4 * SCALE, cable_bottom + 4 * SCALE],
                               radius=2 * SCALE, fill=(51, 65, 85, 255), outline=(0, 229, 255, 220), width=1 * SCALE)

    # Center crane attachment ring
    center_x = W // 2
    draw.polygon([(center_x - 8 * SCALE, 0), (center_x + 8 * SCALE, 0),
                  (cable_x2, cable_bottom), (cable_x1, cable_bottom)], outline=(100, 116, 139, 120), fill=(30, 41, 59, 100))

    # Now render the Gym Block for the bottom portion
    block_gym_large = render_block_theme('GYM', (0, 229, 255), (56, 189, 248), 'IRON WORKOUT', 'barbell', is_perfect=False)
    block_gym_large = block_gym_large.resize((188 * SCALE, 134 * SCALE), Image.Resampling.LANCZOS)
    img.paste(block_gym_large, (0, cable_bottom), block_gym_large)

    final_img = img.resize((188, 179), Image.Resampling.LANCZOS)
    return final_img

def render_hook():
    # Hook sprite: 50 x 507
    W, H = 50, 507
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    cx = W // 2
    # Chain links running down
    link_h = 14
    for y in range(0, H - 40, link_h):
        # Alternating chain links
        draw.rounded_rectangle([cx - 4, y, cx + 4, y + link_h + 2], radius=3, outline=(148, 163, 184, 255), width=2)
        draw.line([(cx, y + 2), (cx, y + link_h)], fill=(226, 232, 240, 180), width=1)

    # Industrial Swivel / Shackle
    shackle_y = H - 38
    draw.rounded_rectangle([cx - 7, shackle_y, cx + 7, shackle_y + 12], radius=3, fill=(51, 65, 85, 255), outline=(0, 229, 255, 220), width=2)
    # Bolt in shackle
    draw.ellipse([cx - 2, shackle_y + 4, cx + 2, shackle_y + 8], fill=(226, 232, 240, 255))

    # Heavy Steel Hook
    hook_y0 = shackle_y + 10
    # Draw curved hook shape
    draw.arc([cx - 16, hook_y0, cx + 16, hook_y0 + 26], start=0, end=180, fill=(203, 213, 225, 255), width=6)
    # Hook tip
    draw.line([(cx - 13, hook_y0 + 13), (cx - 16, hook_y0 + 4)], fill=(226, 232, 240, 255), width=5)
    # Hook top shaft
    draw.line([(cx, shackle_y + 10), (cx + 13, hook_y0 + 13)], fill=(203, 213, 225, 255), width=6)

    # Cyan neon glow on hook tip
    draw.point((cx - 16, hook_y0 + 4), fill=(0, 229, 255, 255))
    return img

def render_background():
    # Background image: 750 x 1050
    # Bottom: dark concrete floor with neon gym grids, metallic weights, iron beams
    W, H = 750, 1050
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # The background in TowerGame is rendered at the bottom of the canvas.
    # The game calculates LINE_INITIAL_OFFSET = t.height - 0.394 * a (where a is scaled height).
    # 0.394 * 1050 = 413.7px from the bottom is where the first block lands!
    # So y from 636 to 1050 is the ground / foundation / starting podium.
    # Let's create a solid, gorgeous Dark Gym foundation podium!

    ground_y = 636
    # Subtle dark gradient for the dungeon gym wall above ground (600..636)
    for y in range(540, ground_y):
        alpha = int(220 * (y - 540) / (ground_y - 540))
        draw.line([(0, y), (W, y)], fill=(8, 12, 20, alpha))

    # Base Podium (starting floor where the tower is built)
    # Massive reinforced dark steel plate & heavy concrete platform
    draw.rectangle([0, ground_y, W, H], fill=(12, 16, 24, 255))

    # Floor tiles / grid perspective
    for gx in range(0, W + 40, 45):
        # Vanishing perspective lines towards center
        draw.line([(gx, ground_y), (int(gx * 1.05 - 18), H)], fill=(24, 32, 48, 255), width=2)

    for gy in range(ground_y, H, 35):
        # Horizontal floor lines
        draw.line([(0, gy), (W, gy)], fill=(28, 38, 56, 255), width=2)

    # Top Edge of the Starting Platform: glowing neon beam & safety hazard stripes
    podium_rim_h = 16
    draw.rectangle([0, ground_y - podium_rim_h, W, ground_y], fill=(20, 25, 38, 255))
    # Glowing cyan / gold laser line where first block rests
    draw.line([(0, ground_y - podium_rim_h), (W, ground_y - podium_rim_h)], fill=(0, 229, 255, 255), width=3)
    draw.line([(0, ground_y - podium_rim_h - 1), (W, ground_y - podium_rim_h - 1)], fill=(0, 180, 255, 120), width=2)

    # Dark hazard diagonal stripes on the podium rim
    stripe_w = 20
    for sx in range(-stripe_w, W + stripe_w, stripe_w * 2):
        draw.polygon([(sx, ground_y), (sx + 10, ground_y - podium_rim_h), 
                      (sx + 20, ground_y - podium_rim_h), (sx + 10, ground_y)],
                     fill=(0, 229, 255, 45))

    # Large Center Gym Decal on the podium floor
    font_large = get_font(38, bold=True)
    decal_text = "DUNGEON GYM • STACK ZONE"
    bbox = font_large.getbbox(decal_text)
    dw = bbox[2] - bbox[0]
    draw.text(((W - dw) // 2, ground_y + 40), decal_text, font=font_large, fill=(35, 48, 70, 255))

    # Draw dumbbells / plates lying on the side of the starting platform
    for offset_x in [60, W - 140]:
        # Plate stack
        draw.rounded_rectangle([offset_x, ground_y + 110, offset_x + 80, ground_y + 160], radius=8, fill=(18, 22, 32, 255), outline=(0, 229, 255, 120), width=2)
        draw.text((offset_x + 14, ground_y + 125), "25 KG", font=get_font(18, bold=True), fill=(0, 229, 255, 180))

    return img

def main():
    print("Generating Tower Game Dark Gym textures...")
    os.makedirs(ASSETS_DIR, exist_ok=True)

    # 1. Themes definition
    themes = [
        {
            'key': 'gym',
            'name': 'GYM',
            'neon': (0, 229, 255),      # Neon Cyan
            'accent': (56, 189, 248),
            'sub': 'FITNESS & IRON',
            'icon': 'barbell'
        },
        {
            'key': 'bar',
            'name': 'BAR',
            'neon': (244, 63, 94),      # Neon Rose / Hot Pink
            'accent': (251, 146, 60),    # Amber
            'sub': 'PROTEIN & DRINKS',
            'icon': 'beer'
        },
        {
            'key': 'dungeon',
            'name': 'DUNGEON',
            'neon': (168, 85, 247),     # Neon Purple
            'accent': (236, 72, 153),
            'sub': 'LOCKER ROOM',
            'icon': 'chain'
        },
        {
            'key': 'club',
            'name': 'CLUB',
            'neon': (99, 102, 241),     # Neon Indigo / Electric Violet
            'accent': (129, 140, 248),
            'sub': 'VIP MEMBERS',
            'icon': 'crown'
        },
        {
            'key': 'boss',
            'name': 'BOSS',
            'neon': (234, 179, 8),      # Gold
            'accent': (249, 115, 22),    # Flame Orange
            'sub': 'HARDCORE HEAVY',
            'icon': 'crown'
        }
    ]

    for t in themes:
        # Standard block
        img_norm = render_block_theme(t['name'], t['neon'], t['accent'], t['sub'], t['icon'], is_perfect=False)
        out_path = os.path.join(ASSETS_DIR, f"block-{t['key']}.png")
        img_norm.save(out_path)
        print(f"Saved {out_path}")

        # Perfect block
        img_perf = render_block_theme(t['name'], (255, 215, 0), (251, 191, 36), "PERFECT HIT • " + t['name'], t['icon'], is_perfect=True)
        out_perf_path = os.path.join(ASSETS_DIR, f"block-{t['key']}-perfect.png")
        img_perf.save(out_perf_path)
        print(f"Saved {out_perf_path}")

    # 2. Main fallback block.png (GYM) and block-perfect.png (Gold Master)
    block_default = render_block_theme('GYM', (0, 229, 255), (56, 189, 248), 'FITNESS & IRON', 'barbell', is_perfect=False)
    block_default.save(os.path.join(ASSETS_DIR, 'block.png'))
    print("Saved block.png")

    block_perfect_default = render_block_theme('PERFECT', (255, 215, 0), (251, 191, 36), 'MAX POWER', 'barbell', is_perfect=True)
    block_perfect_default.save(os.path.join(ASSETS_DIR, 'block-perfect.png'))
    print("Saved block-perfect.png")

    # 3. block-rope.png
    block_rope = render_block_rope()
    block_rope.save(os.path.join(ASSETS_DIR, 'block-rope.png'))
    print("Saved block-rope.png")

    # 4. hook.png
    hook_img = render_hook()
    hook_img.save(os.path.join(ASSETS_DIR, 'hook.png'))
    print("Saved hook.png")

    # 5. background.png
    bg_img = render_background()
    bg_img.save(os.path.join(ASSETS_DIR, 'background.png'))
    print("Saved background.png")

    print("All textures generated successfully!")

if __name__ == '__main__':
    main()
