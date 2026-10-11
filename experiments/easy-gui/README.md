# Easy GUI Studio — React component composition PoC

An isolated React + Ant Design experiment alongside the NativeWeb C++ runtime. Existing native sources are unchanged.

## Visual Studio refresh (v0.2)

The Studio now starts with a **working user-management screen**, not a blank renderer. Select a template from the canvas toolbar:

- **사용자 관리**: live table, summary cards and two separately bound AddressEditor instances.
- **고객 등록 폼**: real text/date/select/checkbox inputs and sample binding.
- **운영 대시보드**: statistics, progress, notifications and table.
- **컨트롤 갤러리**: try the built-in controls, tree, list, slider and Splitter.
- **빈 화면**: empty composition starting point.

The Toolbox provides **28 real React/Ant Design-based controls**, grouped as layouts, inputs, display components and actions/data tools. Search by GUI name or type. Click a control to enter placement mode, then click the desired canvas location. Alternatively drag directly from Toolbox to the canvas. Select a preview element or tree node to edit its properties. Boolean and enum fields offer pickers, while bindings can be chosen from sample data fields. Undo/Redo and mobile-width preview are supported.

Browser regression tests save **screenshots** into the GitHub Actions `easy-gui-visual-review` artifact so visual changes can be inspected rather than checking only build success.

**Not production-ready yet:** free-coordinate canvas layout, full Dock/slot designer, comprehensive accessibility and breakpoint authoring still need work. This is a real React/AntD MVP for assessing creation flow, not a replacement UI engine.

## Layout authoring (v0.3)

- Click a control in Toolbox, then click its destination on the canvas. Press **Esc** or **취소** to cancel without changing the document.
- Drag from Toolbox to a component or into a Row/Column/Grid/Panel. The highlighted **before/after/inside** target controls the insertion point, not the end of the root list.
- Select an existing component to show its **move handle**; drag the handle to relocate it. Component Tree drag/drop is still supported.
- Select a Grid child to adjust its **Grid 너비** in the Inspector, or use the handle on the right edge (mouse drag or Left/Right keyboard arrow). Mobile preview collapses grids to a single column.
- Every selected control supports **Hug**, **Fill**, and **Fixed px** width modes. Editor sizing is stored in `node.sizing` and grid occupancy in `node.placement.desktop.span` rather than mixed with ordinary React props.
- Existing Blueprint JSON without layout metadata continues to render with the old defaults. Exported components preserve their placement and sizing.

### Layout metadata example

```json
{
  "type": "TextField",
  "id": "email",
  "props": { "label": "이메일" },
  "sizing": { "mode": "fill" },
  "placement": { "desktop": { "span": 2 } }
}
```

For a Grid with `columns: 3`, this control spans two columns on desktop and one in mobile preview. `src/layout.mjs` owns immutable exact insertion, relocation, size/span adjustments, and validation. Browser E2E includes drag, click placement, resize, keyboard editing, and mobile regression.

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

## Current architecture and composable authoring

This is **not** a new UI framework. Any trusted React component can still be authored as ordinary JSX. The optional manifest is only for designer discovery.

- `src/catalog.mjs`: builtin control definitions and default data/action ports (single source of metadata).
- `src/manifest.mjs`: unified manifest view for builtins, trusted React modules, and extracted compositions; drives Toolbox/Inspector.
- `src/blueprint.mjs`: serializable screen tree, validation, immutable data paths and scoped component expansion. Runtime nodes carry `instancePath` and `editableId` so repeated composites select their owning instance.
- `src/commands.mjs`: pure add/update/duplicate/remove/move/extract operations that preserve the original screen.
- `src/DynamicView.jsx`: renderer traversal, bindings, actions and selection.
- `src/adapters/antd.jsx`: default React UI library renderer; a different trusted renderer can be provided with `renderBuiltin`.

### Extract a reusable component

1. Select a Panel/Form or other non-root node in the **Component Tree** or canvas.
2. Choose **컴포넌트로 추출** and give it a unique name.
3. The selected subtree is replaced by one composite instance. The component appears in the Toolbox.
4. Its properties, bindings and events are suggested as named external ports.
5. Use **컴포넌트 패키지** to export a local `.easygui.json` bundle, and install it in another generated project using `npm run components -- add ...`.

Tree nodes and the **selected canvas element's move handle** can be dragged to relocate them; Toolbox controls can also be dropped at specific locations. The canvas shows before/after/inside insertion hints. Invalid drops, cycles, and duplicate node IDs are rejected. This remains **flow-based layout**, not unrestricted absolute-coordinate positioning.

**Known limits:** exposed ports are currently inferred and cannot yet be curated in a guided UI; nested slots, true round-trip TSX, IR-to-independent-TSX generation, automatic npm metadata inference and hosted package publication remain future milestones. Real React component code is always installed as trusted application code, never executed from imported JSON.

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
- Visual editing supports Toolbox/canvas drag/drop, exact insertion, Undo/Redo, and Grid span/sizing. Free absolute positioning and a full multi-breakpoint editor are future work.
- No full JSX ↔ JSON transformation. Advanced React remains unrestricted.
- Default control adapter is AntD; a second adapter has not been verified.
