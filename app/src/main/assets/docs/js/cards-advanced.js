// ---- Advanced card forms (speaker_group, monitor, row, picture_elements) ----
//
// Spec: docs/EDITOR_FORMS_SPEC.md — section ids like [S3] below refer to it.
//
// cards.js owns the card dialog and dispatches on the card type in three
// places: updateCardFormInputs() (build the form), fillCardForm() (load an
// existing card into it) and addCardToPage() (read it back into JSON). For
// the four types in ADV_FORMS it hands off to the html/init/fill/build
// functions defined here, so each form lives in one block instead of being
// spread across those three functions.
//
// Loaded after cards.js and before preview.js (see index.html). Everything is
// plain global functions, same as the rest of the builder — inline onclick=
// handlers in the generated HTML need them to be reachable by name.

// ---- Small shared helpers --------------------------------------------------

// Escapes a value for use inside an HTML attribute or text node. The other
// forms interpolate raw values; these ones take user-typed names that can
// contain quotes (e.g. `Kid's room`), which would otherwise break the markup.
function advEsc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Deep copy through JSON — dashboard.json content is plain JSON by definition.
function advClone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

// Percentages are stored with one decimal: enough precision for a 480px-wide
// screen (0.1% ≈ half a pixel) without noisy floats in the exported JSON.
function advRound(v) {
  return Math.round(Number(v) * 10) / 10;
}

function advClampPct(v) {
  return Math.min(100, Math.max(0, v));
}

// Reads a numeric <input>; returns null when blank/invalid so callers can tell
// "not set" apart from 0.
function advNumOrNull(id) {
  const el = document.getElementById(id);
  if (!el || el.value.trim() === '') return null;
  const n = Number(el.value);
  return Number.isFinite(n) ? n : null;
}

function advVal(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

// Human label for a card in lists (row children, previews).
function advCardLabel(card) {
  const o = card.options || {};
  return o.name || o.title || o.entity_id || o.master || o.remote_entity || o.image || '';
}

// ---- [S2] Preserve option keys a form doesn't model ------------------------
//
// Keys each form writes. Anything else found on the original card is copied
// back on re-save. The existing forms' lists were derived from the
// newCard.options.* assignments in addCardToPage() — keep them in sync when a
// field is added to one of those forms, otherwise its old value would be
// resurrected after the user clears it.
const TITLE_ACTION_SUFFIXES = ['entity_id', 'page', 'activityId', 'hub',
  'harmonyDevice', 'harmonyCommand', 'irDevice', 'irCommand', 'activity'];

const FORM_MANAGED_KEYS = {
  source_select: ['entity_id', 'icon', 'name'],
  title: ['alignment', 'color', 'divider', 'icon', 'subtitle', 'title',
    ...TITLE_ACTION_SUFFIXES.map(s => 'title_' + s),
    ...TITLE_ACTION_SUFFIXES.map(s => 'subtitle_' + s)],
  switch: ['entity_id', 'icon', 'name', 'on_color'],
  cover: ['entity_id', 'icon', 'layout', 'name', 'show_buttons_control',
    'show_position_control', 'show_tilt_position_control'],
  select: ['entity_id', 'icon_color', 'layout', 'name'],
  light: ['collapsible_controls', 'entity_id', 'layout', 'name', 'show_brightness',
    'show_brightness_control', 'show_color_control', 'show_color_temp_control', 'use_light_color'],
  media_player: ['entity_id', 'media_controls', 'name', 'show_volume_level', 'top_buttons',
    'use_media_info', 'variant', 'volume_controls'],
  camera: ['aspect', 'entity_id', 'fit', 'mode', 'name', 'snapshot_interval'],
  fan: ['entity_id', 'name', 'preset_modes', 'show_captions', 'step', 'style'],
  climate: ['entity_id', 'fan_mode_style', 'fan_modes', 'hvac_mode_style', 'hvac_modes', 'name',
    'show_captions', 'swing_mode_style', 'swing_modes'],
  button_grid: ['buttons', 'columns'],
  scene_grid: ['columns', 'icon_fill', 'scenes', 'show_labels', 'tile_height'],
  apple_tv_remote: ['deviceId', 'hub'],
  tv_remote: ['media_entity', 'mute_entity', 'name', 'remote_entity'],
  clock_weather: ['calendar_entity', 'entity_id', 'forecast_rows', 'time_format'],
  vacuum: ['entity_id', 'map_height', 'map_image', 'map_rotation', 'name', 'room_clean_action', 'rooms'],
  plex: ['host', 'items_per_row', 'media_entity', 'play_content_type', 'play_entity',
    'show_on_deck', 'show_recently_added_movies', 'show_recently_added_shows', 'source', 'token'],
  // [S3]–[S6]
  speaker_group: ['master', 'name', 'speakers'],
  monitor: ['title', 'entities'],
  row: ['cards'],
  picture_elements: ['image', 'aspect', 'elements', 'radar', 'vacuum'],
};

// Copies unmodeled keys from `original` into `built` (mutates and returns
// `built`). No-op for a new card, a type change, or a type without a managed
// list (raw JSON — its textarea already carries every key).
function preserveUnknownOptions(original, built) {
  if (!original || !built || original.type !== built.type) return built;
  const managed = FORM_MANAGED_KEYS[built.type];
  if (!managed) return built;
  const src = original.options || {};
  built.options = built.options || {};
  Object.keys(src).forEach(k => {
    if (!managed.includes(k) && !(k in built.options)) built.options[k] = advClone(src[k]);
  });
  return built;
}

// The card currently open in the dialog, as it was before editing — null for
// a new card. Child cards of a row live in the parent's draft, not on the page.
function advOriginalCard() {
  if (cardEditStack.length) {
    const f = cardEditStack[cardEditStack.length - 1];
    return f.childIdx === null ? null : f.rowCards[f.childIdx];
  }
  if (editingCard === null || editingCard === undefined) return null;
  const page = dashboardData.pages[currentActivePage];
  return page ? page.cards[editingCard] || null : null;
}

// ---- Generic editable list (used by [S3], [S4], [S6.5]) ---------------------
//
// Rows are edited inline; every keystroke updates ADV_LISTS[id].items, so
// adding/removing/reordering a row only re-renders the list itself, never
// the whole form (re-rendering the form would wipe the other fields).
//
// Column kinds:
//   entity — catalog <select> for a catalog domain when the catalog has
//            entries, otherwise a text input with live autocomplete
//   text   — plain text input
//   number — numeric input (stored as a Number, or removed when blank)
const ADV_LISTS = {};

function advListInit(id, cols, items, opts) {
  ADV_LISTS[id] = {
    cols,
    items: advClone(items || []),
    addLabel: (opts && opts.addLabel) || '+ Add row',
    newItem: (opts && opts.newItem) || (() => ({})),
    onChange: (opts && opts.onChange) || null,
  };
  advListRender(id);
}

// Markup placeholder a form drops in where the list should appear.
function advListHtml(id) {
  return `<div id="${id}" class="adv-list"></div>`;
}

function advCatalogOptions(domain) {
  return (dashboardData.haDevices || []).filter(d => d.domain === domain);
}

function advListRender(id) {
  const list = ADV_LISTS[id];
  const host = document.getElementById(id);
  if (!list || !host) return;
  const rows = list.items.map((item, i) => {
    const cells = list.cols.map(c => {
      const value = item[c.key];
      const common = `data-list="${id}" data-i="${i}" data-key="${c.key}" data-kind="${c.kind}"`;
      const flex = `style="flex:${c.flex || 1}; min-width:0;"`;
      if (c.kind === 'entity' && c.domain && HA_DOMAIN_LABEL[c.domain] && advCatalogOptions(c.domain).length) {
        const opts = advCatalogOptions(c.domain);
        const known = opts.some(d => d.entityId === value);
        return `<select ${common} ${flex} onchange="advListOnInput(this)">
          <option value="">— ${advEsc(c.label)} —</option>
          ${value && !known ? `<option value="${advEsc(value)}" selected>${advEsc(value)} (not in catalog)</option>` : ''}
          ${opts.map(d => `<option value="${advEsc(d.entityId)}"${d.entityId === value ? ' selected' : ''}>${advEsc(d.name)}</option>`).join('')}
        </select>`;
      }
      const type = c.kind === 'number' ? 'number' : 'text';
      const step = c.kind === 'number' ? ` step="${c.step || 'any'}"` : '';
      return `<input type="${type}"${step} ${common} ${flex} value="${advEsc(value)}" placeholder="${advEsc(c.label)}" oninput="advListOnInput(this)">`;
    }).join('');
    return `<div class="list-item adv-list-row">
      <span class="adv-list-idx">${i + 1}</span>${cells}
      <span class="adv-list-btn" title="Move up" onclick="advListMove('${id}', ${i}, -1)">↑</span>
      <span class="adv-list-btn" title="Move down" onclick="advListMove('${id}', ${i}, 1)">↓</span>
      <span class="remove" title="Remove" onclick="advListRemove('${id}', ${i})">✕</span>
    </div>`;
  }).join('');
  host.innerHTML = `${rows || '<div class="hint">No rows yet.</div>'}
    <button type="button" class="secondary" onclick="advListAdd('${id}')">${advEsc(list.addLabel)}</button>`;

  // Live autocomplete on free-text entity cells (only when /ha-states data is
  // available — see attachEntityAutocomplete in preview.js).
  host.querySelectorAll('input[data-kind="entity"]').forEach(el => {
    const col = list.cols.find(c => c.key === el.dataset.key);
    if (typeof attachEntityAutocomplete === 'function') attachEntityAutocomplete(el, col && col.domain ? col.domain : null);
  });
}

function advListOnInput(el) {
  const list = ADV_LISTS[el.dataset.list];
  const item = list && list.items[Number(el.dataset.i)];
  if (!item) return;
  const key = el.dataset.key;
  if (el.dataset.kind === 'number') {
    const n = el.value.trim() === '' ? null : Number(el.value);
    if (n === null || !Number.isFinite(n)) delete item[key]; else item[key] = n;
  } else {
    item[key] = el.value;
  }
  if (list.onChange) list.onChange();
}

function advListAdd(id) {
  const list = ADV_LISTS[id];
  list.items.push(list.newItem());
  advListRender(id);
  if (list.onChange) list.onChange();
}

function advListRemove(id, i) {
  const list = ADV_LISTS[id];
  list.items.splice(i, 1);
  advListRender(id);
  if (list.onChange) list.onChange();
}

function advListMove(id, i, dir) {
  const list = ADV_LISTS[id];
  const j = i + dir;
  if (j < 0 || j >= list.items.length) return;
  [list.items[i], list.items[j]] = [list.items[j], list.items[i]];
  advListRender(id);
  if (list.onChange) list.onChange();
}

// Items with every listed key trimmed; rows whose `requiredKey` is empty are
// dropped. Extra keys an item already had (from the original JSON) are kept
// untouched — [S2] for nested objects.
function advListItems(id, requiredKey) {
  const list = ADV_LISTS[id];
  if (!list) return [];
  return list.items
    .map(item => {
      const out = advClone(item);
      list.cols.forEach(c => {
        if (typeof out[c.key] === 'string') {
          out[c.key] = out[c.key].trim();
          if (out[c.key] === '') delete out[c.key];
        }
      });
      return out;
    })
    .filter(item => !requiredKey || item[requiredKey]);
}

// ---- [S3] speaker_group -----------------------------------------------------

const SPEAKER_COLS = [
  { key: 'entity_id', label: 'Speaker (media_player)', kind: 'entity', domain: 'media_player', flex: 3 },
  { key: 'name', label: 'Display name', kind: 'text', flex: 2 },
];

const speakerGroupForm = {
  html: () => `
    ${haEntityFieldHtml('media_player', 'optSgMaster', 'Master speaker (group coordinator)')}
    <label>Master display name (optional)</label><input type="text" id="optSgName" placeholder="e.g., Living room">
    <label>Speakers that can join the master's group</label>
    ${advListHtml('sgSpeakers')}
    <div class="hint">One row per speaker on the remote: a tick (member of the master's group), a draggable volume bar, mute and −/+ buttons. The master is always the first row. Ticking a speaker calls <code>media_player.join</code> on the master straight away, unticking calls <code>media_player.unjoin</code>. Group membership is read from each speaker's own <code>group_members</code> attribute, so it only works with integrations that report it (Sonos, most Cast/Music Assistant players…).</div>
  `,
  init() {
    if (!ADV_LISTS.sgSpeakers) advListInit('sgSpeakers', SPEAKER_COLS, [], { addLabel: '+ Add speaker' });
    else advListRender('sgSpeakers');
  },
  fill(o) {
    setEntitySelectValue('optSgMaster', o.master);
    document.getElementById('optSgName').value = o.name || '';
    advListInit('sgSpeakers', SPEAKER_COLS, o.speakers || [], { addLabel: '+ Add speaker' });
  },
  build() {
    const master = advVal('optSgMaster');
    if (!master) { alert('Pick the master speaker — the card is not shown without one.'); return null; }
    const out = { master };
    const name = advVal('optSgName');
    if (name) out.name = name;
    out.speakers = advListItems('sgSpeakers', 'entity_id');
    return out;
  },
};

// ---- [S4] monitor -------------------------------------------------------------

const MONITOR_COLS = [
  { key: 'entity_id', label: 'Entity (any domain)', kind: 'entity', domain: null, flex: 3 },
  { key: 'name', label: 'Label (optional)', kind: 'text', flex: 2 },
];

const monitorForm = {
  html: () => `
    <label>Title (optional)</label><input type="text" id="optMonTitle" placeholder="e.g., Environment">
    <label>Values to show</label>
    ${advListHtml('monEntities')}
    <div class="hint">Read-only list: label, current state and <code>unit_of_measurement</code>. Any entity works (sensor.*, binary_sensor.*, input_number.*…). <code>unknown</code>/<code>unavailable</code> show as “—”. The label defaults to the entity's friendly name.</div>
  `,
  init() {
    if (!ADV_LISTS.monEntities) advListInit('monEntities', MONITOR_COLS, [{}], { addLabel: '+ Add entity' });
    else advListRender('monEntities');
  },
  fill(o) {
    document.getElementById('optMonTitle').value = o.title || '';
    advListInit('monEntities', MONITOR_COLS, o.entities || [], { addLabel: '+ Add entity' });
  },
  build() {
    const entities = advListItems('monEntities', 'entity_id');
    if (!entities.length) { alert('Add at least one entity.'); return null; }
    const out = {};
    const title = advVal('optMonTitle');
    if (title) out.title = title;
    out.entities = entities;
    return out;
  },
};

// ---- [S5] row + nested card editing -----------------------------------------
//
// cardEditStack holds one frame per row being edited "above" the card that's
// currently open in the dialog:
//   { parentEditingCard, rowCards, childIdx }
// parentEditingCard — editingCard to restore when returning to the row
// rowCards          — the row's draft children (not yet on the page)
// childIdx          — index being edited in rowCards, or null for a new child
let cardEditStack = [];

const rowForm = {
  html: () => `
    <label>Child cards (shown side by side, equal width)</label>
    <div id="rowChildrenList"></div>
    <button type="button" class="secondary" onclick="rowEditChild(null)">+ Add child card</button>
    <div class="hint">Each child is a complete card edited with its own form — any type works, including another row. Children are only written to the page when you save this row. Inside a row, the <em>Vertical</em> layout of light/cover/select cards usually fits best.</div>
  `,
  init() {
    window._pendingRowCards = window._pendingRowCards || [];
    renderRowChildren();
  },
  fill(o) {
    window._pendingRowCards = advClone(o.cards || []);
    renderRowChildren();
  },
  build() {
    const cards = advClone(window._pendingRowCards || []);
    if (!cards.length) { alert('Add at least one child card.'); return null; }
    return { cards };
  },
};

function renderRowChildren() {
  const host = document.getElementById('rowChildrenList');
  if (!host) return;
  const cards = window._pendingRowCards || [];
  host.innerHTML = cards.length ? cards.map((c, i) => `
    <div class="list-item">
      <span><b>${advEsc(c.type)}</b>${advCardLabel(c) ? ' — ' + advEsc(advCardLabel(c)) : ''}</span>
      <span>
        <span class="adv-list-btn" title="Edit" onclick="rowEditChild(${i})">✎</span>
        <span class="adv-list-btn" title="Move left" onclick="rowMoveChild(${i}, -1)">↑</span>
        <span class="adv-list-btn" title="Move right" onclick="rowMoveChild(${i}, 1)">↓</span>
        <span class="remove" title="Remove" onclick="rowRemoveChild(${i})">✕</span>
      </span>
    </div>`).join('') : '<div class="hint">No child cards yet.</div>';
}

function rowMoveChild(i, dir) {
  const cards = window._pendingRowCards;
  const j = i + dir;
  if (j < 0 || j >= cards.length) return;
  [cards[i], cards[j]] = [cards[j], cards[i]];
  renderRowChildren();
}

function rowRemoveChild(i) {
  window._pendingRowCards.splice(i, 1);
  renderRowChildren();
}

// Clears every per-form scratch state so a freshly opened form starts empty.
// _pendingGridItems/_pendingVacuumRooms belong to cards.js's grid and vacuum
// forms; the rest are this file's.
function advResetFormState() {
  window._pendingGridItems = [];
  window._pendingVacuumRooms = [];
  window._pendingRowCards = null;
  Object.keys(ADV_LISTS).forEach(k => delete ADV_LISTS[k]);
  peState = null;
}

// Opens child `i` of the row currently in the dialog (null = new child).
function rowEditChild(i) {
  cardEditStack.push({
    parentEditingCard: editingCard,
    rowCards: advClone(window._pendingRowCards || []),
    childIdx: i,
  });
  editingCard = null;
  const child = i === null ? null : cardEditStack[cardEditStack.length - 1].rowCards[i];
  advResetFormState();
  advLoadIntoDialog(child);
}

// Selects the type and fills the form for `card` (null = empty new card).
// Mirrors openCardDialog() in cards.js, minus reading from the page.
function advLoadIntoDialog(card) {
  const select = document.getElementById('cardTypeSelect');
  if (!card) {
    select.value = select.options[0].value;
    updateCardFormInputs();
  } else {
    const known = Array.from(select.options).map(o => o.value).filter(v => v !== 'custom');
    select.value = known.includes(card.type) ? card.type : 'custom';
    updateCardFormInputs();
    fillCardForm(card);
  }
  advUpdateDialogLabels();
}

// Called by addCardToPage() instead of writing to the page while a row child
// is open: the child goes into the parent's draft, then the row form returns.
function advCommitChild(newCard) {
  const f = cardEditStack.pop();
  if (f.childIdx === null) f.rowCards.push(newCard);
  else f.rowCards[f.childIdx] = newCard;
  advReturnToRow(f);
}

// Cancel/close while a row child is open: drop only the child's changes.
function advCancelChild() {
  advReturnToRow(cardEditStack.pop());
}

function advReturnToRow(frame) {
  advResetFormState();
  editingCard = frame.parentEditingCard;
  window._pendingRowCards = frame.rowCards;
  document.getElementById('cardTypeSelect').value = 'row';
  updateCardFormInputs(); // rowForm.init() keeps _pendingRowCards as set above
  advUpdateDialogLabels();
}

// Dialog title/buttons reflect whether we're on the page or inside a row.
function advUpdateDialogLabels() {
  const inRow = cardEditStack.length > 0;
  const isNew = advOriginalCard() === null;
  document.getElementById('cardEditorTitle').textContent = inRow
    ? (isNew ? 'Add child card (inside row)' : 'Edit child card (inside row)')
    : (isNew ? 'Add card' : 'Edit card');
  document.getElementById('addCardBtn').innerText = inRow
    ? (isNew ? 'Add to row' : 'Save child')
    : (isNew ? 'Add card to page' : 'Save changes');
  const cancel = document.getElementById('cancelCardEditBtn');
  if (cancel) cancel.innerText = inRow ? 'Back to row' : 'Cancel';
  const close = document.querySelector('#cardEditorModal .preview-modal-close');
  if (close) close.innerText = inRow ? '← Back to row' : '✕ Close';
}

// ---- [S6] picture_elements ---------------------------------------------------
//
// peState keeps the parts of the card that are lists/positions (elements,
// vacuum room positions, dock) plus the original radar/vacuum objects so
// their unmodeled keys survive [S2]. Scalar radar/vacuum settings live in
// their inputs and are read at build time.
let peState = null;

const PE_DEFAULT_IMAGE = '/sdcard/astrion/floorplan.png';
const PE_DEFAULT_ASPECT = 1.3;
// App-side defaults (PictureElementsCard.kt RadarDots) — a field equal to its
// default is omitted from the JSON [S6.4].
const PE_RADAR_DEFAULTS = {
  targets: 3, origin_left: 50, origin_top: 10, scale_x: 8, scale_y: 8,
  top_offset_left: 0, rotation: 0, blend: 'overlay',
};
const PE_RADAR_NUM_FIELDS = ['targets', 'origin_left', 'origin_top', 'scale_x', 'scale_y',
  'scale_x_right', 'top_offset_left', 'rotation'];
const PE_BLEND_MODES = ['overlay', 'none', 'multiply', 'screen', 'softlight', 'hardlight', 'difference'];

function peNewState() {
  return {
    elements: [],
    radar: {},
    vacuum: {},
    roomPositions: [], // [{ name, left, top }]
    dock: null, // [left, top] or null
    localUrl: peState && peState.localUrl ? peState.localUrl : null, // survives type re-renders
  };
}

const pictureElementsForm = {
  html: () => `
    <label>Floor-plan image path on the remote</label>
    <input type="text" id="optPeImage" placeholder="${PE_DEFAULT_IMAGE}">
    <label>Aspect ratio (width ÷ height — only used until the image has loaded)</label>
    <input type="number" id="optPeAspect" step="0.01" min="0.1" placeholder="${PE_DEFAULT_ASPECT}" oninput="peRenderCanvas()">
    <label>Local copy of the image (for positioning only — never uploaded, never saved in the JSON)</label>
    <input type="file" id="optPeLocalImage" accept="image/*" onchange="peLoadLocalImage(this)">
    <div class="btn-row" style="margin-top:6px">
      <button type="button" class="secondary" id="peUseRatioBtn" onclick="peUseImageRatio()" disabled>Use this image's ratio</button>
    </div>
    <div id="peCanvas" class="pe-canvas"></div>
    <div class="hint">Drag the markers to place them: <b>numbers</b> = elements, <b>R</b> = radar sensor origin, <b>room names</b> = vacuum room positions, <b>D</b> = vacuum dock. Positions are stored as % of the image, so the result matches the remote regardless of screen size. Upload the real image to the remote at the path above (e.g. from this device's page on port 8080).</div>

    <label style="margin-top:12px">Elements</label>
    <div id="peElementsList"></div>
    <button type="button" class="secondary" onclick="peAddElement()">+ Add element</button>
    <div class="hint"><b>Entity</b>: tap toggles it on the remote, the icon turns amber while it's on. <b>Service</b>: tap calls the service once per target entity (e.g. <code>light.turn_off</code> on several lights).</div>

    <label class="inline-check" style="margin-top:12px"><input type="checkbox" id="optPeRadarOn" onchange="peToggleSection('radar')"> Radar overlay (mmWave targets, e.g. LD2450)</label>
    <div id="peRadarBox" class="section-box" style="display:none">
      <label>Sensor prefix (reads &lt;prefix&gt;_1_x, &lt;prefix&gt;_1_y … )</label>
      <input type="text" id="optPeR_prefix" placeholder="e.g., sensor.living_room_radar_target">
      <div class="adv-grid">
        <div><label>Targets</label><input type="number" id="optPeR_targets" min="1" step="1" placeholder="3"></div>
        <div><label>Origin left %</label><input type="number" id="optPeR_origin_left" step="0.1" placeholder="50" oninput="peRenderCanvas()"></div>
        <div><label>Origin top %</label><input type="number" id="optPeR_origin_top" step="0.1" placeholder="10" oninput="peRenderCanvas()"></div>
        <div><label>Scale X (% per unit)</label><input type="number" id="optPeR_scale_x" step="any" placeholder="8"></div>
        <div><label>Scale Y (% per unit)</label><input type="number" id="optPeR_scale_y" step="any" placeholder="8"></div>
        <div><label>Scale X right side (blank = same)</label><input type="number" id="optPeR_scale_x_right" step="any" placeholder=""></div>
        <div><label>Left-side top offset %</label><input type="number" id="optPeR_top_offset_left" step="0.1" placeholder="0"></div>
        <div><label>Rotation (°)</label><input type="number" id="optPeR_rotation" step="1" placeholder="0"></div>
        <div><label>Blend mode</label><select id="optPeR_blend">${PE_BLEND_MODES.map(m => `<option value="${m}">${m}</option>`).join('')}</select></div>
      </div>
      <div class="hint-row">
        <label class="inline-check"><input type="checkbox" id="optPeR_flip_x"> Flip X</label>
        <label class="inline-check"><input type="checkbox" id="optPeR_flip_y"> Flip Y</label>
      </div>
      <div class="hint">A target is drawn at <code>origin + value × scale</code>. The unit of the scale depends on what your firmware reports (mm, cm or m). Calibrate by standing at a known spot: fix the origin first, then the scale, then rotation/flip. Missing or non-numeric target entities are simply not drawn.</div>
    </div>

    <label class="inline-check" style="margin-top:12px"><input type="checkbox" id="optPeVacOn" onchange="peToggleSection('vacuum')"> Vacuum overlay (robot icon placed by room, tap opens the vacuum panel)</label>
    <div id="peVacBox" class="section-box" style="display:none">
      ${haEntityFieldHtml('vacuum', 'optPeV_entity_id', 'Vacuum')}
      <label>Name (optional)</label><input type="text" id="optPeV_name" placeholder="e.g., Robot">
      <label>Map image entity (optional, shown in the popup)</label><input type="text" id="optPeV_map_image" placeholder="e.g., image.roborock_map">
      <div class="adv-grid">
        <div><label>Map rotation (°)</label><input type="number" id="optPeV_map_rotation" step="90" placeholder="0"></div>
        <div><label>Map height (px)</label><input type="number" id="optPeV_map_height" min="0" placeholder="200"></div>
      </div>
      <label>Current-room sensor (its state is matched against the room positions below)</label>
      <input type="text" id="optPeV_room_entity" placeholder="e.g., sensor.roborock_current_room">
      <label>Room positions on the floor plan</label>
      ${advListHtml('peRoomPositions')}
      <label class="inline-check"><input type="checkbox" id="optPeV_dock" onchange="peToggleDock()"> Dock position (marker <b>D</b>)</label>
      <label>Room-clean buttons in the popup</label>
      ${advListHtml('peVacRooms')}
      <label>Room-clean service (optional — defaults to Roborock/Xiaomi's <code>vacuum.send_command</code>)</label>
      <input type="text" id="optPeV_rca_domain" placeholder="Domain, e.g. dreame_vacuum">
      <input type="text" id="optPeV_rca_service" placeholder="Service, e.g. vacuum_clean_segment" style="margin-top:6px">
      <input type="text" id="optPeV_rca_parameter" placeholder="Field for the room ID, e.g. segments" style="margin-top:6px">
      <div class="hint">Home Assistant doesn't report the robot's X/Y, only its current room — so the icon jumps to that room's position, or to the dock while docked/charging. Room names must match the room sensor's states exactly. Room-clean fields: all three or none, same as the Vacuum card.</div>
    </div>
  `,
  init() {
    if (!peState) peState = peNewState();
    peInitLists();
    peRenderElements();
    peRenderCanvas();
    ['optPeV_room_entity', 'optPeV_map_image'].forEach(id => {
      const el = document.getElementById(id);
      const dom = id === 'optPeV_map_image' ? 'image' : 'sensor';
      if (el && typeof attachEntityAutocomplete === 'function') attachEntityAutocomplete(el, dom);
    });
  },
  fill(o) {
    peState = peNewState();
    document.getElementById('optPeImage').value = o.image || '';
    document.getElementById('optPeAspect').value = o.aspect ?? '';
    peState.elements = advClone(o.elements || []).map(el => ({
      ...el,
      // Form-only helper field, stripped again in build().
      _mode: el.entity_id || !el.service ? 'entity' : 'service',
      _targets: Array.isArray(el.targets) ? el.targets.join(', ') : '',
    }));

    // [S6.4] radar
    const radar = o.radar && typeof o.radar === 'object' ? advClone(o.radar) : null;
    peState.radar = radar || {};
    document.getElementById('optPeRadarOn').checked = !!radar;
    document.getElementById('optPeR_prefix').value = (radar && radar.prefix) || '';
    PE_RADAR_NUM_FIELDS.forEach(k => {
      document.getElementById('optPeR_' + k).value = radar && radar[k] != null ? radar[k] : '';
    });
    document.getElementById('optPeR_blend').value = PE_BLEND_MODES.includes(radar && radar.blend) ? radar.blend : 'overlay';
    document.getElementById('optPeR_flip_x').checked = !!(radar && radar.flip_x);
    document.getElementById('optPeR_flip_y').checked = !!(radar && radar.flip_y);

    // [S6.5] vacuum
    const vac = o.vacuum && typeof o.vacuum === 'object' ? advClone(o.vacuum) : null;
    peState.vacuum = vac || {};
    document.getElementById('optPeVacOn').checked = !!vac;
    setEntitySelectValue('optPeV_entity_id', vac && vac.entity_id);
    ['name', 'map_image', 'room_entity'].forEach(k => {
      document.getElementById('optPeV_' + k).value = (vac && vac[k]) || '';
    });
    ['map_rotation', 'map_height'].forEach(k => {
      document.getElementById('optPeV_' + k).value = vac && vac[k] != null ? vac[k] : '';
    });
    const pos = (vac && vac.room_positions) || {};
    peState.roomPositions = Object.keys(pos).map(name => ({ name, left: pos[name][0], top: pos[name][1] }));
    peState.dock = vac && Array.isArray(vac.dock_position) && vac.dock_position.length === 2 ? vac.dock_position.slice() : null;
    document.getElementById('optPeV_dock').checked = !!peState.dock;
    const rca = (vac && vac.room_clean_action) || {};
    document.getElementById('optPeV_rca_domain').value = rca.domain || '';
    document.getElementById('optPeV_rca_service').value = rca.service || '';
    document.getElementById('optPeV_rca_parameter').value = rca.parameter || '';

    peInitLists(vac ? vac.rooms || [] : []);
    peToggleSection('radar', true);
    peToggleSection('vacuum', true);
    peRenderElements();
    peRenderCanvas();
  },
  build() {
    const out = {};
    const image = advVal('optPeImage');
    if (image) out.image = image;
    const aspect = advNumOrNull('optPeAspect');
    if (aspect !== null && aspect > 0) out.aspect = aspect;

    // [S6.2] elements
    const elements = [];
    for (let i = 0; i < peState.elements.length; i++) {
      const el = peState.elements[i];
      const clean = advClone(el);
      delete clean._mode; delete clean._targets;
      if (el._mode === 'service') {
        delete clean.entity_id;
        clean.service = (el.service || '').trim();
        clean.targets = (el._targets || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!clean.service) { alert(`Element ${i + 1}: set a service (domain.service) or switch it to Entity.`); return null; }
        if (!clean.targets.length) delete clean.targets;
      } else {
        delete clean.service; delete clean.targets;
        clean.entity_id = (el.entity_id || '').trim();
        if (!clean.entity_id) { alert(`Element ${i + 1}: set an entity or remove the element.`); return null; }
      }
      clean.left = advRound(el.left ?? 50);
      clean.top = advRound(el.top ?? 50);
      if (el.icon === 'power') clean.icon = 'power'; else delete clean.icon;
      elements.push(clean);
    }
    out.elements = elements;

    // [S6.4] radar
    if (document.getElementById('optPeRadarOn').checked) {
      const radar = advClone(peState.radar || {});
      radar.prefix = advVal('optPeR_prefix');
      if (!radar.prefix) { alert('Radar overlay: set the sensor prefix, or turn the overlay off.'); return null; }
      PE_RADAR_NUM_FIELDS.forEach(k => {
        const v = advNumOrNull('optPeR_' + k);
        if (v === null || v === PE_RADAR_DEFAULTS[k]) delete radar[k]; else radar[k] = v;
      });
      const blend = document.getElementById('optPeR_blend').value;
      if (blend === PE_RADAR_DEFAULTS.blend) delete radar.blend; else radar.blend = blend;
      ['flip_x', 'flip_y'].forEach(k => {
        if (document.getElementById('optPeR_' + k).checked) radar[k] = true; else delete radar[k];
      });
      out.radar = radar;
    }

    // [S6.5] vacuum
    if (document.getElementById('optPeVacOn').checked) {
      const vac = advClone(peState.vacuum || {});
      vac.entity_id = advVal('optPeV_entity_id');
      if (!vac.entity_id) { alert('Vacuum overlay: pick the vacuum, or turn the overlay off.'); return null; }
      ['name', 'map_image', 'room_entity'].forEach(k => {
        const v = advVal('optPeV_' + k);
        if (v) vac[k] = v; else delete vac[k];
      });
      ['map_rotation', 'map_height'].forEach(k => {
        const v = advNumOrNull('optPeV_' + k);
        if (v === null) delete vac[k]; else vac[k] = v;
      });
      const rooms = advListItems('peVacRooms', 'name');
      if (rooms.some(r => typeof r.id !== 'number')) { alert('Vacuum overlay: every room-clean button needs a numeric segment ID.'); return null; }
      if (rooms.length) vac.rooms = rooms; else delete vac.rooms;
      const positions = {};
      ADV_LISTS.peRoomPositions.items.forEach(p => {
        const name = (p.name || '').trim();
        if (name) positions[name] = [advRound(p.left ?? 50), advRound(p.top ?? 50)];
      });
      if (Object.keys(positions).length) vac.room_positions = positions; else delete vac.room_positions;
      if (peState.dock) vac.dock_position = [advRound(peState.dock[0]), advRound(peState.dock[1])];
      else delete vac.dock_position;
      const d = advVal('optPeV_rca_domain'), s = advVal('optPeV_rca_service'), p = advVal('optPeV_rca_parameter');
      if (d || s || p) {
        if (!d || !s || !p) { alert('Vacuum overlay: fill in all three room-clean service fields, or leave all three blank.'); return null; }
        vac.room_clean_action = { domain: d, service: s, parameter: p };
      } else {
        delete vac.room_clean_action;
      }
      out.vacuum = vac;
    }
    return out;
  },
};

// Room positions and room-clean buttons use the generic list; positions also
// redraw the canvas on every change so their markers follow the typed name.
function peInitLists(rooms) {
  advListInit('peRoomPositions', [
    { key: 'name', label: 'Room name as the sensor reports it', kind: 'text', flex: 3 },
    { key: 'left', label: 'Left %', kind: 'number', step: '0.1', flex: 1 },
    { key: 'top', label: 'Top %', kind: 'number', step: '0.1', flex: 1 },
  ], peState.roomPositions, {
    addLabel: '+ Add room position',
    newItem: () => ({ name: '', left: 50, top: 50 }),
    onChange: () => peRenderCanvas(),
  });
  peState.roomPositions = ADV_LISTS.peRoomPositions.items; // same array from now on
  if (rooms !== undefined || !ADV_LISTS.peVacRooms) {
    advListInit('peVacRooms', [
      { key: 'name', label: 'Button label', kind: 'text', flex: 3 },
      { key: 'id', label: 'Segment ID', kind: 'number', step: '1', flex: 1 },
    ], rooms || [], { addLabel: '+ Add room-clean button' });
  }
}

function peToggleSection(which, silent) {
  const on = document.getElementById(which === 'radar' ? 'optPeRadarOn' : 'optPeVacOn').checked;
  document.getElementById(which === 'radar' ? 'peRadarBox' : 'peVacBox').style.display = on ? '' : 'none';
  if (!silent) peRenderCanvas();
}

function peToggleDock() {
  peState.dock = document.getElementById('optPeV_dock').checked ? [50, 90] : null;
  peRenderCanvas();
}

function peAddElement() {
  peState.elements.push({ _mode: 'entity', entity_id: '', left: 50, top: 50 });
  peRenderElements();
  peRenderCanvas();
}

function peRemoveElement(i) {
  peState.elements.splice(i, 1);
  peRenderElements();
  peRenderCanvas();
}

function peMoveElement(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= peState.elements.length) return;
  [peState.elements[i], peState.elements[j]] = [peState.elements[j], peState.elements[i]];
  peRenderElements();
  peRenderCanvas();
}

// Inline field edits — `key` is one of entity_id, service, _targets, icon,
// _mode, left, top.
function peSetElementField(i, key, value) {
  const el = peState.elements[i];
  if (!el) return;
  if (key === 'left' || key === 'top') {
    const n = Number(value);
    if (value !== '' && Number.isFinite(n)) el[key] = advClampPct(n);
    peRenderCanvas();
    return;
  }
  el[key] = value;
  if (key === '_mode') peRenderElements();
  if (key === '_mode' || key === 'icon') peRenderCanvas();
}

function peRenderElements() {
  const host = document.getElementById('peElementsList');
  if (!host || !peState) return;
  host.innerHTML = peState.elements.length ? peState.elements.map((el, i) => {
    const isService = el._mode === 'service';
    const target = isService
      ? `<input type="text" style="flex:2; min-width:0" placeholder="domain.service" value="${advEsc(el.service)}" oninput="peSetElementField(${i}, 'service', this.value)">
         <input type="text" style="flex:3; min-width:0" placeholder="targets: light.a, light.b" value="${advEsc(el._targets)}" oninput="peSetElementField(${i}, '_targets', this.value)">`
      : `<input type="text" class="pe-entity" data-i="${i}" style="flex:5; min-width:0" placeholder="entity_id (light.*, switch.*…)" value="${advEsc(el.entity_id)}" oninput="peSetElementField(${i}, 'entity_id', this.value)">`;
    return `<div class="list-item adv-list-row">
      <span class="adv-list-idx">${i + 1}</span>
      <select style="flex:0 0 92px" onchange="peSetElementField(${i}, '_mode', this.value)">
        <option value="entity"${isService ? '' : ' selected'}>Entity</option>
        <option value="service"${isService ? ' selected' : ''}>Service</option>
      </select>
      ${target}
      <select style="flex:0 0 78px" onchange="peSetElementField(${i}, 'icon', this.value)">
        <option value="bulb"${el.icon === 'power' ? '' : ' selected'}>Bulb</option>
        <option value="power"${el.icon === 'power' ? ' selected' : ''}>Power</option>
      </select>
      <input type="number" id="peEl_left_${i}" style="flex:0 0 64px" step="0.1" min="0" max="100" title="Left %" value="${advEsc(el.left ?? 50)}" oninput="peSetElementField(${i}, 'left', this.value)">
      <input type="number" id="peEl_top_${i}" style="flex:0 0 64px" step="0.1" min="0" max="100" title="Top %" value="${advEsc(el.top ?? 50)}" oninput="peSetElementField(${i}, 'top', this.value)">
      <span class="adv-list-btn" title="Move up" onclick="peMoveElement(${i}, -1)">↑</span>
      <span class="adv-list-btn" title="Move down" onclick="peMoveElement(${i}, 1)">↓</span>
      <span class="remove" title="Remove" onclick="peRemoveElement(${i})">✕</span>
    </div>`;
  }).join('') : '<div class="hint">No elements yet.</div>';
  host.querySelectorAll('input.pe-entity').forEach(el => {
    if (typeof attachEntityAutocomplete === 'function') attachEntityAutocomplete(el, null);
  });
}

// [S6.1] local image — an object URL, only ever used as the canvas background.
function peLoadLocalImage(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (peState.localUrl) URL.revokeObjectURL(peState.localUrl);
  peState.localUrl = URL.createObjectURL(file);
  peState.localRatio = null;
  const img = new Image();
  img.onload = () => {
    peState.localRatio = img.naturalWidth / img.naturalHeight;
    const btn = document.getElementById('peUseRatioBtn');
    if (btn) btn.disabled = false;
    peRenderCanvas();
  };
  img.src = peState.localUrl;
}

function peUseImageRatio() {
  if (!peState || !peState.localRatio) return;
  document.getElementById('optPeAspect').value = Math.round(peState.localRatio * 1000) / 1000;
  peRenderCanvas();
}

// [S6.3] Every draggable marker: { kind, i, label, left, top, cls }.
function peMarkers() {
  const list = peState.elements.map((el, i) => ({
    kind: 'element', i, label: String(i + 1), left: el.left ?? 50, top: el.top ?? 50,
    cls: el.icon === 'power' ? 'pe-m-power' : 'pe-m-bulb',
  }));
  if (document.getElementById('optPeRadarOn')?.checked) {
    list.push({
      kind: 'radar', i: 0, label: 'R', cls: 'pe-m-radar',
      left: advNumOrNull('optPeR_origin_left') ?? PE_RADAR_DEFAULTS.origin_left,
      top: advNumOrNull('optPeR_origin_top') ?? PE_RADAR_DEFAULTS.origin_top,
    });
  }
  if (document.getElementById('optPeVacOn')?.checked) {
    (ADV_LISTS.peRoomPositions ? ADV_LISTS.peRoomPositions.items : []).forEach((p, i) => list.push({
      kind: 'room', i, label: p.name || `room ${i + 1}`, left: p.left ?? 50, top: p.top ?? 50, cls: 'pe-m-room',
    }));
    if (peState.dock) list.push({ kind: 'dock', i: 0, label: 'D', left: peState.dock[0], top: peState.dock[1], cls: 'pe-m-dock' });
  }
  return list;
}

function peRenderCanvas() {
  const canvas = document.getElementById('peCanvas');
  if (!canvas || !peState) return;
  const aspect = peState.localRatio || advNumOrNull('optPeAspect') || PE_DEFAULT_ASPECT;
  canvas.style.aspectRatio = String(aspect);
  canvas.style.backgroundImage = peState.localUrl ? `url("${peState.localUrl}")` : '';
  canvas.classList.toggle('pe-canvas-empty', !peState.localUrl);
  canvas.innerHTML = '';
  peMarkers().forEach(m => {
    const el = document.createElement('div');
    el.className = `pe-marker ${m.cls}`;
    el.textContent = m.label;
    el.title = `${m.kind} — drag to move (${advRound(m.left)}%, ${advRound(m.top)}%)`;
    el.style.left = m.left + '%';
    el.style.top = m.top + '%';
    el.addEventListener('pointerdown', ev => peStartDrag(ev, m, el, canvas));
    canvas.appendChild(el);
  });
}

// Pointer-event drag (mouse + touch). Writes positions back into state and
// the matching numeric inputs while dragging; redraws once on release.
function peStartDrag(ev, marker, el, canvas) {
  ev.preventDefault();
  if (el.setPointerCapture) el.setPointerCapture(ev.pointerId);
  const move = e => {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const left = advRound(advClampPct(((e.clientX - r.left) / r.width) * 100));
    const top = advRound(advClampPct(((e.clientY - r.top) / r.height) * 100));
    peSetMarkerPos(marker, left, top);
    el.style.left = left + '%';
    el.style.top = top + '%';
  };
  const up = () => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    if (marker.kind === 'room') advListRender('peRoomPositions');
    peRenderCanvas();
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

function peSetMarkerPos(marker, left, top) {
  if (marker.kind === 'element') {
    const it = peState.elements[marker.i];
    it.left = left; it.top = top;
    const l = document.getElementById(`peEl_left_${marker.i}`);
    const t = document.getElementById(`peEl_top_${marker.i}`);
    if (l) l.value = left;
    if (t) t.value = top;
  } else if (marker.kind === 'radar') {
    document.getElementById('optPeR_origin_left').value = left;
    document.getElementById('optPeR_origin_top').value = top;
  } else if (marker.kind === 'room') {
    const it = ADV_LISTS.peRoomPositions.items[marker.i];
    it.left = left; it.top = top;
  } else if (marker.kind === 'dock') {
    peState.dock = [left, top];
  }
}

// ---- [S7] title / subtitle tap actions ---------------------------------------

const TITLE_ACTION_KINDS = [
  { value: '', label: 'None' },
  { value: 'entity', label: 'Activate a scene / script (Home Assistant)' },
  { value: 'harmonyActivity', label: 'Start a Harmony activity' },
  { value: 'harmonyCommand', label: 'Send a Harmony device command' },
  { value: 'ir', label: 'Send a local IR command' },
  { value: 'activity', label: 'Start a composed Activity' },
];

// Datalist sources shared by both blocks — rendered once per form.
function titleActionDatalistsHtml() {
  const pages = (dashboardData.pages || []).map(p => p.name).filter(Boolean);
  const acts = (dashboardData.activities || []).map(a => a.id).filter(Boolean);
  const irs = (dashboardData.irDevices || []).map(d => d.id).filter(Boolean);
  const dl = (id, vals) => `<datalist id="${id}">${vals.map(v => `<option value="${advEsc(v)}">`).join('')}</datalist>`;
  return dl('taPagesList', pages) + dl('taActivitiesList', acts) + dl('taIrDevicesList', irs);
}

function titleActionBlockHtml(prefix, heading) {
  const id = k => `optTA_${prefix}${k}`;
  return `
    <div class="section-box" style="margin-top:10px">
      <label>${heading}</label>
      <select id="${id('kind')}" onchange="titleActionKindChange('${prefix}')">
        ${TITLE_ACTION_KINDS.map(k => `<option value="${k.value}">${k.label}</option>`).join('')}
      </select>
      <div id="${id('f_entity')}" style="display:none">
        <label>Scene or script entity</label><input type="text" id="${id('entity_id')}" placeholder="e.g., scene.movie_night">
      </div>
      <div id="${id('f_harmonyActivity')}" style="display:none">
        <label>Harmony activity ID (PowerOff = -1)</label><input type="text" id="${id('activityId')}" placeholder="e.g., 39568252">
      </div>
      <div id="${id('f_harmonyCommand')}" style="display:none">
        <label>Harmony device ID</label><input type="text" id="${id('harmonyDevice')}" placeholder="e.g., 62846050">
        <label>Harmony command</label><input type="text" id="${id('harmonyCommand')}" placeholder="e.g., PowerToggle">
      </div>
      <div id="${id('f_hub')}" style="display:none">
        <label>Harmony hub (optional — local ID; blank = first configured hub)</label><input type="text" id="${id('hub')}" placeholder="e.g., hub_12345">
      </div>
      <div id="${id('f_ir')}" style="display:none">
        <label>IR device</label><input type="text" id="${id('irDevice')}" list="taIrDevicesList" placeholder="IR device id">
        <label>IR command</label><input type="text" id="${id('irCommand')}" placeholder="e.g., power">
      </div>
      <div id="${id('f_activity')}" style="display:none">
        <label>Composed Activity ID</label><input type="text" id="${id('activity')}" list="taActivitiesList" placeholder="Activity id">
      </div>
      <label>Also open page (optional)</label>
      <input type="text" id="${id('page')}" list="taPagesList" placeholder="Page name">
      <div class="hint" id="${id('pageHint')}" style="display:none">Ignored with a composed Activity — the app opens the Activity's own page once it's running.</div>
    </div>`;
}

// Everything the title form appends: both blocks + their datalists.
function titleActionFieldsHtml() {
  return titleActionDatalistsHtml()
    + titleActionBlockHtml('title_', 'Title tap action (optional)')
    + titleActionBlockHtml('subtitle_', 'Subtitle tap action (optional)');
}

function titleActionKindChange(prefix) {
  const id = k => `optTA_${prefix}${k}`;
  const kind = document.getElementById(id('kind')).value;
  ['entity', 'harmonyActivity', 'harmonyCommand', 'ir', 'activity'].forEach(k => {
    document.getElementById(id('f_' + k)).style.display = kind === k ? '' : 'none';
  });
  document.getElementById(id('f_hub')).style.display =
    (kind === 'harmonyActivity' || kind === 'harmonyCommand') ? '' : 'none';
  const pageEl = document.getElementById(id('page'));
  pageEl.disabled = kind === 'activity';
  document.getElementById(id('pageHint')).style.display = kind === 'activity' ? '' : 'none';
  const ent = document.getElementById(id('entity_id'));
  if (ent && typeof attachEntityAutocomplete === 'function' && !ent.dataset.acAttached) {
    attachEntityAutocomplete(ent, ['scene', 'script']);
    ent.dataset.acAttached = '1';
  }
}

function fillTitleActions(o) {
  ['title_', 'subtitle_'].forEach(prefix => {
    const id = k => `optTA_${prefix}${k}`;
    const v = k => o[prefix + k];
    // Detection order per [S7].
    const kind = v('activity') ? 'activity'
      : v('activityId') ? 'harmonyActivity'
      : (v('harmonyDevice') || v('harmonyCommand')) ? 'harmonyCommand'
      : (v('irDevice') || v('irCommand')) ? 'ir'
      : v('entity_id') ? 'entity' : '';
    document.getElementById(id('kind')).value = kind;
    TITLE_ACTION_SUFFIXES.forEach(s => {
      const el = document.getElementById(id(s));
      if (el) el.value = v(s) != null ? String(v(s)) : '';
    });
    titleActionKindChange(prefix);
  });
}

// Returns the title_*/subtitle_* keys to merge into the card, or null (after
// an alert) when a chosen action is incomplete.
function buildTitleActions() {
  const out = {};
  for (const prefix of ['title_', 'subtitle_']) {
    const id = k => `optTA_${prefix}${k}`;
    const val = k => advVal(id(k));
    const kind = document.getElementById(id('kind')).value;
    const where = prefix === 'title_' ? 'Title' : 'Subtitle';
    const need = (keys) => {
      const missing = keys.filter(k => !val(k));
      if (missing.length) { alert(`${where} tap action: fill in ${missing.join(' and ')}.`); return false; }
      keys.forEach(k => { out[prefix + k] = val(k); });
      return true;
    };
    if (kind === 'entity' && !need(['entity_id'])) return null;
    if (kind === 'harmonyActivity' && !need(['activityId'])) return null;
    if (kind === 'harmonyCommand' && !need(['harmonyDevice', 'harmonyCommand'])) return null;
    if (kind === 'ir' && !need(['irDevice', 'irCommand'])) return null;
    if (kind === 'activity' && !need(['activity'])) return null;
    if ((kind === 'harmonyActivity' || kind === 'harmonyCommand') && val('hub')) out[prefix + 'hub'] = val('hub');
    if (kind !== 'activity' && val('page')) out[prefix + 'page'] = val('page');
  }
  return out;
}

// ---- Dispatch table used by cards.js ----------------------------------------

const ADV_FORMS = {
  speaker_group: speakerGroupForm,
  monitor: monitorForm,
  row: rowForm,
  picture_elements: pictureElementsForm,
};

// ---- [S8] Preview renderers ----------------------------------------------------

function advPreviewTitleBar(label, idx) {
  return `<div class="card-title"><span>${advEsc(label)}</span><span><span class="remove" style="color:#00E5FF" onclick="editCard(${idx})">✎</span> <span class="remove" onclick="removeCard(${idx})">✕</span></span></div>`;
}

function advPreviewEntityName(entityId, fallback) {
  return fallback || (typeof haFriendlyName === 'function' && haFriendlyName(entityId))
    || (typeof prettyEntityName === 'function' && entityId ? prettyEntityName(entityId) : entityId) || '—';
}

// Returns the full card markup, or null for types this file doesn't render.
function advPreviewHtml(card, idx) {
  const o = card.options || {};
  if (card.type === 'speaker_group') {
    const rows = [{ entity_id: o.master, name: o.name, master: true }, ...(o.speakers || [])];
    const body = rows.map(sp => {
      const members = (typeof haEntity === 'function' && haEntity(sp.entity_id)?.attributes?.group_members) || null;
      const grouped = sp.master || (Array.isArray(members) && members.includes(o.master));
      const vol = typeof haAttrNum === 'function' ? haAttrNum(sp.entity_id, 'volume_level') : null;
      const pct = Math.round((vol ?? 0.3) * 100);
      return `<div class="adv-pv-row">
        <span class="adv-pv-check">${grouped ? '☑' : '☐'}</span>
        <span class="adv-pv-name">${advEsc(advPreviewEntityName(sp.entity_id, sp.name))}${sp.master ? ' <small>(master)</small>' : ''}</span>
        <span class="adv-pv-bar"><span style="width:${pct}%"></span></span>
        <span class="adv-pv-btns">🔇 − +</span>
      </div>`;
    }).join('');
    return `<div class="card">${advPreviewTitleBar(`speaker_group (${rows.length} speakers)`, idx)}${body}
      <div class="hint" style="margin-top:6px">Master: ${advEsc(o.master || '(not set)')} · group ticks ${haStates ? 'from live group_members' : 'are example data'}</div></div>`;
  }
  if (card.type === 'monitor') {
    const body = (o.entities || []).map(e => {
      const st = typeof haEntity === 'function' ? haEntity(e.entity_id) : null;
      const bad = !st || st.state === 'unknown' || st.state === 'unavailable';
      const unit = typeof haAttrStr === 'function' ? haAttrStr(e.entity_id, 'unit_of_measurement') : null;
      return `<div class="adv-pv-row"><span class="adv-pv-name">${advEsc(advPreviewEntityName(e.entity_id, e.name))}</span>
        <span class="adv-pv-val">${bad ? '—' : advEsc(st.state + (unit ? ' ' + unit : ''))}</span></div>`;
    }).join('');
    return `<div class="card">${advPreviewTitleBar('monitor', idx)}
      ${o.title ? `<div class="pc-name" style="margin-bottom:6px">${advEsc(o.title)}</div>` : ''}${body}</div>`;
  }
  if (card.type === 'row') {
    const kids = (o.cards || []).map(c => `<div class="adv-pv-child"><b>${advEsc(c.type)}</b><br><small>${advEsc(advCardLabel(c))}</small></div>`).join('');
    return `<div class="card">${advPreviewTitleBar(`row (${(o.cards || []).length} cards)`, idx)}<div class="adv-pv-rowbox">${kids}</div></div>`;
  }
  if (card.type === 'picture_elements') {
    const aspect = Number(o.aspect) > 0 ? Number(o.aspect) : PE_DEFAULT_ASPECT;
    const dot = (l, t, content, cls) => `<div class="adv-pv-dot ${cls}" style="left:${l}%; top:${t}%">${content}</div>`;
    let dots = (o.elements || []).map(el => {
      const on = typeof haEntity === 'function' && haEntity(el.entity_id)?.state === 'on';
      const icon = el.icon === 'power' ? MDI.power : (on ? MDI.lightbulbOn : MDI.lightbulbOff);
      return dot(el.left ?? 50, el.top ?? 50, mdiSvg(icon), on ? 'on' : '');
    }).join('');
    if (o.radar) dots += dot(o.radar.origin_left ?? 50, o.radar.origin_top ?? 10, 'R', 'radar');
    if (o.vacuum && Array.isArray(o.vacuum.dock_position)) dots += dot(o.vacuum.dock_position[0], o.vacuum.dock_position[1], 'D', 'dock');
    return `<div class="card">${advPreviewTitleBar(`picture_elements (${(o.elements || []).length} elements)`, idx)}
      <div class="adv-pv-plan" style="aspect-ratio:${aspect}">${dots}</div>
      <div class="hint" style="margin-top:6px">Image on the remote: ${advEsc(o.image || PE_DEFAULT_IMAGE)}${o.radar ? ' · radar overlay' : ''}${o.vacuum ? ' · vacuum overlay' : ''}</div></div>`;
  }
  return null;
}
