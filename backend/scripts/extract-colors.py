from PIL import Image
from collections import Counter

base = r"C:\Users\ERICK\Documents\Control de Inventario\asistencia-inteligente\imagenes"

def analyze(path, label, topn=16):
    print(f"\n===== {label} =====")
    try:
        img = Image.open(path).convert("RGB")
    except Exception as e:
        print("  ERROR:", e)
        return
    print(f"  size={img.size}")
    q = img.quantize(colors=32, method=Image.MEDIANCUT)
    pal = q.getpalette()
    counts = Counter(q.getdata())
    print("  Colores dominantes (hex, rgb, frecuencia):")
    seen = set()
    for idx, count in counts.most_common(60):
        r, g, b = pal[idx*3], pal[idx*3+1], pal[idx*3+2]
        # filtrar blancos/casi-blancos y negros puros para resaltar colores de marca
        if r > 240 and g > 240 and b > 240:
            continue
        if r < 25 and g < 25 and b < 25:
            continue
        hexv = '#{:02X}{:02X}{:02X}'.format(r, g, b)
        if hexv in seen:
            continue
        seen.add(hexv)
        print(f"    {hexv}  rgb({r},{g},{b})  n={count}")
        if len(seen) >= topn:
            break

analyze(base + r"\paleta.jpeg", "PALETA")
analyze(base + r"\logo.jpg", "LOGO")
analyze(base + r"\mascota.png", "MASCOTA")
