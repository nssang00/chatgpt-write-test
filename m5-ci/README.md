# M5 CI input bundle

**This directory currently contains documentation only, not the renderer and PBF fixtures.**

Upload the exact `M5_OL1010_4Stage_CI_Project_20261013.zip` into **this folder** via GitHub's **Add file > Upload files** on the `main` branch, so it becomes `m5-ci/project.zip`. Do not unzip the archive in GitHub.

- File size: **4,810,330 bytes**
- SHA256: `62c906b8b00bf9cf91752378e0b637aba728500198ec616ca109d62af79a9b88`

The upload triggers **M5 Basic Render and OL 10.10.0 CPU**. It fails closed if the ZIP is missing or its hash differs. Every result must include screenshots + `result.json`; tests don't assume rendering works. GPU performance is separate and needs the self-hosted Windows `m5-gpu` runner.

Details: [M5 CI setup](../.github/M5-CI-README.md).
