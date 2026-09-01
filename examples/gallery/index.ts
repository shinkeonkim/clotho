import { parseDocument } from '../../src/core/index';
import { mountPlayer } from '../../src/dom/index';
import { renderDocumentToSvg } from '../../src/svg/index';
import { GALLERY } from './documents';

const nav = document.querySelector<HTMLElement>('#nav');
const sections = document.querySelector<HTMLElement>('#sections');
const FRAMES = 9;

if (!nav || !sections) throw new Error('Gallery root elements are missing');

for (const entry of GALLERY) {
  const link = document.createElement('a');
  link.href = `#${entry.slug}`;
  link.textContent = entry.title;
  nav.append(link);

  const section = document.createElement('section');
  section.id = entry.slug;
  section.innerHTML = `<h2>${entry.title}</h2><p class="note">${entry.note}</p>`;
  sections.append(section);

  // Parse per section so one invalid document reports itself without blanking the page.
  const result = parseDocument(entry.doc);
  if (!result.ok) {
    const box = document.createElement('div');
    box.className = 'fail';
    box.textContent = result.issues.join('\n');
    section.append(box);
    continue;
  }
  const doc = result.document;
  const options = entry.assetResolver ? { assetResolver: entry.assetResolver } : {};

  const stage = document.createElement('div');
  section.append(stage);
  mountPlayer(stage, doc, options);

  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'toggle';
  toggle.textContent = 'frames';
  toolbar.append(
    toggle,
    document.createTextNode(`${doc.duration} ms · ${doc.elements.length} elements`),
  );
  section.append(toolbar);

  const strip = document.createElement('div');
  strip.className = 'filmstrip';
  strip.hidden = true;
  section.append(strip);

  toggle.addEventListener('click', () => {
    strip.hidden = !strip.hidden;
    if (!strip.hidden && strip.childElementCount === 0) {
      for (let index = 0; index < FRAMES; index += 1) {
        const time = Math.round((doc.duration * index) / (FRAMES - 1));
        const figure = document.createElement('figure');
        figure.className = 'frame';
        figure.style.margin = '0';
        figure.innerHTML = `${renderDocumentToSvg(doc, time, options)}<figcaption>${time} ms</figcaption>`;
        strip.append(figure);
      }
    }
  });
}
