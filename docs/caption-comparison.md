# Self-hosted image caption comparison

GitHub Actions workflow: .github/workflows/compare-caption-models.yml
Runs on Windows self-hosted GPU runner with label m5-gpu, without modifying existing CI.

## Models
- CapRL-Qwen3VL-4B — BF16 via Transformers
- Qwen3-VL-4B-Instruct — BF16 via Transformers
- JoyCaption Beta One Q6_K GGUF — using llama.cpp and an extra vision projector (mmproj)

## Manual comparison
1. Add one to three non-sensitive JPG, PNG, or WebP photos to the public repository's inputs/ folder.
2. Open Actions > Compare image caption models (self-hosted) > Run workflow.
3. Choose models = all, max_images = 3, prompt_ids = all.
4. Download the caption-comparison-results Actions artifact.
5. Inspect report.md (side-by-side), summary.csv, results.jsonl, run-metadata.json, and JoyCaption server logs.

Pushes to the comparison workflow or scripts run ONLY a GPU preflight, without automatically downloading model weights.
No pictures are currently checked into inputs/. Comparison cannot run until images are supplied.
Do not commit private or sensitive images to a public repository.

## Hardware
A 2026-10-20 self-hosted GPU run reported RTX 5060 Ti 16 GB (sm_120); current availability is not guaranteed.
PyTorch CUDA 12.8 is selected to support RTX 50 series.
Allow substantial RAM, free disk space (~30 GB or more recommended), and disk caching time.

Model weights persist in the runner user's HF_HOME cache.
llama.cpp prebuilt Windows CUDA 12.8 binaries are pulled from pinned tag b11361 unless
LLAMA_SERVER_EXE specifies a local trusted llama-server.exe executable.
JoyCaption Q6_K weights come from mradermacher's GGUF repo; its F16 vision mmproj comes
from concedo/llama-joycaption-beta-one-hf-llava-mmproj-gguf. Both are necessary.
The temporary llama.cpp server binds to 127.0.0.1, not public interfaces.

The script uses the same resized RGB input and exact same English prompts, and greedy-style generation.
Models have different tokenizers, quantization and image encoders, so comparisons are application-level.
Automatic caption quality or hallucination scores are NOT fabricated. Review visually against the source images.

## Local Windows invocation
1. py -3.11 -m venv .venv-caption
2. .venv-caption/Scripts/python.exe -m pip install torch==2.10.0 --index-url https://download.pytorch.org/whl/cu128
3. .venv-caption/Scripts/python.exe -m pip install -r scripts/requirements-caption.txt
4. .venv-caption/Scripts/python.exe scripts/compare_caption_models.py --mode compare --models all

To run just one model choose --models caprl, --models qwen or --models joycaption.
Use --prompt-ids detailed,short to select prompt subsets.
Failures are written to each affected results row and outputs are uploaded even on partial failure.
