import { toKeyboardText, toUnicodeDisplay, toKeystrokes } from './keymap.js';

/* global Tesseract */
const MAX_SIDE = 2400; // px; plenty for text, keeps OCR fast
// Urdu covers ٹ ڑ ے ں ھ, Arabic the rest. Adding 'eng' fixes English words but turns
// many Lisan-ud-Dawat words into Latin junk, so English words are left for the edit box.
const OCR_LANGS = 'urd+ara';

const $ = (id) => document.getElementById(id);
const drop = $('drop'), fileInput = $('file'), go = $('go'), count = $('count'), results = $('results');
const items = []; // { file, url, card, segments }

drop.addEventListener('click', () => fileInput.click());
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); });
document.addEventListener('paste', (e) => addFiles(e.clipboardData.files));
go.addEventListener('click', readAll);

function addFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const item = { file, url: URL.createObjectURL(file), segments: null };
    item.card = makeCard(item);
    results.append(item.card);
    items.push(item);
  }
  refreshCount();
}

function refreshCount() {
  const pending = items.filter((i) => !i.segments).length;
  count.textContent = items.length ? `${items.length} image${items.length > 1 ? 's' : ''} · ${pending} to read` : 'No images yet';
  go.disabled = pending === 0;
}

function makeCard(item) {
  const card = document.createElement('section');
  card.className = 'card';
  card.innerHTML = `
    <div class="card-head">
      <img alt="">
      <span class="name"></span>
      <span class="status">Waiting</span>
      <button class="remove" aria-label="Remove image">Remove</button>
    </div>`;
  card.querySelector('img').src = item.url;
  card.querySelector('.name').textContent = item.file.name || 'Pasted image';
  card.querySelector('.remove').addEventListener('click', () => {
    items.splice(items.indexOf(item), 1);
    URL.revokeObjectURL(item.url);
    card.remove();
    refreshCount();
  });
  return card;
}

function setStatus(item, text, kind = '') {
  const el = item.card.querySelector('.status');
  el.className = `status ${kind}`;
  el.innerHTML = kind === 'busy' ? '<span class="spinner"></span>' : '';
  el.append(text);
}

// One OCR worker for the whole visit; the first use downloads the language data (~25 MB, then cached).
let worker, current;
function getWorker() {
  worker ??= Tesseract.createWorker(OCR_LANGS, 1, {
    logger: (m) => {
      if (!current || typeof m.progress !== 'number') return;
      const what = m.status.startsWith('recognizing') ? 'Reading' : 'Loading reader';
      setStatus(current, `${what}… ${Math.round(m.progress * 100)}%`, 'busy');
    },
  }).catch((err) => { worker = null; throw err; });
  return worker;
}

async function readAll() {
  go.disabled = true;
  for (const item of items.filter((i) => !i.segments)) {
    current = item;
    setStatus(item, 'Starting…', 'busy');
    try {
      if (typeof Tesseract === 'undefined') throw new Error('The text reader did not load. Check your internet connection and reload.');
      const { data } = await (await getWorker()).recognize(await prepareImage(item.file));
      const text = data.text.replace(/[‎‏‪-‮]/g, '').trim(); // drop invisible direction marks
      item.segments = text ? [{ text, highlighted: false }] : [];
      setStatus(item, text ? 'Done – check the text below' : 'No text found');
      if (text) showResult(item);
    } catch (err) {
      setStatus(item, err?.message || 'Could not read this image', 'error');
    }
  }
  current = null;
  refreshCount();
}

// Downscale big photos and flatten transparency so OCR is fast and sees dark text on white.
async function prepareImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // transparent PNGs would otherwise turn black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function showResult(item) {
  item.card.querySelector('.result')?.remove();
  const box = document.createElement('div');
  box.className = 'result';
  box.innerHTML = `
    <div class="row" style="border-top:0">
      <label>Font <select class="font">
        <option value="alkanz">Al-Kanz (keyboard text)</option>
        <option value="yaqoot">Kanz-al-Yaqoot</option>
        <option value="lulu">Kanz-al-Lulu</option>
      </select></label>
    </div>
    <div class="rendered f-alkanz" lang="ar"></div>
    <details><summary>Keystrokes (AL Fatemi layout)</summary><pre class="keys" dir="ltr"></pre></details>
    <details><summary>Fix the text</summary><textarea class="edit" rows="5" lang="ar" aria-label="Edit the transcribed text"></textarea>
      <span class="hint">The reader often mistakes Lisan-ud-Dawat letters. Fix them here; the view and keystrokes update as you type.</span></details>
    <div class="row">
      <button data-copy="keyboard">Copy text for Al-Kanz</button>
      <button data-copy="unicode">Copy standard Unicode</button>
      <button data-copy="keys">Copy keystrokes</button>
    </div>`;
  item.card.append(box);

  const font = box.querySelector('.font'), rendered = box.querySelector('.rendered');
  const keysEl = box.querySelector('.keys'), edit = box.querySelector('.edit');
  const plain = () => item.segments.map((s) => s.text).join('');
  edit.value = plain();

  const render = () => {
    const alkanz = font.value === 'alkanz';
    rendered.className = `rendered f-${font.value}`;
    rendered.replaceChildren(...item.segments.map((s) => {
      const span = document.createElement('span');
      if (s.highlighted) span.className = 'hl';
      // English words get a Latin font, like the reference
      for (const part of (alkanz ? toKeyboardText(s.text) : toUnicodeDisplay(s.text)).split(/([A-Za-z][A-Za-z'’-]*)/)) {
        if (!part) continue;
        if (/^[A-Za-z]/.test(part)) { const en = document.createElement('span'); en.className = 'en'; en.textContent = part; span.append(en); }
        else span.append(part);
      }
      return span;
    }));
    keysEl.textContent = toKeystrokes(toKeyboardText(plain()));
  };
  font.addEventListener('change', render);
  edit.addEventListener('input', () => { item.segments = [{ text: edit.value, highlighted: false }]; render(); });

  box.addEventListener('click', async (e) => {
    const kind = e.target.dataset?.copy;
    if (!kind) return;
    const text = kind === 'keyboard' ? toKeyboardText(plain()) : kind === 'unicode' ? plain() : keysEl.textContent;
    try {
      await navigator.clipboard.writeText(text);
      flash(e.target, 'Copied');
    } catch {
      flash(e.target, 'Copy failed');
    }
  });
  render();
}

function flash(button, text) {
  const old = button.textContent;
  button.textContent = text;
  setTimeout(() => { button.textContent = old; }, 1200);
}
