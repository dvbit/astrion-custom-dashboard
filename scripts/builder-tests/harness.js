// Headless harness for the web builder — [S11] docs/EDITOR_FORMS_SPEC.md
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs'); const path = require('path');
const DOCS = path.join(__dirname, '../../app/src/main/assets/docs');
async function load() {
  let html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  // inline scripts so load order is deterministic
  html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, src) =>
    `<script>${fs.readFileSync(path.join(DOCS, src), 'utf8')}\n//# sourceURL=${src}</script>`);
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e.stack || e)));
  vc.on('error', e => errors.push('console.error ' + e));
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/builder/', virtualConsole: vc,
    beforeParse(w) {
      w.fetch = () => Promise.reject(new Error('offline'));
      w.alert = m => { w.__alerts.push(m); }; w.__alerts = [];
      w.confirm = () => true;
      w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
    } });
  await new Promise(r => setTimeout(r, 50));
  return { w: dom.window, errors };
}
module.exports = { load };
