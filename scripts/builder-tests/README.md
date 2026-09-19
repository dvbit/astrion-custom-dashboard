# Web builder tests

Headless (jsdom) checks for the card forms in `app/src/main/assets/docs/` —
see [`docs/EDITOR_FORMS_SPEC.md`](../../docs/EDITOR_FORMS_SPEC.md) §S11.

```sh
cd scripts/builder-tests
npm install
npm test
```

Loads the real `index.html` and scripts, then checks form round trips,
preservation of unmodeled option keys, nested `row` editing, floor-plan
drag positioning, title tap actions, preview rendering, and that every key
the forms write is read by the app's Kotlin code.
