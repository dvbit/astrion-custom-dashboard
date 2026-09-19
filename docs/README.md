# Dashboard Editor

A single-file, static HTML tool for building `dashboard.json` visually — no hand-written JSON required. Matches the exact schema the [Astrion Custom](../README.md) app reads. The editing flow follows the Home Assistant dashboard editor: pages are tabs above the preview, and cards are added/edited/reordered directly on the preview itself instead of through a permanent side form.

**Live version**: [Online Dashboard Editor](https://dckiller51.github.io/astrion-custom-dashboard/)

No install, no build step — open the link (or `index.html` locally in any browser) and start building.

## What it does

- **Pages**: shown as tabs above the preview. Click **+** next to the tabs to add one; the active tab shows a **⚙** that opens its settings (rename, delete, set as the page shown on launch).
- **Cards**: click the **+** floating button in the corner of the preview screen to add one — a dialog opens with a per-type form (light, switch, cover, fan, climate, source selector, button/scene grids, Apple TV / TV remotes...). Click the ✎ icon on an existing card in the preview to edit it in the same dialog, or ✕ to delete it.
- **Reordering**: drag a card to a new position in the preview, or use its ↑/↓ icons.
- **Hotkeys**: bind physical remote buttons either globally or per page, to a page-navigation, a Home Assistant service call, or a direct Harmony IR command/activity — listed with edit/delete.
- **IR Activities**: build a sequence of raw IR commands sent directly through the device's blaster, for use in a scene_grid item's "IR activity" action.
- **Import**: paste an existing `dashboard.json` to load and continue editing it, instead of starting from scratch.
- **Output**: the JSON updates live as you build; copy it or download `dashboard.json` directly.

Once you have your file, upload it from the app's local configurator (`http://<remote-ip>:8080` on the device — see the main README's [Local configuration](../README.md#local-configuration-no-adb-needed) section) or push it to `/sdcard/astrion/dashboard.json` manually.

## Card types

Every registered card type has a dedicated form — including `speaker_group`, `monitor`, `row` (children are edited with their own forms, nesting included) and `picture_elements` (drag-to-position markers over a local copy of the floor plan, radar and vacuum overlays). The `title` card's title/subtitle tap actions are part of its form too. Re-saving a card keeps any option the form doesn't model (e.g. `pin`). Only "Other / custom type…" still uses a raw JSON options field — check the corresponding `CardRenderer`'s Kotlin file in `src/main/java/com/custom/astrion/cards/impl/` for its exact fields. Details: [EDITOR_FORMS_SPEC.md](EDITOR_FORMS_SPEC.md).
