# Easy GUI Studio — React component composition PoC

An isolated React + Ant Design experiment alongside the NativeWeb C++ runtime. Existing native sources are unchanged.

## Quick start

```bash
cd experiments/easy-gui
npm install
npm run dev
```

Use Toolbox to select existing UI controls and trusted React components, edit props/bindings, and preview immediately. The same AddressEditor block is used twice with independent shipping/billing data.

## Register an existing React component

Any ordinary React component works in code, without an Easy GUI dependency. To expose it in Designer/JSON, import and register it in `src/code-components.jsx`:

```jsx
const registered=defineReactComponent('StatusBadge',StatusBadge,{
  props:{label:{type:'string',default:'상태'},tone:{type:'enum',options:['blue','green'],default:'green'}},
  bindings:{active:{prop:'active'}}
});
```

The `StatusBadge` example itself lives in `src/custom/StatusBadge.jsx` and uses an actual Ant Design Tag. Its manifest is for editor discoverability. React code always comes from trusted build-time imports, not remote JSON.

## Export a composite and install it in another project

Choose **컴포넌트 패키지** in the Studio; save `MySharedScreen.easygui.json`.
In a separate project created with `npm run create -- ../my-app`:

```bash
cd ../my-app
npm run components -- add /path/to/MySharedScreen.easygui.json
npm install
npm run dev
```

The CLI merges versioned, validated definitions into `src/installed-components.json`. Composites appear in the Toolbox on startup. The installer rejects unknown components, recursion, unsafe property keys, and version/name conflicts. A bundle referencing a code component declares it in `requires.react`; the receiving app must separately import that code into `src/code-components.jsx`.

Studio's **JSON 가져오기** also recognizes portable component bundles. Downloaded JSON never executes JavaScript.

## Tests

```bash
npm run test:unit
npm run test:smoke
npm run test:regression
npm run build
npx playwright install chromium
npm run test:e2e
```

GitHub Actions runs Node tests and build on Ubuntu/Windows and Chromium e2e on Ubuntu.

## Limits

- Local JSON package transfer works; no remote marketplace, npm publish or untrusted runtime code loading.
- Visual edit currently supports add/select/inspect/remove, not nested drag/drop or undo.
- No full JSX ↔ JSON transformation. Advanced React remains unrestricted.
- Default control adapter is AntD; a second adapter has not been verified.
