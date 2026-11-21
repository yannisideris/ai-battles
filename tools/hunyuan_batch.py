"""Generate textured GLBs from the 2D unit art via the free Hunyuan3D-2.1 Hugging Face Space.

Usage: python tools/hunyuan_batch.py name1 name2 ...   (names = files in ../img without .png)
Outputs: assets/source/hunyuan/<name>.glb
"""
import shutil, sys, time
from pathlib import Path
from gradio_client import Client, handle_file

ROOT = Path(__file__).resolve().parents[1]
IMG = ROOT.parent / "img"
OUT = ROOT / "assets" / "source" / "hunyuan"
OUT.mkdir(parents=True, exist_ok=True)

client = Client("tencent/Hunyuan3D-2.1", verbose=False)
for name in sys.argv[1:]:
    dst = OUT / f"{name.replace('_idle', '')}.glb"
    if dst.exists():
        print("skip", dst.name, flush=True)
        continue
    t = time.time()
    try:
        r = client.predict(image=handle_file(str(IMG / f"{name}.png")),
                           mv_image_front=None, mv_image_back=None, mv_image_left=None, mv_image_right=None,
                           steps=30, guidance_scale=5.0, seed=1234, octree_resolution=256,
                           check_box_rembg=True, num_chunks=8000, randomize_seed=False,
                           api_name="/generation_all")
        shutil.copy(r[1]["value"], dst)
        print("OK", dst.name, round(time.time() - t), "s", flush=True)
    except Exception as e:
        print("ERR", name, type(e).__name__, str(e)[:400], flush=True)
