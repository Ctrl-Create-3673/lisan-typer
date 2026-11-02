import { toKeyboardText, toUnicodeDisplay, toKeystrokes } from './keymap.js';
import * as cloud from './cloud.js';

/* global Tesseract */
const MAX_SIDE = 2400; // px; plenty for text, keeps OCR fast
// Our own model: Tesseract's Urdu model fine-tuned on lines rendered in Al-Kanz, Kanz-al-Yaqoot and
// Kanz-al-Lulu (docs/tessdata/lsd.traineddata.gz). Bump the version when the file changes, so
// browsers that cached the old model fetch the new one.
const MAIN_LANG = 'lsd';
const MODEL_OPTIONS = { lsd: { langPath: new URL('tessdata', location.href).href, cachePath: 'lsd-v2' } };

const $ = (id) => document.getElementById(id);
const drop = $('drop'), fileInput = $('file'), go = $('go'), count = $('count'), results = $('results');
const items = []; // { file, url, name, card, segments, docId }
let user = null;

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
    addItem({ file, url: URL.createObjectURL(file), name: file.name || 'Pasted image', segments: null });
  }
}

function addItem(item) {
  item.card = makeCard(item);
  results.append(item.card);
  items.push(item);
  refreshCount();
  return item;
}

function refreshCount() {
  const pending = items.filter((i) => !i.segments).length;
  count.textContent = pending ? `${pending} image${pending > 1 ? 's' : ''} to read` : items.length ? 'All read' : 'No images yet';
  go.disabled = pending === 0;
}

function makeCard(item) {
  const card = document.createElement('section');
  card.className = 'card';
  card.innerHTML = `
    <div class="card-head">
      <img alt="">
      <span class="name"></span>
      <span class="status">Ready – click “Read the text”</span>
      <button class="remove">Remove</button>
    </div>`;
  const img = card.querySelector('img');
  if (item.url) img.src = item.url; else img.remove();
  card.querySelector('.name').textContent = item.name;
  card.querySelector('.remove').addEventListener('click', () => {
    items.splice(items.indexOf(item), 1);
    if (item.url) URL.revokeObjectURL(item.url);
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

// One worker per language for the whole visit; the first use downloads its data (then cached).
const workers = {};
let current;
function getWorker(lang) {
  workers[lang] ??= Tesseract.createWorker(lang, 1, {
    ...MODEL_OPTIONS[lang],
    logger: (m) => {
      if (!current || typeof m.progress !== 'number') return;
      const what = m.status.startsWith('recognizing') ? (lang === 'eng' ? 'Checking English words' : 'Reading') : 'Loading reader';
      setStatus(current, `${what}… ${Math.round(m.progress * 100)}%`, 'busy');
    },
  }).then(async (worker) => {
    // one uniform block of text: our model read 86% of the sample's words this way, 62% with automatic layout
    if (lang === MAIN_LANG) await worker.setParameters({ tessedit_pageseg_mode: '6' });
    return worker;
  }).catch((err) => { delete workers[lang]; throw err; });
  return workers[lang];
}

async function ocr(lang, canvas) {
  return (await (await getWorker(lang)).recognize(canvas, {}, { text: true, blocks: true })).data;
}

const wordsOf = (data) => data.blocks.flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
const overlaps = (a, b) =>
  Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 * Math.min(a.x1 - a.x0, b.x1 - b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);
const ARABIC_LETTER = /[ء-يٮ-ۓ]/;

// The Urdu model turns English words into digits. Read the same image in English and put back
// confident English words, but only where the Urdu reading has no Arabic letters at all.
function withEnglish(urd, eng) {
  const english = wordsOf(eng).filter((w) => /^[A-Za-z][A-Za-z'’-]+$/.test(w.text) && w.confidence >= 60);
  const used = new Set();
  let text = urd.text;
  for (const w of wordsOf(urd)) {
    if (ARABIC_LETTER.test(w.text)) continue;
    const match = english.find((e) => overlaps(w.bbox, e.bbox));
    if (!match) continue;
    // the Urdu reader sometimes splits one English word into several pieces: keep the word once
    text = text.replace(w.text, used.has(match) ? '' : match.text);
    used.add(match);
  }
  return text.replace(/ {2,}/g, ' ');
}

async function readAll() {
  go.disabled = true;
  for (const item of items.filter((i) => !i.segments)) {
    current = item;
    setStatus(item, 'Starting…', 'busy');
    try {
      if (typeof Tesseract === 'undefined') throw new Error('The text reader did not load. Check your internet connection and reload.');
      const canvas = await prepareImage(item.file);
      const urd = await ocr(MAIN_LANG, canvas);
      const eng = await ocr('eng', canvas);
      const text = withEnglish(urd, eng)
        .replace(/[‎‏‪-‮]/g, '') // drop invisible direction marks
        .replace(/\{/g, '}') // the model may return the small-ج marker mirrored
        .trim();
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
      ${cloud.enabled ? '<button class="save primary">Save</button>' : ''}
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
    // one block per line of the image, so the layout matches the original
    const lines = [document.createElement('div')];
    for (const s of item.segments) {
      (alkanz ? toKeyboardText(s.text) : toUnicodeDisplay(s.text)).split('\n').forEach((piece, i) => {
        if (i > 0) lines.push(document.createElement('div'));
        const span = document.createElement('span');
        if (s.highlighted) span.className = 'hl';
        // English words get a Latin font, like the reference
        for (const part of piece.split(/([A-Za-z][A-Za-z'’-]*)/)) {
          if (!part) continue;
          if (/^[A-Za-z]/.test(part)) { const en = document.createElement('span'); en.className = 'en'; en.textContent = part; span.append(en); }
          else span.append(part);
        }
        lines.at(-1).append(span);
      });
    }
    for (const line of lines) line.className = 'line';
    lines.at(-1).classList.add('last');
    rendered.replaceChildren(...lines);
    fitLines(rendered);
    keysEl.textContent = toKeystrokes(toKeyboardText(plain()));
  };
  let lastWidth = 0; // refit on width changes only; fitting changes the height
  new ResizeObserver(([entry]) => {
    if (Math.abs(entry.contentRect.width - lastWidth) < 1) return;
    lastWidth = entry.contentRect.width;
    fitLines(rendered);
  }).observe(rendered);
  document.fonts.ready.then(() => fitLines(rendered));
  font.addEventListener('change', render);
  edit.addEventListener('input', () => { item.segments = [{ text: edit.value, highlighted: false }]; render(); });

  box.querySelector('.save')?.addEventListener('click', async (e) => {
    const button = e.currentTarget;
    button.disabled = true;
    try {
      if (!user) await cloud.signIn();
      item.docId = await cloud.saveText(item.docId, item.name, plain());
      flash(button, 'Saved');
      refreshSaved();
    } catch (err) {
      flash(button, { 'auth/popup-closed-by-user': 'Not signed in', 'auth/popup-blocked': 'Allow pop-ups to sign in' }[err?.code] ?? 'Save failed');
      console.error(err);
    } finally {
      button.disabled = false;
    }
  });

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

// Shrink the text until the longest line fits, so each image line stays one line.
// Below MIN_FONT (phones) let lines wrap instead of becoming unreadable.
const MIN_FONT = 16;
function fitLines(box) {
  box.classList.remove('wrap');
  box.style.fontSize = '';
  const base = parseFloat(getComputedStyle(box).fontSize);
  const lines = [...box.children];
  const ratio = Math.max(1, ...lines.map((l) => l.scrollWidth / (l.clientWidth || 1)));
  if (ratio === 1) return;
  const size = Math.floor((base / ratio) * 0.98);
  if (size < MIN_FONT) box.classList.add('wrap');
  else box.style.fontSize = `${size}px`;
}

function flash(button, text) {
  const old = button.textContent;
  button.textContent = text;
  setTimeout(() => { button.textContent = old; }, 1400);
}

// ---- Google sign-in and saved texts ----
const account = $('account'), saved = $('saved'), savedList = $('saved-list');

function renderAccount() {
  account.replaceChildren();
  if (!user) {
    const b = document.createElement('button');
    b.textContent = 'Sign in with Google';
    b.addEventListener('click', () => cloud.signIn().catch((err) => {
      console.error(err);
      if (err?.code === 'auth/popup-blocked') alert('Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.');
    }));
    account.append(b);
    return;
  }
  const who = document.createElement('span');
  who.className = 'hint';
  who.textContent = user.email;
  const out = document.createElement('button');
  out.textContent = 'Sign out';
  out.addEventListener('click', () => cloud.signOut());
  account.append(who, out);
}

async function refreshSaved() {
  saved.hidden = !user;
  if (!user) return savedList.replaceChildren();
  try {
    const list = await cloud.listTexts();
    savedList.replaceChildren(...(list.length ? list.map(savedRow) : [Object.assign(document.createElement('li'), { className: 'hint', textContent: 'Nothing saved yet. Read an image and press Save.' })]));
  } catch (err) {
    console.error(err);
    savedList.replaceChildren(Object.assign(document.createElement('li'), { className: 'status error', textContent: 'Could not load your saved texts.' }));
  }
}

function savedRow(doc) {
  const li = document.createElement('li');
  const title = document.createElement('span');
  title.className = 'name';
  title.textContent = doc.title;
  const when = document.createElement('span');
  when.className = 'hint';
  when.textContent = doc.updatedAt?.toDate?.().toLocaleString() ?? '';
  const open = document.createElement('button');
  open.textContent = 'Open';
  open.addEventListener('click', () => {
    const existing = items.find((i) => i.docId === doc.id);
    if (existing) return existing.card.scrollIntoView({ behavior: 'smooth' });
    const item = addItem({ file: null, url: null, name: doc.title, docId: doc.id, segments: [{ text: doc.text, highlighted: false }] });
    setStatus(item, 'Saved text');
    showResult(item);
    item.card.scrollIntoView({ behavior: 'smooth' });
  });
  const del = document.createElement('button');
  del.textContent = 'Delete';
  del.addEventListener('click', async () => {
    if (!confirm(`Delete “${doc.title}” from your saved texts?`)) return;
    try { await cloud.deleteText(doc.id); } catch (err) { console.error(err); }
    for (const i of items) if (i.docId === doc.id) i.docId = null;
    refreshSaved();
  });
  li.append(title, when, open, del);
  return li;
}

if (cloud.enabled) {
  cloud.onUser((u) => { user = u; renderAccount(); refreshSaved(); }).catch((err) => {
    console.error(err);
    account.textContent = 'Sign-in is unavailable right now.';
  });
}
