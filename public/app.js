import { toKeyboardText, toUnicodeDisplay, toKeystrokes } from './keymap.js';

const MAX_SIDE = 2400; // px; plenty for text, keeps uploads small
const MAX_BYTES = 4.5 * 1024 * 1024; // under Claude's 5 MB image limit

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

async function readAll() {
  go.disabled = true;
  for (const item of items.filter((i) => !i.segments)) {
    setStatus(item, 'Reading…', 'busy');
    try {
      const { data, mediaType } = await prepareImage(item.file);
      const res = await fetch('api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: data, mediaType }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Server error ${res.status}`);
      item.segments = body.segments;
      setStatus(item, item.segments.length ? 'Done' : 'No Lisan-ud-Dawat text found');
      showResult(item);
    } catch (err) {
      setStatus(item, err.message || 'Failed', 'error');
    }
  }
  refreshCount();
}

// Downscale big photos and re-encode as JPEG so the upload stays under the API limit.
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
  for (const quality of [0.92, 0.8, 0.65, 0.5]) {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    if (blob.size <= MAX_BYTES) return { data: await toBase64(blob), mediaType: 'image/jpeg' };
  }
  throw new Error('Image is too large even after shrinking');
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
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
      <span class="hint">Edits update the view and keystrokes. Colour highlights are dropped once you edit.</span></details>
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
