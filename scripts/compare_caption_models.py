"""Compare 3 captioning models on the same local images/prompts.

Windows NVIDIA self-hosted Actions; run each model sequentially to reduce VRAM.
JoyCaption requires BOTH the Q6_K GGUF and an independent vision mmproj.
"""
import argparse
import base64
import csv
import gc
import io
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
import zipfile

MODELS = {
    "caprl": "internlm/CapRL-Qwen3VL-4B",
    "qwen": "Qwen/Qwen3-VL-4B-Instruct",
    "joycaption": "mradermacher/llama-joycaption-beta-one-hf-llava-GGUF",
}
JOY_FILE = "llama-joycaption-beta-one-hf-llava.Q6_K.gguf"
MM_REPO = "concedo/llama-joycaption-beta-one-hf-llava-mmproj-gguf"
MM_FILE = "llama-joycaption-beta-one-llava-mmproj-model-f16.gguf"
FIELDS = ["model", "model_id", "image", "prompt_id", "status", "caption",
          "latency_s", "peak_vram_gb", "error"]


def gpu_info():
    result = subprocess.run(
        ["nvidia-smi", "--query-gpu=name,memory.total,memory.free,driver_version",
         "--format=csv,noheader"], capture_output=True, text=True, timeout=15
    )
    if result.returncode:
        raise RuntimeError("nvidia-smi failed: " + result.stderr)
    if not result.stdout.strip():
        raise RuntimeError("No NVIDIA GPU detected")
    return result.stdout.strip()


def preflight(outdir):
    outdir.mkdir(parents=True, exist_ok=True)
    data = {"python": sys.version, "platform": sys.platform, "gpu": None,
            "status": "failed"}
    try:
        data["gpu"] = gpu_info()
        data["status"] = "ok"
        print("GPU:", data["gpu"])
    except Exception as e:
        data["error"] = str(e)
        print("Preflight failure:", e, file=sys.stderr)
    (outdir / "preflight.json").write_text(
        json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return 0 if data["status"] == "ok" else 2


def image_list(directory, limit):
    if not directory.is_dir():
        raise ValueError(f"Input directory not found: {directory}")
    images = sorted(p for p in directory.iterdir()
                    if p.is_file() and p.suffix.lower()
                    in {".jpg", ".jpeg", ".png", ".webp"})
    if not images:
        raise ValueError(f"No image files in {directory}. Add image files before running models.")
    return images[:limit]


def load_prompts(path, chosen):
    data = json.loads(path.read_text(encoding="utf-8"))
    prompts = data["prompts"]
    if chosen and chosen != "all":
        accepted = set(x.strip() for x in chosen.split(","))
        prompts = [p for p in prompts if p["id"] in accepted]
    if not prompts:
        raise ValueError("No matching prompts")
    return prompts


def normalized_image(path, max_side=1024):
    from PIL import Image, ImageOps
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail((max_side, max_side))
        return im.copy()


def qwen_runner(model_id, image_paths, prompts, opts, record):
    import torch
    from transformers import AutoProcessor, Qwen3VLForConditionalGeneration

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA PyTorch not available")
    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    print("Loading", model_id, "with", dtype, flush=True)
    processor = AutoProcessor.from_pretrained(model_id)
    model = Qwen3VLForConditionalGeneration.from_pretrained(
        model_id, dtype=dtype, device_map="auto", attn_implementation="sdpa"
    ).eval()
    try:
        for path in image_paths:
            image = normalized_image(path, opts.image_side)
            try:
                for prompt in prompts:
                    messages = [{"role": "user", "content": [
                        {"type": "image", "image": image},
                        {"type": "text", "text": prompt["text"]},
                    ]}]
                    inputs = processor.apply_chat_template(
                        messages, add_generation_prompt=True, tokenize=True,
                        return_dict=True, return_tensors="pt"
                    ).to(model.device)
                    torch.cuda.reset_peak_memory_stats()
                    torch.cuda.synchronize()
                    started = time.perf_counter()
                    with torch.inference_mode():
                        output = model.generate(
                            **inputs, max_new_tokens=opts.max_new_tokens,
                            do_sample=False
                        )
                    torch.cuda.synchronize()
                    elapsed = time.perf_counter() - started
                    caption = processor.decode(
                        output[0][inputs["input_ids"].shape[-1]:],
                        skip_special_tokens=True
                    ).strip()
                    peak = round(torch.cuda.max_memory_allocated() / 2**30, 3)
                    record(model_id, path, prompt["id"], caption, elapsed, peak)
                    del inputs, output
            finally:
                image.close()
    finally:
        del model, processor
        gc.collect()
        torch.cuda.empty_cache()


def download_file(url, target):
    import requests
    if target.exists() and target.stat().st_size > 100_000:
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix(target.suffix + ".part")
    with requests.get(url, stream=True, timeout=(20, 180)) as res:
        res.raise_for_status()
        with open(temp, "wb") as out:
            for chunk in res.iter_content(chunk_size=2**20):
                if chunk:
                    out.write(chunk)
    temp.replace(target)
    return target


def ensure_llama_server(cache, tag):
    import requests
    override = os.environ.get("LLAMA_SERVER_EXE", "").strip()
    if override:
        exe = Path(override)
        if not exe.is_file():
            raise FileNotFoundError(f"LLAMA_SERVER_EXE not found: {exe}")
        return exe.resolve()
    root = cache / "llama.cpp" / tag
    exe = root / "llama-server.exe"
    if exe.is_file():
        return exe
    api = f"https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/{tag}"
    res = requests.get(api, timeout=30)
    res.raise_for_status()
    assets = res.json()["assets"]
    for name in (f"llama-{tag}-bin-win-cuda-13.4-x64.zip",
                 "cudart-llama-bin-win-cuda-13.4-x64.zip"):
        found = [x for x in assets if x["name"] == name]
        if len(found) != 1:
            raise RuntimeError(f"Cannot find llama.cpp release asset {name}")
        asset = found[0]
        archive = download_file(asset["browser_download_url"],
                                cache / "downloads" / asset["name"])
        with zipfile.ZipFile(archive) as z:
            for entry in z.infolist():
                if entry.is_dir():
                    continue
                dest = (root / entry.filename).resolve()
                if root.resolve() not in dest.parents:
                    raise RuntimeError("Unsafe archive path")
                dest.parent.mkdir(parents=True, exist_ok=True)
                with z.open(entry) as src, open(dest, "wb") as dst:
                    shutil.copyfileobj(src, dst)
    if not exe.is_file():
        matches = list(root.rglob("llama-server.exe"))
        if len(matches) != 1:
            raise FileNotFoundError("No llama-server.exe in downloaded archive")
        exe = matches[0]
    return exe


def joy_runner(image_paths, prompts, opts, record):
    import requests
    from huggingface_hub import hf_hub_download
    cache = Path(opts.cache_dir).resolve()
    gguf = hf_hub_download(MODELS["joycaption"], filename=JOY_FILE)
    mmproj = hf_hub_download(MM_REPO, filename=MM_FILE)
    server = ensure_llama_server(cache, opts.llama_tag)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    log = opts.output_dir / "joycaption-server.log"
    command = [str(server), "-m", str(gguf), "--mmproj", str(mmproj),
               "--host", "127.0.0.1", "--port", str(port),
               "-c", "4096", "-ngl", "99", "--parallel", "1"]
    print("Starting JoyCaption multimodal server (Q6_K + mmproj)", flush=True)
    with open(log, "w", encoding="utf-8", errors="replace") as logfile:
        proc = subprocess.Popen(command, stdout=logfile,
                                stderr=subprocess.STDOUT, cwd=str(server.parent))
        try:
            base = f"http://127.0.0.1:{port}"
            deadline = time.monotonic() + 300
            ready = False
            while time.monotonic() < deadline:
                if proc.poll() is not None:
                    break
                try:
                    r = requests.get(base + "/health", timeout=2)
                    if r.status_code == 200:
                        ready = True
                        break
                except requests.RequestException:
                    pass
                time.sleep(2)
            if not ready:
                raise RuntimeError(f"JoyCaption server not ready (exit={proc.poll()}); see {log}")
            for path in image_paths:
                image = normalized_image(path, opts.image_side)
                buffer = io.BytesIO()
                image.save(buffer, format="JPEG", quality=95)
                image.close()
                data_uri = "data:image/jpeg;base64," + base64.b64encode(
                    buffer.getvalue()).decode("ascii")
                for prompt in prompts:
                    body = {
                        "model": "joycaption",
                        "messages": [{"role": "user", "content": [
                            {"type": "text", "text": prompt["text"]},
                            {"type": "image_url", "image_url": {"url": data_uri}},
                        ]}],
                        "temperature": 0,
                        "max_tokens": opts.max_new_tokens,
                        "stream": False,
                        "seed": 42,
                    }
                    start = time.perf_counter()
                    response = requests.post(
                        base + "/v1/chat/completions",
                        json=body, timeout=240
                    )
                    response.raise_for_status()
                    caption = response.json()["choices"][0]["message"]["content"]
                    if not isinstance(caption, str):
                        caption = json.dumps(caption, ensure_ascii=False)
                    record("joycaption", path, prompt["id"], caption.strip(),
                           time.perf_counter() - start, None)
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=10)


def report(rows, path):
    models = ["caprl", "qwen", "joycaption"]
    prompts = list(dict.fromkeys(x["prompt_id"] for x in rows))
    images = list(dict.fromkeys(x["image"] for x in rows))
    output = ["# Image caption model comparison", "",
              "All captions are raw outputs; automatic quality scores are not assigned.",
              "Inspect factual accuracy and hallucinations against original images.", ""]
    for name in images:
        output += [f"## {name}", ""]
        for pid in prompts:
            output += [f"### Prompt: {pid}", ""]
            for model in models:
                found = next((r for r in rows if r["image"] == name
                              and r["prompt_id"] == pid and r["model"] == model), None)
                if found is None:
                    continue
                output += [f"**{model}** — {found['status']} "
                           f"({found['latency_s']}s)", "",
                           found["caption"] if found["status"] == "ok"
                           else "ERROR: " + found["error"], ""]
    path.write_text("\n".join(output), encoding="utf-8")


def run(opts):
    opts.output_dir.mkdir(parents=True, exist_ok=True)
    if opts.mode == "preflight":
        return preflight(opts.output_dir)
    gpu = gpu_info()
    print("GPU:", gpu, flush=True)
    images = image_list(opts.input_dir, opts.max_images)
    prompts = load_prompts(opts.prompt_file, opts.prompt_ids)
    selected = list(MODELS) if opts.models == "all" else [opts.models]
    rows = []
    output = opts.output_dir / "results.jsonl"
    with output.open("w", encoding="utf-8") as jsonl:
        def record(model, image, prompt_id, caption="", latency=None, peak=None, error=""):
            short = next((k for k, v in MODELS.items()
                          if v == model), model)
            row = dict(model=short, model_id=MODELS[short],
                       image=image.name, prompt_id=prompt_id,
                       status="error" if error else "ok", caption=caption,
                       latency_s=round(latency, 3) if latency is not None else None,
                       peak_vram_gb=peak, error=error)
            rows.append(row)
            jsonl.write(json.dumps(row, ensure_ascii=False) + "\n")
            jsonl.flush()
            print(row["model"], row["image"], prompt_id, row["status"], flush=True)

        for key in selected:
            try:
                if key in ("caprl", "qwen"):
                    qwen_runner(MODELS[key], images, prompts, opts, record)
                else:
                    joy_runner(images, prompts, opts, record)
            except Exception as e:
                import traceback
                traceback.print_exc()
                for img in images:
                    for prompt in prompts:
                        if not any(r["model"] == key and r["image"] == img.name
                                   and r["prompt_id"] == prompt["id"] for r in rows):
                            record(key, img, prompt["id"], error=repr(e))
    with (opts.output_dir / "summary.csv").open(
            "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    report(rows, opts.output_dir / "report.md")
    info = {"gpu": gpu, "models": selected,
            "images": [p.name for p in images],
            "prompt_ids": [p["id"] for p in prompts],
            "max_new_tokens": opts.max_new_tokens,
            "image_side": opts.image_side,
            "llama_cpp_tag": opts.llama_tag}
    (opts.output_dir / "run-metadata.json").write_text(
        json.dumps(info, indent=2, ensure_ascii=False), encoding="utf-8")
    return 1 if not rows or any(r["status"] == "error" for r in rows) else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["preflight", "compare"], default="compare")
    parser.add_argument("--models", choices=["all", *MODELS], default="all")
    parser.add_argument("--input-dir", type=Path, default=Path("inputs"))
    parser.add_argument("--output-dir", type=Path, default=Path("outputs"))
    parser.add_argument("--prompt-file", type=Path, default=Path("prompts/prompts.json"))
    parser.add_argument("--prompt-ids", default="all")
    parser.add_argument("--max-images", type=int, default=3)
    parser.add_argument("--max-new-tokens", type=int, default=300)
    parser.add_argument("--image-side", type=int, default=1024)
    parser.add_argument("--llama-tag", default="b11361")
    parser.add_argument("--cache-dir", default=os.path.join(
        os.path.expanduser("~"), ".cache", "caption-benchmark"))
    args = parser.parse_args()
    if args.max_images < 1 or args.max_new_tokens < 1:
        parser.error("max-images and max-new-tokens must be positive")
    sys.exit(run(args))
