# R45 experimental application-level CPU-first Worker handover

**Status: development candidate; NOT a Production PASS.** R35's original always-worker cold-start acceptance remains FAIL. The R42 first-frame alternative is not permission to redefine that gate.

## Scope

The R35 source ZIP is not part of the GitHub repository. This folder provides a reproducible patch against that exact original extraction. It patches the *real* `DirectM5SceneBinding` and `OlVectorTileSourceAdapter` (not the benchmark HTML). The default renderer remains worker-OFF.

Changes:

- CPU feature ingest and foreground draw stay unchanged; Worker pool launches only **after** the foreground draw and deferred presentation callback.
- Shared PBF decode per source tile for multiple scene layers, including opt-in duplicate source-layer names with cloneable styles, using the existing R37 grouped encoder.
- Per-(scene layer,tile coordinate) revisions protect against stale completion; tile prune/remove, changed layer style and teardown invalidate pending work.
- Grouped Worker output can replace CPU tile streams only if **typed GPU input bytes, clip extents, packet order, and metadata are exactly identical**; rejected output leaves CPU in place.
- An injected Worker crash terminates handover and keeps CPU tiles. Strict memory bounds limit pending tile references.

## Apply locally

1. Extract `M5_R35_RTX_READY_SELF_CONTAINED_2026-10-22.zip` to a clean folder. Node 22 and Git must be available.
2. `node m5-gpu/r45/apply_r45.mjs <R35-source-folder>` (path to this repo's `apply_r45.mjs` can be absolute).
3. `cd <R35-source-folder>` and execute `node tests/verify_r45_handover.mjs`, `node tests/verify_r34_shared_worker_pool.mjs`, `node tests/verify_r33_worker_pool.mjs`, `node tests/verify_ol_disable_worker_m4_bridge.mjs`, `node tests/verify_direct_feature_edge_cases.mjs`.

The `R45_APP_PATCH.diff` includes the R37 encoder changes and must be applied only once to a **pristine R35 source**. Do not also run `patch_duplicate_decode.mjs` against the same source.

## Explicit opt-in API

```js
await OpenLayersRendererBinding.createDirectScene({
  map, backend,
  vectorTileOptions: { drawMode:'style-pass', stableStyleIdentityCache:true },
  deferredWorker: {
    enabled: true, workerSize: 2,
    // Supply original unmodified PBF bytes and a matching *cloneable* constant
    // style for every displayed layer of this source tile. Never guess the
    // bytes from getFeatures(): OL does not guarantee an encoded-PBF getter.
    resolveTask: async ({source,tile,tileKey,entries}) => ({
      tileKey, bytes: await getImmutablePbfBytes(source,tile),
      extent: entries[0].clipExtent,
      layers: entries.map(({layer}) => getCloneableStyleAndSourceLayer(layer)),
      options: {drawMode:'style-pass',closedLineJoins:true,unclipped:true,
        partialEarcut:true,polygonInsideSegmentFastPath:true,polygonEarBBoxPrecheck:true}
    })
  }
});
```

`getImmutablePbfBytes` and `getCloneableStyleAndSourceLayer` are **application-provided functions**, not exported R45 helpers. `resolveTask` is skipped if it returns null. Dynamic styles, transforms, unequal tile bytes or opacity mismatch should remain on CPU. The strict gate prevents a divergent Worker result from replacing CPU geometry; this is a **safety check**, not a substitute for on-GPU RGBA8 readback verification.

## Acceptance still outstanding

- Actual Chromium/Windows/RTX 5060 Ti end-to-end OL map input, DPR2 and framebuffer RGBA8 vs CPU/OL; no claim from Node fixtures.
- Full pan/zoom/rotate user input, cancellation/retries, Worker boot storms, page target switch, 30–60 min VRAM/memory stability.
- Distinct real 8/16/32 MVT sources (R40 repeated only four sources); performance with OL A/B and raw logs preserved.
- This design redundantly encodes first painted tiles in Workers and should not be represented as a 50% performance improvement in real production use until independently measured.
- **Do not merge or turn on by default** without the explicitly agreed acceptance definition.