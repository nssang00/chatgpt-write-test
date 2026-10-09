# Easy GUI Studio (PoC)

**Purpose:** enable MFC/WPF and React beginners to use existing React UI components quickly, without introducing a new UI renderer. This is an isolated experiment; NativeWeb C++ code remains unchanged.

## Start

From this directory:

    npm install
    npm run dev

Open the Vite local URL. Edit in the visual catalog/property panel or the JSON editor; each change updates a real React + Ant Design preview. Two reusable AddressEditor instances bind independently to shipping and billing data.

## Generate a project

    npm run create -- ../my-app
    cd ../my-app
    npm install
    npm run dev

The scaffolder refuses to overwrite an existing directory.

## Tests

    npm run test:unit
    npm run test:smoke
    npm run test:regression
    npm run build

Node built-in tests can run offline. The production React build requires npm dependencies. GitHub Actions runs all four commands on Ubuntu and Windows.

## Concepts

- JSX: ordinary React/AntD components remain available, with no registration requirement.
- Blueprint: a limited, data-only JSON tree resolves pre-approved components and actions.
- Composite: a published blueprint becomes another Toolbox component; copies have independent data scopes.
- Export/import: JSON bundle includes the blueprint and local component definitions.
- No arbitrary JavaScript in JSON; no eval or arbitrary remote packages at runtime.

## Current limits

- Visual editing uses add/select/edit/remove, not yet full drag-and-drop nesting.
- 'Publish' registers a component in the **current Studio session**, not a hosted registry or npm.
- Code tab explains integration, not full JSX round-trip generation.
- Default AntD is replaceable in principle, but a second renderer is not yet built.
- No actual persistence backend; sample Save events show the selected model.

## Next

1. Component manifest and safe third-party React component registration.
2. Nested drag-and-drop designer, typed binding editor, action editor, undo/redo.
3. Persisted component packages and cross-project dependency/version resolution.
4. NativeWeb bridge template and real API/CRUD integration.
