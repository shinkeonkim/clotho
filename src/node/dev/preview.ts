// The built-in preview page.
//
// The proposal's conclusion was to serve the editor rather than build a second UI,
// and that remains the goal — but hosting it means taking `@kokoa/clotho-editor` as
// an optional dependency, pinning its version and deciding when to install it, which
// is a cross-repository decision rather than a detail of this command.
//
// So this is the fallback, and it is deliberately not an editor: a list, a player,
// and the findings. It exists to close the file-based loop today — save in your own
// editor, see the result and the verdict without switching to a terminal.

/** The page, as one self-contained string. No build step, no bundler, no npm install. */
export function previewPage(label: string, importMap: Record<string, string> = {}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>clotho dev — ${escapeHtml(label)}</title>
<link rel="stylesheet" href="/_clotho/clotho.css">
<script type="importmap">${JSON.stringify({ imports: importMap })}</script>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font: 14px/1.5 system-ui, sans-serif; display: grid; grid-template-columns: 260px 1fr; height: 100vh; }
  aside { border-right: 1px solid #8883; overflow: auto; padding: 12px; }
  main { overflow: auto; padding: 20px; }
  h1 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; opacity: .6; margin: 0 0 12px; }
  ul { list-style: none; margin: 0; padding: 0; }
  li button { width: 100%; text-align: left; font: inherit; background: none; border: 0; padding: 7px 8px; border-radius: 6px; cursor: pointer; color: inherit; display: flex; gap: 8px; align-items: baseline; }
  li button:hover { background: #8882; }
  li button[aria-current='true'] { background: #6366f126; font-weight: 600; }
  .dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
  .dot.ok { background: #16a34a; } .dot.warn { background: #f59e0b; } .dot.err { background: #dc2626; }
  .id { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .count { opacity: .55; font-variant-numeric: tabular-nums; font-size: 12px; }
  .findings { margin-top: 20px; }
  .finding { display: grid; grid-template-columns: 64px 1fr; gap: 10px; padding: 6px 0; border-top: 1px solid #8882; font-size: 13px; }
  .sev { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; opacity: .7; }
  .sev.error { color: #dc2626; } .sev.warning { color: #b45309; }
  .path { font-family: ui-monospace, monospace; font-size: 12px; opacity: .7; }
  .status { position: fixed; right: 14px; bottom: 12px; font-size: 12px; opacity: .6; }
  .empty { opacity: .6; padding: 40px 0; }
  pre.issues { background: #dc26261a; padding: 12px; border-radius: 8px; white-space: pre-wrap; font-size: 12px; }
</style>
</head>
<body>
<aside>
  <h1>${escapeHtml(label)}</h1>
  <ul id="list"></ul>
</aside>
<main>
  <div id="stage"></div>
  <div class="findings" id="findings"></div>
</main>
<div class="status" id="status">connecting…</div>
<script type="module">
// Only the dom adapter. The server has already parsed and validated the document,
// which is exactly the split the package prescribes — a renderer receives a parsed
// document and has no business running the validator again.
import { mountPlayer } from '/_clotho/dom/index.js';

const listEl = document.getElementById('list');
const stageEl = document.getElementById('stage');
const findingsEl = document.getElementById('findings');
const statusEl = document.getElementById('status');

let current = new URLSearchParams(location.search).get('doc');
let handle = null;

function dotClass(d) { return d.errors > 0 ? 'err' : d.warnings > 0 ? 'warn' : 'ok'; }

async function refreshList() {
  const { documents } = await fetch('/api/documents').then((r) => r.json());
  if (!current && documents.length > 0) current = documents[0].id;
  listEl.replaceChildren(...documents.map((d) => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.setAttribute('aria-current', String(d.id === current));
    const dot = document.createElement('span');
    dot.className = 'dot ' + dotClass(d);
    const id = document.createElement('span');
    id.className = 'id';
    id.textContent = d.id;
    button.append(dot, id);
    if (d.errors + d.warnings > 0) {
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = String(d.errors + d.warnings);
      button.append(count);
    }
    button.addEventListener('click', () => { current = d.id; history.replaceState(null, '', '?doc=' + encodeURIComponent(d.id)); refresh(); });
    li.append(button);
    return li;
  }));
  if (documents.length === 0) {
    listEl.replaceChildren(Object.assign(document.createElement('li'), { className: 'empty', textContent: 'no documents' }));
  }
}

async function refresh() {
  await refreshList();
  if (!current) { stageEl.replaceChildren(); findingsEl.replaceChildren(); return; }

  const time = handle?.player.getState().time ?? 0;
  const playing = handle?.player.getState().playing ?? true;
  const detail = await fetch('/api/documents/' + encodeURIComponent(current)).then((r) => r.json());

  handle?.destroy();
  handle = null;
  stageEl.replaceChildren();
  findingsEl.replaceChildren();

  if (!detail.document) {
    const pre = document.createElement('pre');
    pre.className = 'issues';
    pre.textContent = detail.issues.join('\\n');
    stageEl.append(pre);
    return;
  }

  handle = mountPlayer(stageEl, detail.document);
  // Keeping the playhead is the point of a live reload: an author editing the tail
  // of a twelve-second animation should not be sent back to zero on every save.
  handle.player.seek(Math.min(time, detail.document.duration));
  if (!playing) handle.player.pause();

  const rows = [
    ...detail.findings.map((f) => [f.severity, f.path, f.message]),
    ...detail.lint.map((f) => [f.severity, f.ruleId + ' · ' + f.path, f.message]),
  ];
  findingsEl.replaceChildren(...rows.map(([severity, path, message]) => {
    const row = document.createElement('div');
    row.className = 'finding';
    const sev = document.createElement('span');
    sev.className = 'sev ' + severity;
    sev.textContent = severity;
    const text = document.createElement('div');
    const p = document.createElement('div');
    p.className = 'path';
    p.textContent = path;
    text.append(document.createTextNode(message), p);
    row.append(sev, text);
    return row;
  }));
}

const events = new EventSource('/api/events');
events.addEventListener('open', () => { statusEl.textContent = 'watching'; });
events.addEventListener('error', () => { statusEl.textContent = 'disconnected'; });
events.addEventListener('change', (event) => {
  statusEl.textContent = 'reloaded ' + new Date().toLocaleTimeString();
  refresh();
});

refresh();
</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
