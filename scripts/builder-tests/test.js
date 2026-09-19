// [S11] verification suite — docs/EDITOR_FORMS_SPEC.md
const { load } = require('./harness');
const fs = require('fs'); const path = require('path');

// Every quoted identifier in the Kotlin sources that read dashboard.json —
// the "is this key read by the app" oracle for the last test.
function kotlinKeys() {
  const root = path.join(__dirname, '../../app/src/main/java/com/custom/astrion');
  const files = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e =>
    e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.kt') && files.push(path.join(d, e.name)));
  walk(path.join(root, 'cards'));
  files.push(path.join(root, 'config/DashboardLoader.kt'), path.join(root, 'ui/Dashboard.kt'));
  const keys = [];
  files.forEach(f => (fs.readFileSync(f, 'utf8').match(/"[a-zA-Z_]+"/g) || []).forEach(k => keys.push(k.slice(1, -1))));
  return keys;
}
const assert = require('assert');
const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.keys(x).sort().reduce((o, key) => (o[key] = x[key], o), {}) : x);
let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('PASS', name); }
  catch (e) { fail++; console.log('FAIL', name, '\n   ', e.message.split('\n').slice(0, 6).join('\n    ')); }
}
(async () => {
  const { w, errors } = await load();
  const E = s => w.eval(s);
  const $ = id => w.document.getElementById(id);
  const data = () => E('dashboardData');
  const cards = () => data().pages[E('currentActivePage')].cards;
  const reset = () => { E(`dashboardData.pages = [{name:'Home',cards:[]},{name:'Luci',cards:[]}];
    dashboardData.haDevices = [{domain:'media_player',entityId:'media_player.salotto',name:'Salotto'},
      {domain:'media_player',entityId:'media_player.cucina',name:'Cucina'},
      {domain:'vacuum',entityId:'vacuum.robot',name:'Robot'}];
    dashboardData.activities = []; currentActivePage = 0; cardEditStack = [];`); w.__alerts.length = 0; };
  const roundTrip = card => { reset(); cards().push(JSON.parse(JSON.stringify(card)));
    E('openCardDialog(0)'); E('addCardToPage()'); return JSON.parse(JSON.stringify(cards()[0])); };
  const typeIn = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); el.dispatchEvent(new w.Event('change', { bubbles: true })); };

  const SG = { type: 'speaker_group', options: { master: 'media_player.salotto', name: 'Salotto', pin: 'bottom',
    speakers: [{ entity_id: 'media_player.cucina', name: 'Cucina', extra: 1 }, { entity_id: 'media_player.bagno' }] } };
  const MON = { type: 'monitor', options: { title: 'Env', entities: [{ entity_id: 'sensor.t', name: 'T' }, { entity_id: 'sensor.h' }] } };
  const PE = { type: 'picture_elements', options: { image: '/sdcard/astrion/p.png', aspect: 1.5, custom_x: true,
    elements: [{ entity_id: 'light.a', left: 25, top: 35 }, { service: 'light.turn_off', targets: ['light.a', 'light.b'], icon: 'power', left: 95, top: 6, note: 'keep' }],
    radar: { prefix: 'sensor.r_target', targets: 2, origin_left: 40, scale_x: 10, flip_y: true, blend: 'screen', future: 7 },
    vacuum: { entity_id: 'vacuum.robot', name: 'Robot', map_image: 'image.m', rooms: [{ name: 'Cucina', id: 16 }],
      room_entity: 'sensor.room', room_positions: { Cucina: [70, 30], Soggiorno: [25, 40] }, dock_position: [5, 60],
      room_clean_action: { domain: 'dreame_vacuum', service: 'vacuum_clean_segment', parameter: 'segments' } } } };
  const ROW = { type: 'row', options: { pin: 'bottom', cards: [
    { type: 'switch', options: { entity_id: 'switch.a', name: 'A', pin: 'x' } },
    { type: 'monitor', options: { entities: [{ entity_id: 'sensor.t' }] } }] } };
  const TITLE = { type: 'title', options: { title: 'Soggiorno', subtitle: 'Vedi →', subtitle_page: 'Luci',
    title_activityId: '123', title_hub: 'hub_1', title_page: 'Home' } };

  await t('load: no JS errors besides offline dashboard fetch', () =>
    assert.deepStrictEqual(errors.filter(e => !/Failed to load dashboard.json/.test(e)), []));

  for (const [n, c] of [['speaker_group', SG], ['monitor', MON], ['picture_elements', PE], ['row', ROW], ['title actions', TITLE]]) {
    await t(`[S2] round trip identical: ${n}`, () => {
      const out = roundTrip(c); assert.strictEqual(canon(out), canon(c)); assert.deepStrictEqual(w.__alerts, []);
      const out2 = roundTrip(out); assert.strictEqual(canon(out2), canon(c));
    });
  }

  await t('[S3] new speaker_group via form', () => {
    reset(); E('openCardDialog(null)'); const sel = $('cardTypeSelect'); sel.value = 'speaker_group'; E('updateCardFormInputs()');
    E('addCardToPage()'); assert.match(w.__alerts[0], /master/); assert.strictEqual(cards().length, 0);
    $('optSgMaster').value = 'media_player.salotto';
    E("advListAdd('sgSpeakers')"); E("advListAdd('sgSpeakers')");
    const rows = w.document.querySelectorAll('#sgSpeakers [data-key="entity_id"]');
    assert.strictEqual(rows[0].tagName, 'SELECT'); // catalog picker [S3]
    typeIn(rows[0], 'media_player.cucina');
    E('addCardToPage()');
    assert.strictEqual(canon(cards()[0]), canon({ type: 'speaker_group', options: { master: 'media_player.salotto', speakers: [{ entity_id: 'media_player.cucina' }] } }));
  });

  await t('[S4] monitor requires an entity; free-text entity inputs', () => {
    reset(); E('openCardDialog(null)'); $('cardTypeSelect').value = 'monitor'; E('updateCardFormInputs()');
    const inp = w.document.querySelector('#monEntities input[data-key="entity_id"]'); assert.ok(inp);
    E('addCardToPage()'); assert.match(w.__alerts[0], /at least one/);
    typeIn(inp, ' sensor.x '); E("advListMove('monEntities',0,1)"); E('addCardToPage()');
    assert.strictEqual(canon(cards()[0].options), canon({ entities: [{ entity_id: 'sensor.x' }] }));
  });

  await t('[S5] row child edit/cancel/nesting keeps page untouched until row saved', () => {
    reset(); cards().push(JSON.parse(JSON.stringify(ROW))); E('openCardDialog(0)');
    E('rowEditChild(0)');
    assert.strictEqual($('cardTypeSelect').value, 'switch'); assert.match($('cardEditorTitle').textContent, /inside row/);
    $('optName').value = 'B'; E('addCardToPage()');                       // save child → back to row
    assert.strictEqual($('cardTypeSelect').value, 'row');
    assert.strictEqual(cards()[0].options.cards[0].options.name, 'A');    // page untouched yet
    E('rowEditChild(null)'); $('cardTypeSelect').value = 'row'; E('updateCardFormInputs()');
    E('rowEditChild(null)'); $('cardTypeSelect').value = 'monitor'; E('updateCardFormInputs()');   // grandchild
    typeIn(w.document.querySelector('#monEntities input[data-key="entity_id"]'), 'sensor.deep');
    E('addCardToPage()');                                                  // grandchild → nested row
    assert.strictEqual(E('cardEditStack.length'), 1);
    E('rowEditChild(null)'); E('cancelCardEdit()');                        // cancel a new child
    assert.strictEqual(E('cardEditStack.length'), 1);
    E('addCardToPage()');                                                  // nested row → outer row
    assert.strictEqual(E('cardEditStack.length'), 0);
    E('addCardToPage()');                                                  // outer row → page
    const o = cards()[0].options;
    assert.strictEqual(o.pin, 'bottom');
    assert.strictEqual(o.cards[0].options.name, 'B'); assert.strictEqual(o.cards[0].options.pin, 'x'); // [S2] child
    assert.strictEqual(o.cards.length, 3);
    assert.strictEqual(canon(o.cards[2]), canon({ type: 'row', options: { cards: [{ type: 'monitor', options: { entities: [{ entity_id: 'sensor.deep' }] } }] } }));
    assert.ok(!$('cardEditorModal').classList.contains('open'));
  });

  await t('[S5] close while in child returns to row, second close exits', () => {
    reset(); cards().push(JSON.parse(JSON.stringify(ROW))); E('openCardDialog(0)'); E('rowEditChild(1)');
    E('cancelCardEdit()'); assert.strictEqual($('cardTypeSelect').value, 'row');
    assert.ok($('cardEditorModal').classList.contains('open'));
    E('cancelCardEdit()'); assert.ok(!$('cardEditorModal').classList.contains('open'));
    assert.strictEqual(canon(cards()[0]), canon(ROW));
  });

  await t('[S6] drag updates element/radar/room/dock; defaults dropped', () => {
    reset(); cards().push(JSON.parse(JSON.stringify(PE))); E('openCardDialog(0)');
    const markers = w.document.querySelectorAll('#peCanvas .pe-marker');
    assert.strictEqual(markers.length, 2 + 1 + 2 + 1);
    E("peSetMarkerPos({kind:'element',i:0},12.34,56.78)");
    E("peSetMarkerPos({kind:'radar',i:0},50,10)");
    E("peSetMarkerPos({kind:'room',i:1},11,22)");
    E("peSetMarkerPos({kind:'dock',i:0},1,2)");
    assert.strictEqual($('peEl_left_0').value, '12.34');
    $('optPeR_targets').value = '3';
    E('addCardToPage()');
    const o = cards()[0].options;
    assert.deepStrictEqual([o.elements[0].left, o.elements[0].top], [12.3, 56.8]);
    assert.ok(!('origin_left' in o.radar) && !('origin_top' in o.radar) && !('targets' in o.radar));
    assert.strictEqual(o.radar.future, 7);
    assert.strictEqual(JSON.stringify(o.vacuum.room_positions.Soggiorno), '[11,22]');
    assert.strictEqual(JSON.stringify(o.vacuum.dock_position), '[1,2]');
    assert.strictEqual(o.elements[1].note, 'keep');
  });

  await t('[S6] overlays off → keys removed; validation alerts', () => {
    reset(); cards().push(JSON.parse(JSON.stringify(PE))); E('openCardDialog(0)');
    $('optPeRadarOn').checked = false; $('optPeVacOn').checked = false; E('addCardToPage()');
    assert.ok(!('radar' in cards()[0].options) && !('vacuum' in cards()[0].options));
    reset(); E('openCardDialog(null)'); $('cardTypeSelect').value = 'picture_elements'; E('updateCardFormInputs()');
    E('peAddElement()'); E('addCardToPage()'); assert.match(w.__alerts[0], /Element 1/);
    E("peSetElementField(0,'entity_id','light.z')"); $('optPeRadarOn').checked = true; E('addCardToPage()');
    assert.match(w.__alerts[1], /prefix/);
    $('optPeRadarOn').checked = false; E('addCardToPage()');
    assert.strictEqual(canon(cards()[0]), canon({ type: 'picture_elements', options: { elements: [{ entity_id: 'light.z', left: 50, top: 50 }] } }));
  });

  await t('[S7] title action validation + page disabled with composed activity', () => {
    reset(); E('openCardDialog(null)'); $('cardTypeSelect').value = 'title'; E('updateCardFormInputs()');
    $('optTitle').value = 'X'; $('optTA_title_kind').value = 'ir'; E("titleActionKindChange('title_')");
    E('addCardToPage()'); assert.match(w.__alerts[0], /irDevice and irCommand/);
    $('optTA_title_kind').value = 'activity'; E("titleActionKindChange('title_')");
    assert.ok($('optTA_title_page').disabled);
    $('optTA_title_activity').value = 'salon_tv'; $('optTA_title_page').value = 'Luci';
    E('addCardToPage()');
    assert.strictEqual(canon(cards()[0].options), canon({ title: 'X', title_activity: 'salon_tv' }));
  });

  await t('[S2] existing forms keep unmodeled keys (pin, layout, step, commands)', () => {
    const sg = roundTrip({ type: 'scene_grid', options: { layout: 'row', pin: 'bottom', scenes: [{ entity_id: 'scene.a', name: 'A' }] } });
    assert.strictEqual(sg.options.layout, 'row'); assert.strictEqual(sg.options.pin, 'bottom');
    const cl = roundTrip({ type: 'climate', options: { entity_id: 'climate.a', step: 0.5 } });
    assert.strictEqual(cl.options.step, 0.5);
    const tv = roundTrip({ type: 'tv_remote', options: { remote_entity: 'remote.tv', commands: { up: 'UP' } } });
    assert.deepStrictEqual(tv.options.commands, { up: 'UP' });
    // a managed key cleared in the form must NOT come back
    reset(); cards().push({ type: 'title', options: { title: 'T', color: '#123456' } }); E('openCardDialog(0)');
    $('optTitleColor').value = ''; E('addCardToPage()'); assert.ok(!('color' in cards()[0].options));
    // type change starts clean
    reset(); cards().push({ type: 'monitor', options: { title: 'T', entities: [{ entity_id: 's.a' }], pin: 'bottom' } }); E('openCardDialog(0)');
    $('cardTypeSelect').value = 'row'; E('updateCardFormInputs()'); E('rowEditChild(null)'); $('cardTypeSelect').value='monitor'; E('updateCardFormInputs()');
    typeIn(w.document.querySelector('#monEntities input[data-key="entity_id"]'), 's.b'); E('addCardToPage()'); E('addCardToPage()');
    assert.ok(!('pin' in cards()[0].options)); assert.strictEqual(cards()[0].type, 'row');
  });

  await t('[S8] preview renders the four types without errors', () => {
    reset(); [SG, MON, PE, ROW].forEach(c => cards().push(JSON.parse(JSON.stringify(c))));
    const before = errors.length; E('renderPreview()');
    const html = $('content').innerHTML;
    assert.strictEqual(errors.length, before);
    for (const s of ['speaker_group (3 speakers)', 'Env', 'picture_elements (2 elements)', 'row (2 cards)', 'adv-pv-dot', '(master)']) assert.ok(html.includes(s), s);
  });

  await t('[S11] every key written by the new forms is read by the app (Kotlin)', () => {
    const kotlin = new Set(kotlinKeys());
    const walk = (o, acc) => { if (Array.isArray(o)) o.forEach(x => walk(x, acc)); else if (o && typeof o === 'object') Object.entries(o).forEach(([k, v]) => { acc.add(k); walk(v, acc); }); return acc; };
    const keys = walk([SG, MON, PE, ROW, TITLE].map(c => roundTrip(c).options), new Set());
    const test = new Set(['pin', 'extra', 'custom_x', 'note', 'future', 'Cucina', 'Soggiorno', 'x']); // fixtures / map keys
    // TitleCard.kt builds title_/subtitle_ keys as prefix + scene_grid action name
    const unknown = [...keys].map(k => k.replace(/^(sub)?title_/, "")).filter(k => !kotlin.has(k) && !test.has(k));
    assert.deepStrictEqual(unknown, []);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
