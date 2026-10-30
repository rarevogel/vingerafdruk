#!/usr/bin/env python3
"""Builds Vingerafdruk: index.html (web, fonts from Google Fonts) and android/assets/index.html (fonts bundled)."""
import re
from pathlib import Path
HERE = Path(__file__).resolve().parent
GOOGLE = re.compile(r'<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="stylesheet" href="https://fonts.googleapis.com/[^"]+">')
def main():
    t = (HERE / "src" / "index.html").read_text(encoding="utf-8")
    js = lambda n: (HERE / "src" / n).read_text(encoding="utf-8").replace("</script", "<\\/script")
    for k, f in {"FIELD": "field.js", "GABOR": "gabor.js", "ANALYZE": "analyze.js", "PAINT": "paint.js", "APP": "app.js"}.items():
        assert "__" + k + "__" in t
        t = t.replace("__" + k + "__", js(f))
    assert GOOGLE.search(t)
    (HERE / "index.html").write_text(t, encoding="utf-8")
    (HERE / "android" / "assets").mkdir(parents=True, exist_ok=True)
    (HERE / "android" / "assets" / "index.html").write_text(GOOGLE.sub('<link rel="stylesheet" href="fonts/fonts.css">', t), encoding="utf-8")
    print(f"index.html {len(t) // 1024} KB")
if __name__ == "__main__":
    main()
