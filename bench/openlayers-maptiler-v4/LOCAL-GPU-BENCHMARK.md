# Local GPU Benchmark

This folder contains a one-click local benchmark for OpenLayers 10.10.0.

## Test configuration

- 50 OpenLayers layers
- 500,000 total features
- 10,000 features per layer
- Geometry mix: 50% LineString / 30% Point / 20% Polygon
- Canvas: VectorTileLayer x 50
- WebGL: WebGLVectorTileLayer x 50
- 1280 x 720 viewport
- 8 measured render frames

The test uses synthetic vector-tile features, so no MapTiler API key is required.

## Windows one-click run

Double-click `run-local-benchmark.bat`.

The script will verify Node.js, install dependencies and Chromium if needed, run Canvas and WebGL benchmarks, detect the WebGL GPU renderer, capture screenshots, collect Windows GPU/system information, and create a ZIP automatically.

Upload the generated `OpenLayers-GPU-Benchmark-*.zip` file back to ChatGPT for analysis.

## GPU validation

The runner launches headed Chrome/Chromium with `--enable-gpu` and `--ignore-gpu-blocklist`.

Check `report.md` after the run. It reports either `HARDWARE GPU DETECTED` or `WARNING: SOFTWARE/UNKNOWN WEBGL RENDERER`.

If the renderer contains `SwiftShader`, the run did not use the hardware GPU.

## Optional browser override

The runner tries installed Google Chrome first and falls back to Playwright Chromium. To force a browser executable, set `CHROME_PATH` before running the benchmark.
