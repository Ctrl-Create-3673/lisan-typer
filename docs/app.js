import { toKeyboardText, toUnicodeDisplay } from './keymap.js';
import * as cloud from './cloud.js';

/* global Tesseract, docx */
const MAX_SIDE = 2400; // px; plenty for text, keeps OCR fast
// Our own model: Tesseract's Urdu model fine-tuned on lines rendered in Al-Kanz, Kanz-al-Yaqoot and
// Kanz-al-Lulu (docs/tessdata/lsd.traineddata.gz). Bump the version when the file changes, so
// browsers that cached the old model fetch the new one.
const MAIN_LANG = 'lsd';
const MODEL_OPTIONS = { lsd: { langPath: new URL('tessdata', location.href).href, cachePath: 'lsd-v2' } };
const PDFJS = new URL('vendor/pdfjs/', location.href).href; // pdf.js 4.10.38, served from this site so its worker can start
// Font families as Word knows them (the names inside the font files)
const FONTS = {
  alkanz: { word: 'AL-KANZ', text: toKeyboardText },
  yaqoot: { word: 'Kanz-al-Yaqoot', text: toUnicodeDisplay },
  lulu: { word: 'Kanz-al-Lulu', text: toUnicodeDisplay },
};
// Small raised text (Word superscript, e.g. خدا^تع^) is kept between ^ marks
const SUP = /\^([^^\n]+)\^/;

const $ = (id) => document.getElementById(id);
const drop = $('drop'), fileInput = $('file'), go = $('go'), count = $('count'), results = $('results');
const items = []; // { file | canvas, url, name, card, segments, docId }
let user = null;

drop.addEventListener('click', () => fileInput.click());
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
fileInput.addEventListener('change', () => { addFiles([...fileInput.files]); fileInput.value = ''; });
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files]); });
document.addEventListener('paste', (e) => addFiles([...e.clipboardData.files]));
go.addEventListener('click', readAll);

async function addFiles(files) {
  for (const file of files) {
    if (file.type === 'application/pdf') await addPdf(file);
    else if (file.type.startsWith('image/')) addItem({ file, url: URL.createObjectURL(file), name: file.name || 'Pasted image', segments: null });
  }
}

// Each PDF page becomes its own card, read like an image.
async function addPdf(file) {
  count.textContent = `Opening ${file.name}…`;
  try {
    const pdfjs = await import(`${PDFJS}pdf.min.mjs`);
    pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS}pdf.worker.min.mjs`;
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const { width, height } = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(4, MAX_SIDE / Math.max(width, height)) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // 'print' draws in one go; 'display' waits for animation frames, which stop while the tab is in the background
      await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;
      addItem({ canvas, url: canvas.toDataURL('image/jpeg', 0.5), name: `${file.name} – page ${n}`, segments: null });
    }
  } catch (err) {
    console.error(err);
    alert(`Could not open ${file.name}. Is it a valid PDF?`);
  }
  refreshCount();
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
  count.textContent = pending ? `${pending} page${pending > 1 ? 's' : ''} to read` : items.length ? 'All read' : 'No images yet';
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
    if (item.url?.startsWith('blob:')) URL.revokeObjectURL(item.url);
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

const linesOf = (data) => data.blocks.flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
const heightOf = (l) => l.bbox.y1 - l.bbox.y0;
const widthOf = (l) => l.bbox.x1 - l.bbox.x0;

// The page reader puts small raised letters (Word superscript) on a tiny line of their own and
// misreads them there. Re-read such a tiny line together with the line under it as one line,
// the way the model was trained, so the raised letters come out next to their word.
async function readMainLines(canvas) {
  const lines = linesOf(await ocr(MAIN_LANG, canvas));
  const median = lines.map(heightOf).sort((a, b) => a - b)[Math.floor(lines.length / 2)] ?? 0;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], below = lines[i + 1];
    const raisedOnly = below && heightOf(line) < 0.6 * median && widthOf(line) < 0.6 * widthOf(below)
      && below.bbox.y0 - line.bbox.y1 < 0.4 * heightOf(below)
      && Math.min(line.bbox.x1, below.bbox.x1) > Math.max(line.bbox.x0, below.bbox.x0);
    if (!raisedOnly) { out.push(line); continue; }
    const pad = Math.round(0.15 * heightOf(below));
    const x0 = Math.max(0, Math.min(line.bbox.x0, below.bbox.x0) - pad), y0 = Math.max(0, line.bbox.y0 - pad);
    const rectangle = { left: x0, top: y0, width: Math.min(canvas.width, Math.max(line.bbox.x1, below.bbox.x1) + pad) - x0, height: Math.min(canvas.height, below.bbox.y1 + pad) - y0 };
    const worker = await getWorker(MAIN_LANG);
    await worker.setParameters({ tessedit_pageseg_mode: '7' }); // one line
    const reread = linesOf((await worker.recognize(canvas, { rectangle }, { text: true, blocks: true })).data);
    await worker.setParameters({ tessedit_pageseg_mode: '6' });
    out.push(...(reread.length ? reread : [line, below]));
    i++; // the line below is part of the re-read
  }
  return out;
}

const ARABIC_LETTER = /[ء-يٮ-ۓ]/;
const DIGITS = /[0-9٠-٩۰-۹]/g;
// Our model reads English words as runs of digits, sometimes with a stray Arabic letter (٥٥ا٥٥٥)
const looksEnglish = (t) => !ARABIC_LETTER.test(t) || (t.match(DIGITS)?.length ?? 0) * 2 >= t.length;

// Small raised letters (Word superscript, e.g. خداتع) end a word, so they are its leftmost ink.
// The reader's letter boxes are too rough to tell, so look at the pixels: walk the word's columns
// from its left end and collect columns whose ink stays clear of the baseline. Letters centred in
// that strip are raised.
function markRaised(word, line, px) {
  const syms = word.symbols ?? [];
  if (!syms.length || !px) return word.text;
  const b = line.baseline, top = line.bbox.y0;
  const baseAt = (x) => (b?.has_baseline && b.x1 > b.x0 ? b.y0 + ((b.y1 - b.y0) * (x - b.x0)) / (b.x1 - b.x0) : line.bbox.y1 - 0.25 * (line.bbox.y1 - top));
  const inkAt = (x) => {
    let t = -1, bt = -1;
    for (let y = top; y <= Math.min(px.height - 1, line.bbox.y1); y++) if (px.dark[y * px.width + x]) { if (t < 0) t = y; bt = y; }
    return [t, bt];
  };
  // Measured on Al-Kanz: raised marks end 25-29% of the line height above the baseline and reach the
  // line's top; word endings such as ار or اف end about 20% above it and stay lower.
  let edge = word.bbox.x0, inked = 0, body = false, stripTop = Infinity, stripBottom = -Infinity;
  for (let x = word.bbox.x0; x < word.bbox.x1; x++) {
    const [t, bottom] = inkAt(x);
    if (bottom < 0) { edge = x + 1; continue; }
    const baseY = baseAt(x), h = baseY - top;
    if (bottom > baseY - 0.23 * h) { body = true; break; } // ink reaches the line: the word body starts here
    stripTop = Math.min(stripTop, (t - top) / h);
    stripBottom = Math.max(stripBottom, (bottom - top) / h);
    edge = x + 1;
    inked++;
  }
  if (inked < 0.2 * (line.bbox.y1 - top) || stripTop > 0.12) return word.text; // a dot, or a low word ending
  // a raised mark read as its own word: short and small (a tall letter like ا is a normal word)
  if (!body) return syms.length <= 3 && stripBottom - stripTop < 0.55 ? `^${word.text}^` : word.text;
  if (edge - word.bbox.x0 > 0.6 * (word.bbox.x1 - word.bbox.x0)) return word.text; // too much: not a superscript
  const raised = syms.filter((s) => (s.bbox.x0 + s.bbox.x1) / 2 < edge);
  if (!raised.length || raised.length === syms.length) return word.text;
  const main = syms.filter((s) => !raised.includes(s));
  return `${main.map((s) => s.text).join('')}^${raised.map((s) => s.text).join('')}^`;
}

function darkPixels(canvas) {
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  const dark = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < dark.length; i++) dark[i] = data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2] < 420 ? 1 : 0;
  return { dark, width: canvas.width, height: canvas.height };
}

// Our model turns English words into digit junk (sometimes split into several pieces). Re-read just
// that area with the English reader; keep the junk only if English finds no word there.
async function readEnglish(canvas, words) {
  const pad = 4;
  const x0 = Math.max(0, Math.min(...words.map((w) => w.bbox.x0)) - pad), y0 = Math.max(0, Math.min(...words.map((w) => w.bbox.y0)) - pad);
  const x1 = Math.min(canvas.width, Math.max(...words.map((w) => w.bbox.x1)) + pad), y1 = Math.min(canvas.height, Math.max(...words.map((w) => w.bbox.y1)) + pad);
  const worker = await getWorker('eng');
  await worker.setParameters({ tessedit_pageseg_mode: '7' }); // one line
  const { data } = await worker.recognize(canvas, { rectangle: { left: x0, top: y0, width: x1 - x0, height: y1 - y0 } });
  const text = data.text.trim();
  return /^[A-Za-z][A-Za-z'’ -]*$/.test(text) && data.confidence >= 50 ? text : null;
}

// Rebuild the text line by line from words: English words re-read in English, raised letters marked.
async function buildText(canvas, mainLines, px) {
  const out = [];
  for (const line of mainLines) {
    const words = [];
    for (let i = 0; i < line.words.length; i++) {
      const w = line.words[i];
      if (!looksEnglish(w.text)) { words.push(markRaised(w, line, px)); continue; }
      let j = i;
      while (j + 1 < line.words.length && looksEnglish(line.words[j + 1].text)) j++;
      const group = line.words.slice(i, j + 1);
      words.push((await readEnglish(canvas, group)) ?? group.map((g) => g.text).join(' '));
      i = j;
    }
    out.push(words.join(' '));
  }
  return out.join('\n')
    .replace(/[‎‏‪-‮]/g, '') // invisible direction marks
    .replace(/\{/g, '}') // the model may return the small-ج marker mirrored
    .trim();
}

// Tesseract skips lines of small text now and then (seen with lines that carry raised marks).
// If rows of ink lie outside every line it found, the page needs reading again larger.
function missesInk(px, lines) {
  let ink = 0, missed = 0;
  const minDark = Math.max(3, Math.round(0.002 * px.width));
  for (let y = 0; y < px.height; y++) {
    let n = 0;
    for (let x = 0, row = y * px.width; x < px.width && n < minDark; x++) n += px.dark[row + x];
    if (n < minDark) continue;
    ink++;
    if (!lines.some((l) => y >= l.bbox.y0 && y <= l.bbox.y1)) missed++;
  }
  return missed > 0.15 * ink;
}

function scaleCanvas(canvas, k) {
  const big = document.createElement('canvas');
  big.width = Math.round(canvas.width * k);
  big.height = Math.round(canvas.height * k);
  const ctx = big.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, big.width, big.height);
  return big;
}

async function readAll() {
  go.disabled = true;
  for (const item of items.filter((i) => !i.segments)) {
    current = item;
    setStatus(item, 'Starting…', 'busy');
    try {
      if (typeof Tesseract === 'undefined') throw new Error('The text reader did not load. Check your internet connection and reload.');
      let canvas = await prepareImage(item);
      let px = darkPixels(canvas);
      let lines = await readMainLines(canvas);
      if (missesInk(px, lines)) {
        canvas = scaleCanvas(canvas, 1.5);
        px = darkPixels(canvas);
        lines = await readMainLines(canvas);
      }
      const text = await buildText(canvas, lines, px);
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
async function prepareImage(item) {
  const source = item.canvas ?? await createImageBitmap(item.file);
  const scale = Math.min(1, MAX_SIDE / Math.max(source.width, source.height));
  if (item.canvas && scale === 1) return item.canvas;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // transparent PNGs would otherwise turn black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Split one line of text into runs: { text, sup, en, hl }
function runsOf(line, hl) {
  const runs = [];
  line.split(SUP).forEach((part, i) => {
    if (!part) return;
    if (i % 2) return runs.push({ text: part, sup: true, hl });
    for (const piece of part.split(/([A-Za-z][A-Za-z'’-]*)/)) {
      if (piece) runs.push({ text: piece, en: /^[A-Za-z]/.test(piece), hl });
    }
  });
  return runs;
}

// segments -> lines of runs, in the chosen font's text form
function linesFor(segments, fontKey) {
  const lines = [[]];
  for (const s of segments) {
    FONTS[fontKey].text(s.text).split('\n').forEach((piece, i) => {
      if (i > 0) lines.push([]);
      lines.at(-1).push(...runsOf(piece, s.highlighted));
    });
  }
  return lines;
}

function runElement(r) {
  const el = document.createElement(r.sup ? 'sup' : 'span');
  el.textContent = r.text;
  if (r.en) el.className = 'en';
  if (r.hl) el.classList.add('hl');
  return el;
}

function showResult(item) {
  item.card.querySelector('.result')?.remove();
  const box = document.createElement('div');
  box.className = 'result';
  box.innerHTML = `
    <div class="row" style="border-top:0">
      <label>Font <select class="font">
        <option value="alkanz">Al-Kanz</option>
        <option value="lulu">Kanz-al-Lulu</option>
        <option value="yaqoot">Kanz-al-Yaqoot</option>
      </select></label>
    </div>
    <div class="rendered f-alkanz" lang="ar"></div>
    <details><summary>Fix the text</summary><textarea class="edit" rows="5" lang="ar" aria-label="Edit the read text"></textarea>
      <span class="hint">Fix any wrong word here; the text above updates as you type. Put small raised letters between ^ marks, e.g. خدا^تع^.</span></details>
    <div class="row">
      ${cloud.enabled ? '<button class="save primary">Save</button>' : ''}
      <button data-copy="alkanz">Copy for Al-Kanz</button>
      <button data-copy="lulu">Copy for Kanz-al-Lulu</button>
      <span class="sep"></span>
      <button data-export="word">Export to Word</button>
      <button data-export="pdf">Export to PDF</button>
    </div>`;
  item.card.append(box);

  const font = box.querySelector('.font'), rendered = box.querySelector('.rendered'), edit = box.querySelector('.edit');
  const plain = () => item.segments.map((s) => s.text).join('');
  edit.value = plain();

  const render = () => {
    rendered.className = `rendered f-${font.value}`;
    // one block per line of the image, so the layout matches the original
    const lines = linesFor(item.segments, font.value).map((runs) => {
      const div = document.createElement('div');
      div.className = 'line';
      div.append(...runs.map(runElement));
      return div;
    });
    lines.at(-1).classList.add('last');
    rendered.replaceChildren(...lines);
    fitLines(rendered);
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
    const { copy, export: exportAs } = e.target.dataset ?? {};
    if (copy) {
      try {
        await copyText(linesFor(item.segments, copy), FONTS[copy].word);
        flash(e.target, 'Copied');
      } catch (err) {
        console.error(err);
        flash(e.target, 'Copy failed');
      }
    } else if (exportAs === 'word') {
      exportWord(linesFor(item.segments, font.value), FONTS[font.value].word, item.name).catch((err) => {
        console.error(err);
        flash(e.target, 'Export failed');
      });
    } else if (exportAs === 'pdf') {
      exportPdf(rendered, item.name);
    }
  });
  render();
}

const fileBase = (name) => name.replace(/\.(pdf|png|jpe?g|webp|gif)\b/gi, '').replace(/[\\/:*?"<>|]+/g, '-') || 'Lisan Ul Dawat';
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Plain text for any app, plus rich text so Word and Docs keep the font and the raised letters.
async function copyText(lines, fontName) {
  const plain = lines.map((runs) => runs.map((r) => r.text).join('')).join('\n');
  const html = `<div dir="rtl" style="font-family:'${fontName}'">${lines.map((runs) =>
    `<p dir="rtl" style="margin:0">${runs.map((r) => {
      const t = escapeHtml(r.text);
      const styled = r.hl ? `<span style="color:#c0261c">${t}</span>` : t;
      return r.sup ? `<sup>${styled}</sup>` : styled;
    }).join('')}</p>`).join('')}</div>`;
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/plain': new Blob([plain], { type: 'text/plain' }),
      'text/html': new Blob([html], { type: 'text/html' }),
    })]);
  } catch {
    await navigator.clipboard.writeText(plain); // browsers without rich-text copy
  }
}

async function exportWord(lines, fontName, name) {
  if (typeof docx === 'undefined') throw new Error('Word export did not load');
  const { Document, Packer, Paragraph, TextRun, AlignmentType } = docx;
  const doc = new Document({
    sections: [{
      children: lines.map((runs) => new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.BOTH,
        spacing: { line: 420 },
        children: runs.map((r) => new TextRun({
          text: r.text,
          font: r.en ? 'Calibri' : fontName,
          size: 32, // half-points: 16 pt
          rightToLeft: !r.en,
          superScript: r.sup,
          ...(r.hl && { color: 'C0261C' }),
        })),
      })),
    }],
  });
  download(await Packer.toBlob(doc), `${fileBase(name)}.docx`);
}

// The browser's own PDF printer keeps the real fonts and selectable text: choose "Save as PDF".
function exportPdf(rendered, name) {
  const area = $('print-area');
  area.className = rendered.className.replace('rendered', '').trim();
  area.replaceChildren(...[...rendered.children].map((line) => line.cloneNode(true)));
  const title = document.title;
  document.title = fileBase(name);
  addEventListener('afterprint', () => { document.title = title; area.replaceChildren(); }, { once: true });
  print();
}

function download(blob, filename) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
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
