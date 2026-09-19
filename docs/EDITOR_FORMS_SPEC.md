# Web builder — forms for the remaining card types (spec)

Version: app 1.2.0 · Scope: `app/src/main/assets/docs/` (the web builder served at
`http://<remote-ip>:8080/builder/`). No Kotlin/runtime change. Code comments
reference the section ids below as `[S1]`…`[S10]`.

Every option below was cross-checked against what the app actually reads
(`config/DashboardLoader.kt`, `cards/impl/*.kt`).

## [S1] Goal

Before 1.2.0, four registered card types (`speaker_group`, `monitor`,
`picture_elements`, `row`) had no form in the card dialog: they fell through
to "Advanced (raw options)", a JSON textarea. The `title` card's tappable
title/subtitle actions (`title_*` / `subtitle_*`) were also JSON-only.

1.2.0 gives each of them a form in the same style as the existing ones:
- same dialog;
- same label/hint conventions;
- same Home Assistant device-catalog pickers where the card only takes catalog domains;
- English only, like the rest of the builder.

The raw-JSON path stays available through "Other / custom type…".

## [S2] Preserving option keys a form doesn't model

**Problem:** every form used to rebuild `options` from scratch on save. Any key
the form didn't know about was silently dropped on the next edit, for example:
- `pin: "bottom"` on any card;
- `layout` on `scene_grid`;
- `step` on `climate`;
- `commands` / `apps` on `tv_remote`.

**Rule:** when an existing card is re-saved with the **same type**, every key of
its original `options` that is not in `FORM_MANAGED_KEYS[type]` and not already
produced by the form is copied back unchanged.

- Keys a form does manage are **not** copied back. This way, clearing an optional field in the form really removes it.
- Changing the card type starts clean.
- Types with no managed-key list (the raw-JSON `custom` path) are left alone: the textarea already holds every key.

**Nested objects:** list entries (speakers, monitor entities, picture elements)
and the `radar` / `vacuum` blocks of `picture_elements` keep their own extra
keys the same way, because the form edits a copy of the original object rather
than a fresh one.

## [S3] `speaker_group` form

| Field | Writes | Notes |
|---|---|---|
| Master speaker | `master` | Required. Catalog picker (`media_player`), like other HA cards |
| Master display name | `name` | Optional |
| Speakers list | `speakers[]` = `{entity_id, name}` | Add / remove / reorder rows |

- A speaker row with no entity is dropped on save.
- Speaker rows use the catalog picker when the catalog has at least one `media_player`; otherwise they fall back to a free-text field with live autocomplete.

## [S4] `monitor` form

| Field | Writes | Notes |
|---|---|---|
| Title | `title` | Optional |
| Entities list | `entities[]` = `{entity_id, name}` | At least one row required; `name` optional |

- Entities are free text with live autocomplete over **any** domain. Sensors are not part of the device catalog's domains.

## [S5] `row` form and nested card editing

- The form lists the child cards (type + label) with ✎ edit, ↑/↓ reorder and ✕ remove, plus "+ Add child card". At least one child is required.
- Editing or adding a child reuses the **same card dialog and the same form of
  the child's type** (including another `row`), via an edit stack
  (`cardEditStack`):
  - Opening a child pushes a frame with the parent row's draft children.
  - Saving the child writes it into that draft (not onto the page), then reopens the parent row form.
  - Cancel / ✕ / backdrop while editing a child returns to the parent row, discarding only that child's changes.
- The page is only touched when the outermost row is saved.
- [S2] also applies to children: re-saving a child keeps its unknown keys.

## [S6] `picture_elements` form

### [S6.1] Base fields

| Field | Writes | Default in app |
|---|---|---|
| Image path on the remote | `image` | `/sdcard/astrion/floorplan.png` |
| Aspect ratio (W/H) | `aspect` | `1.3` (only until the image is loaded) |
| Local copy of the image | — (never saved/uploaded) | Used only as the positioning canvas background |

"Use this image's ratio" copies the local image's natural W/H into Aspect.

### [S6.2] Elements

Each row writes one entry of `elements[]`:
- **Entity mode:** `{entity_id, left, top}`. Tap = toggle in the app.
- **Service mode:** `{service, targets[], left, top}`. `targets` is a comma-separated list in the form.
- `icon: "power"` is written only when chosen; the default bulb is omitted.
- `left` / `top` are 0–100 %, rounded to 0.1.

### [S6.3] Positioning canvas

- Shows the local image (or a neutral grid) at the configured aspect ratio.
- Draggable markers:
  - every element;
  - the radar origin;
  - every vacuum room position;
  - the vacuum dock.
- Dragging updates the matching numeric fields live.
- Pointer events work for mouse and touch.

### [S6.4] Radar overlay (`radar`)

- Written only when "Radar overlay" is checked.
- Fields: `prefix` (required), `targets`, `origin_left`, `origin_top`, `scale_x`, `scale_y`, `scale_x_right`, `top_offset_left`, `rotation`, `flip_x`, `flip_y`, `blend`.
- A value equal to the app default, or a blank field, removes the key. This keeps the JSON minimal and lets the app defaults apply.

### [S6.5] Vacuum overlay (`vacuum`)

Written only when "Vacuum overlay" is checked. Fields:
- `entity_id` (required, catalog picker);
- `name`, `map_image`, `map_rotation`, `map_height`, `room_entity`;
- `rooms[]` = `{name, id}`;
- `room_positions` = `{ "<room name as reported by room_entity>": [left, top] }`, edited as its own list;
- `dock_position` = `[left, top]` (optional);
- `room_clean_action` = `{domain, service, parameter}`: all three or none, same rule as the `vacuum` card.

## [S7] `title` card actions

Two identical blocks, **Title tap action** and **Subtitle tap action**, with prefix `title_` / `subtitle_`.

**Action:**

| Action | Writes |
|---|---|
| none | — |
| Scene/script | `entity_id` |
| Harmony activity | `activityId` + optional `hub` |
| Harmony command | `harmonyDevice` + `harmonyCommand` + optional `hub` |
| Local IR command | `irDevice` + `irCommand` |
| Composed Activity | `activity` |

**Also open page (optional):** writes `page`. Disabled with a Composed Activity: the app ignores `page` there, and the Activity's own page is used instead.

On fill, the action is detected in the order activity → activityId → harmonyDevice → irDevice → entity_id.

## [S8] Preview

The phone preview gets real renderers for the four types instead of the generic name/entity fallback:

- `speaker_group`: master + speaker rows, group check from live `group_members` when available.
- `monitor`: rows with live value + unit when available, `—` otherwise.
- `row`: children side by side with type and label.
- `picture_elements`: aspect box with element, radar-origin and dock markers.

## [S9] Type selector

`speaker_group`, `monitor`, `picture_elements` and `row` move from the
"Advanced (raw options)" group to a new "Media & layout" group.
"Other / custom type…" stays for anything else.

## [S10] Versioning

`versionName` 1.1.4 → 1.2.0 (minor bump: new builder features, no breaking
change), `versionCode` 24 → 25. CHANGELOG entry under `[1.2.0]`.

## [S11] Verification

1. `node --check` on every changed JS file.
2. Headless DOM test (`scripts/builder-tests`, jsdom) loading the real `index.html` + scripts. For each new form it checks:
   - fill → save → fill → save gives identical JSON;
   - unknown keys survive (including nested ones);
   - row child add/edit/cancel keeps the page untouched until the parent is saved;
   - generated keys are all among those `DashboardLoader.kt` / the card's Kotlin file reads.
