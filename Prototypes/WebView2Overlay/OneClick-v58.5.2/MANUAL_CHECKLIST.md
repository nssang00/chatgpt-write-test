# v58.5.2 manual acceptance sheet
Complete after automatic PENDING_MANUAL. Record evidence/screenshots.
- [ ] WebView2 is visible inside Unity Player HWND; no black/white empty content.
- [ ] Press Ping: text probe-pong appears again after resizing.
- [ ] Korean Hangul IME syllable composition; candidate window position correct.
- [ ] Keyboard tab/focus, switching to/from another application, mouse clicks.
- [ ] Move and resize Unity window: WebView bounds track correctly.
- [ ] Move between mixed-DPI monitors: browser location/scaling stays correct.
- [ ] Windowed native overlay z-order above UGUI documented.
- [ ] Exit and rerun twice; no hang, crash, unintended persistent msedgewebview2.exe process.
- [ ] Attach OS build, graphics device, screenshots and test outcome.

### r5 interactive Unicode Echo (not covered by automatic fixture)
- [ ] Type a NEW Hangul phrase with Windows Korean IME, including active syllable composition.
- [ ] Click `Send to Native Echo` (not `Native ping`). Confirm Native Echo visibly returns the exact phrase with `원문과 정확히 일치`.
- [ ] Try spaces, punctuation, emoji, and mixed English/Hangul input; verify no broken replacement characters.
- [ ] Check the IME candidate window position before committing typed Hangul.
