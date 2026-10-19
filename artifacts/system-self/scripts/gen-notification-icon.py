"""Generate assets/images/notification-icon.png: 96x96 white "S" mark on transparent.
The app icon is too detailed to survive as a silhouette at notification size, so this draws a
simple typographic mark. Run: python scripts/gen-notification-icon.py (needs Pillow, a bold font)."""
from PIL import Image, ImageDraw, ImageFont
import os
root = os.path.join(os.path.dirname(__file__), "..", "assets", "images")
S = 384  # draw large, downsample for clean edges
font = None
for name in ("arialbd.ttf", "Arial Bold.ttf", "DejaVuSans-Bold.ttf", "Helvetica.ttc"):
    try:
        font = ImageFont.truetype(name, 330)
        break
    except OSError:
        pass
if font is None:
    raise SystemExit("no bold font found")
mask = Image.new("L", (S, S), 0)
d = ImageDraw.Draw(mask)
d.text((S / 2, S / 2), "S", font=font, fill=255, anchor="mm")
mask = mask.resize((96, 96), Image.LANCZOS)
out = Image.new("RGBA", (96, 96), (255, 255, 255, 0))
out.putalpha(mask)
out.save(os.path.join(root, "notification-icon.png"))
