# Easy GUI Studio PoC

Independent React+Ant Design experiment in the NativeWeb repository. Existing C++ runtime is not modified.

## Try it

    cd experiments/easy-gui
    npm install
    npm run dev

- Select controls in the toolbox, modify properties and bind data through the inspector.
- The actual preview uses React + existing Ant Design controls.
- Two `AddressEditor` instances have independent shipping/billing data.
- Register the current canvas as a composite component, then insert it again.
- Export/import JSON bundles containing blueprint + local definitions.
- Built-in JSX/React can be used directly without registry or designer.

## Create an app

    npm run create -- ../my-app
    cd ../my-app
    npm install
    npm run dev

Scaffolder never overwrites an existing target.

## Verification

    npm run test:unit
    npm run test:smoke
    npm run test:regression
    npm run build
    npx playwright install chromium
    npm run test:e2e

Node tests run offline. Build/browser tests need npm packages. Actions executes unit/smoke/regression/build on Ubuntu and Windows and real Chromium browser smoke/regression on Ubuntu.

## PoC limits / roadmap

- Register/publish is in-memory within one Studio session. Hosted registry/npm package publish is **not implemented**.
- Visual editor supports Toolbox/add/select/inspect/remove; not yet drag/drop nesting.
- Code tab is a handoff example, not full bidirectional JSX generation.
- No remote actions or dynamic code execution through JSON.
- Next: component manifest, typed ports, real package registry, full visual tree editor, .NET/NativeWeb bridge starter.

Security: reject unsafe paths, unknown components, cycles, excessive complexity. Use only trusted installed React packages; JSON never evaluates JavaScript.
