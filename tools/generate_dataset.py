"""
Generate a synthetic robot-inspection dataset: analogue gauge photos with known
ground truth, plus the (sometimes wrong) metadata a robot vendor might send.

Everything here is invented. No real site, asset or vendor data is used.

    python3 tools/generate_dataset.py --out data/synthetic --seed 7
"""
import argparse, json, math, random
from datetime import datetime, timedelta, timezone
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageEnhance

ASSETS = [
    # id, name, unit, scale min/max, normal operating band
    ("PG-101", "Feed pump P-101 discharge pressure", "bar", 0, 16, (6, 10)),
    ("PG-102", "Feed pump P-102 discharge pressure", "bar", 0, 16, (6, 10)),
    ("PG-201", "Cooling water header pressure", "bar", 0, 10, (3, 6)),
    ("PG-305", "Instrument air receiver", "psi", 0, 160, (90, 120)),
    ("TG-110", "Lube oil return temperature", "degC", 0, 120, (35, 70)),
    ("TG-220", "Heat exchanger E-220 outlet", "degC", 0, 150, (60, 95)),
    ("PG-410", "Firewater ring main", "bar", 0, 25, (8, 14)),
    ("TG-415", "Compressor K-415 discharge", "degF", 0, 300, (150, 230)),
]
UNIT_LABEL = {"bar": "bar", "psi": "psi", "degC": "°C", "degF": "°F"}
START, SWEEP = 225.0, 270.0  # needle angle at min (degrees, maths convention) and total sweep


def font(size):
    for f in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "DejaVuSans-Bold.ttf"]:
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            pass
    return ImageFont.load_default()


def nice_step(span):
    for s in [1, 2, 2.5, 5, 10, 20, 25, 50]:
        if span / s <= 10:
            return s
    return 100


def draw_gauge(lo, hi, value, unit, size=512, cracked=False):
    img = Image.new("RGB", (size, size), (random.randint(60, 110),) * 3)
    d = ImageDraw.Draw(img)
    cx = cy = size // 2
    r = int(size * 0.42)
    d.ellipse([cx - r - 14, cy - r - 14, cx + r + 14, cy + r + 14], fill=(40, 40, 45))  # bezel
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(245, 244, 238))  # face
    step = nice_step(hi - lo)
    v = lo
    while v <= hi + 1e-9:
        a = math.radians(START - SWEEP * (v - lo) / (hi - lo))
        x1, y1 = cx + r * 0.92 * math.cos(a), cy - r * 0.92 * math.sin(a)
        x2, y2 = cx + r * 0.78 * math.cos(a), cy - r * 0.78 * math.sin(a)
        d.line([x1, y1, x2, y2], fill=(20, 20, 20), width=4)
        tx, ty = cx + r * 0.62 * math.cos(a), cy - r * 0.62 * math.sin(a)
        label = f"{v:g}"
        d.text((tx, ty), label, fill=(20, 20, 20), font=font(int(size * 0.045)), anchor="mm")
        # minor ticks
        for k in range(1, 5):
            mv = v + step * k / 5
            if mv > hi:
                break
            ma = math.radians(START - SWEEP * (mv - lo) / (hi - lo))
            d.line([cx + r * 0.92 * math.cos(ma), cy - r * 0.92 * math.sin(ma),
                    cx + r * 0.85 * math.cos(ma), cy - r * 0.85 * math.sin(ma)], fill=(60, 60, 60), width=2)
        v += step
    d.text((cx, cy + r * 0.45), UNIT_LABEL[unit], fill=(30, 30, 30), font=font(int(size * 0.06)), anchor="mm")
    a = math.radians(START - SWEEP * (value - lo) / (hi - lo))
    d.line([cx - r * 0.12 * math.cos(a), cy + r * 0.12 * math.sin(a),
            cx + r * 0.85 * math.cos(a), cy - r * 0.85 * math.sin(a)], fill=(190, 20, 20), width=7)
    d.ellipse([cx - 14, cy - 14, cx + 14, cy + 14], fill=(30, 30, 30))
    if cracked:
        x, y = cx + random.randint(-r // 2, r // 2), cy + random.randint(-r // 2, r // 2)
        for _ in range(random.randint(4, 7)):
            ang = random.uniform(0, 2 * math.pi)
            px, py = x, y
            for _ in range(random.randint(3, 6)):
                ang += random.uniform(-0.5, 0.5)
                nx, ny = px + 30 * math.cos(ang), py + 30 * math.sin(ang)
                d.line([px, py, nx, ny], fill=(90, 90, 95), width=2)
                px, py = nx, ny
    return img


def degrade(img, level):
    """level: 'clean' | 'noisy' | 'occluded' | 'unreadable'"""
    img = img.rotate(random.uniform(-10, 10), fillcolor=(80, 80, 80))
    img = ImageEnhance.Brightness(img).enhance(random.uniform(0.7, 1.15))
    d = ImageDraw.Draw(img, "RGBA")
    if level in ("noisy", "occluded", "unreadable"):
        gx, gy = random.randint(120, 390), random.randint(120, 390)
        d.ellipse([gx - 70, gy - 40, gx + 70, gy + 40], fill=(255, 255, 255, 110))  # glare
        img = img.filter(ImageFilter.GaussianBlur(random.uniform(0.8, 1.6)))
    if level == "occluded":
        d = ImageDraw.Draw(img, "RGBA")
        ox, oy = random.randint(150, 360), random.randint(150, 360)
        d.ellipse([ox - 60, oy - 45, ox + 60, oy + 45], fill=(35, 30, 25, 235))  # dirt / condensation
    if level == "unreadable":
        img = img.filter(ImageFilter.GaussianBlur(9))
        img = ImageEnhance.Brightness(img).enhance(0.45)
    return img


def robot_reading(true_value, unit, lo, hi):
    """Simulate the vendor's on-board reading, which is often wrong."""
    r = random.random()
    if r < 0.60:
        return {"value": round(true_value + random.gauss(0, (hi - lo) * 0.01), 2), "unit": unit, "confidence": round(random.uniform(0.8, 0.97), 2)}, "ok"
    if r < 0.72:
        return {"value": round(random.uniform(lo, hi), 2), "unit": unit, "confidence": round(random.uniform(0.5, 0.9), 2)}, "wrong_value"
    if r < 0.82:
        wrong_unit = {"bar": "psi", "psi": "bar", "degC": "degF", "degF": "degC"}[unit]
        return {"value": round(true_value, 2), "unit": wrong_unit, "confidence": round(random.uniform(0.6, 0.9), 2)}, "wrong_unit"
    if r < 0.92:
        return {"value": None, "unit": None, "confidence": 0.0}, "missing"
    return {"value": round(true_value * 10, 1), "unit": unit, "confidence": round(random.uniform(0.7, 0.95), 2)}, "decimal_shift"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/synthetic")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--days", type=int, default=6)
    args = ap.parse_args()
    random.seed(args.seed)
    out = Path(args.out)
    (out / "images").mkdir(parents=True, exist_ok=True)

    assets = [{"id": a, "name": n, "unit": u, "scaleMin": lo, "scaleMax": hi,
               "normalMin": band[0], "normalMax": band[1], "site": "Demo Site", "area": f"Unit {a[3]}"}
              for a, n, u, lo, hi, band in ASSETS]
    (out / "assets.json").write_text(json.dumps(assets, indent=2))

    t0 = datetime(2026, 9, 1, 6, 0, tzinfo=timezone.utc)
    inspections, labels = [], []
    for day in range(args.days):
        for a in assets:
            lo, hi, nlo, nhi = a["scaleMin"], a["scaleMax"], a["normalMin"], a["normalMax"]
            mid = (nlo + nhi) / 2
            value = mid + random.gauss(0, (nhi - nlo) * 0.2)
            if a["id"] == "PG-102":  # a pump that degrades over the week
                value = nhi - (nhi - nlo) * 0.1 - day * (nhi - nlo) * 0.35
            if random.random() < 0.08:  # occasional excursion
                value = random.choice([nlo - (nhi - nlo) * 0.4, nhi + (nhi - nlo) * 0.4])
            value = round(min(max(value, lo), hi), 2)
            level = random.choices(["clean", "noisy", "occluded", "unreadable"], [0.5, 0.3, 0.12, 0.08])[0]
            cracked = random.random() < 0.12
            img = degrade(draw_gauge(lo, hi, value, a["unit"], cracked=cracked), level)
            iid = f"insp-{day + 1:02d}-{a['id']}"
            img.save(out / "images" / f"{iid}.jpg", quality=88)
            robot, robot_fault = robot_reading(value, a["unit"], lo, hi)
            ts = t0 + timedelta(days=day, minutes=random.randint(0, 180))
            inspections.append({
                "inspectionId": iid, "assetId": a["id"], "robotId": "robot-demo-01",
                "capturedAt": ts.isoformat(), "image": f"images/{iid}.jpg",
                "robotReading": robot,
                "audio": {"rmsDb": round(random.uniform(62, 70) + (8 if a['id'] == 'PG-102' and day > 3 else 0), 1)},
            })
            labels.append({
                "inspectionId": iid, "trueValue": value, "unit": a["unit"],
                "readable": level != "unreadable", "imageCondition": level,
                "defects": ["cracked_glass"] if cracked else [], "robotFault": robot_fault,
            })
    (out / "inspections.json").write_text(json.dumps(inspections, indent=2))
    (out / "labels.json").write_text(json.dumps(labels, indent=2))
    print(f"wrote {len(inspections)} inspections to {out}")


if __name__ == "__main__":
    main()
