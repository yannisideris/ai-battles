# Bump the cache-busting version in index.html: style.css?v=N, src/main.js?v=N and an import-map entry for every
# module in src/ (./src/x.js -> ./src/x.js?v=N), so browsers fetch the new files at once after a release.
# Usage: python tools/bump_version.py            (from the v2 folder; prints the new N)
import os, re, json
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(root, "index.html")
s = open(p, encoding="utf-8").read()
m = re.search(r"style\.css\?v=(\d+)", s)
n = (int(m.group(1)) if m else 0) + 1
s = re.sub(r"src/style\.css(\?v=\d+)?", f"src/style.css?v={n}", s)
s = re.sub(r'src="src/main\.js(\?v=\d+)?"', f'src="src/main.js?v={n}"', s)
mods = sorted(f for f in os.listdir(os.path.join(root, "src")) if f.endswith(".js") and f != "main.js")
imap = {"three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
        "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"}
for f in mods: imap[f"./src/{f}"] = f"./src/{f}?v={n}"
block = '<script type="importmap">\n' + json.dumps({"imports": imap}, indent=1) + "\n</script>"
s = re.sub(r'<script type="importmap">.*?</script>', lambda _: block, s, count=1, flags=re.S)
open(p, "w", encoding="utf-8").write(s)
print(n)
