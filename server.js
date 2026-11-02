// Serves docs/ and POST /api/transcribe, which sends one image to Google Gemini (free tier).
// The key stays here on the server: set GEMINI_API_KEY (or put it in .env).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ApiError } from '@google/genai';

const PORT = Number(process.env.PORT) || 3000;
// On the Lisan-ud-Dawat sample: 3.6-flash 96% exact words, 3.5-flash-lite 88%, 3.8-flash overloaded.
// The second model is the backup when the first is busy, slow or out of free daily quota.
const MODELS = [process.env.GEMINI_MODEL || 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_HOUR) || 30; // images per visitor IP per hour
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'docs');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY is not set. Put GEMINI_API_KEY=... in a .env file next to server.js, or in your host\'s environment settings.');
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SCHEMA = {
  type: 'object',
  properties: {
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          highlighted: { type: 'boolean', description: 'true when this text is coloured (e.g. red) in the image' },
        },
        required: ['text', 'highlighted'],
      },
    },
  },
  required: ['segments'],
};

const SYSTEM = `You transcribe images of Lisan-ud-Dawat text: the Dawoodi Bohra language, Gujarati-based and written in Arabic script, often mixed with Arabic, Urdu and English words.

Copy the text exactly as written. Do not translate, correct, complete or normalise spelling, and do not add anything that is not in the image.

Letters:
- Use ٹ ڈ ڑ پ چ گ ے ں where the image shows them, ھ for the two-eyed aspirate h (دھ، چھ، گھ، پڑھ), and ہ or ه as shown.
- Keep Arabic ي and ك where the image uses them; use ک only where the image shows the Urdu form.
- A small raised ج written after a word (an emphatic particle, as in یہج or نے ج): output the single character } in its place.
- A short vertical tick written just before an alif (as in 'ايو): output ْ (U+0652) directly before the alif.
- Keep English words in Latin letters, digits as they appear, ornate brackets as ﴿ ﴾, and quotation marks, ellipses and the Arabic comma ، as written.

Layout: keep the image's lines exactly. Put \\n at the end of every line as it appears in the image, so each line of the image is one line of output. Do not skip any word, even if it is hard to read; write your best reading.
Colour: put text that is coloured differently from the body text (for example red) in its own segment with highlighted: true; all other text has highlighted: false.
If the image contains no Lisan-ud-Dawat or Arabic-script text, return an empty segments list.`;

async function transcribe(image, mimeType) {
  let response;
  for (const [i, model] of MODELS.entries()) {
    try {
      response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data: image } }, { text: 'Transcribe the text in this image.' }] }],
        config: {
          systemInstruction: SYSTEM, responseMimeType: 'application/json', responseJsonSchema: SCHEMA,
          thinkingConfig: { thinkingLevel: 'LOW' }, // copying text needs little reasoning; keeps replies fast
          httpOptions: { timeout: 90_000 }, // ms; a hung request then counts as an error and the page falls back
        },
      });
      break;
    } catch (err) {
      // 429 quota, 500/503 busy, 504 or no status: timed out
      const busyOrLimit = err instanceof ApiError ? [429, 500, 503, 504].includes(err.status) : err?.name === 'AbortError' || /abort/i.test(err?.message);
      if (!busyOrLimit || i === MODELS.length - 1) throw err;
      console.error(`Gemini ${err.status} on ${model}, trying ${MODELS[i + 1]}`);
    }
  }
  const finish = response.candidates?.[0]?.finishReason;
  if (finish === 'MAX_TOKENS') throw new HttpError(422, 'The text is too long for one image. Crop it into smaller parts.');
  if (finish && finish !== 'STOP') throw new HttpError(422, 'The AI declined to read this image.');
  let result;
  try { result = JSON.parse(response.text ?? ''); } catch { /* checked below */ }
  // validate: the schema is a request, not a guarantee
  if (!Array.isArray(result?.segments) || !result.segments.every((s) => typeof s?.text === 'string')) {
    throw new HttpError(502, 'The AI returned an unreadable answer. Please try again.');
  }
  return { segments: result.segments.map((s) => ({ text: s.text, highlighted: s.highlighted === true })) };
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// shortcut: in-memory limiter, resets on restart and is per server instance; use a shared store if you run several instances
const hits = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 3600_000);
  if (recent.length >= RATE_LIMIT) throw new HttpError(429, 'Too many images from your connection. Please try again in an hour.');
  recent.push(now);
  hits.set(ip, recent);
}

async function readJson(req, limit) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Image is too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Bad request.'); }
}

async function handleTranscribe(req, res) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
  const body = await readJson(req, Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 1024);
  const { image, mediaType } = body || {};
  if (typeof image !== 'string' || !IMAGE_TYPES.has(mediaType)) throw new HttpError(400, 'Send a JPEG, PNG, WebP or GIF image.');
  if (Buffer.byteLength(image, 'base64') > MAX_IMAGE_BYTES) throw new HttpError(413, 'Image is larger than 5 MB.');
  checkRateLimit(ip);
  sendJson(res, 200, await transcribe(image, mediaType));
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(404, 'Not found');
  const data = await fs.readFile(file).catch(() => { throw new HttpError(404, 'Not found'); });
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(data);
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/transcribe') await handleTranscribe(req, res);
    else if (req.method === 'GET') await serveStatic(req, res);
    else throw new HttpError(405, 'Method not allowed');
  } catch (err) {
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
    if (err instanceof ApiError) {
      console.error(`Gemini ${err.status}: ${err.message}`);
      if (err.status === 429) return sendJson(res, 429, { error: 'The free AI limit is used up for now.' });
      if ([400, 401, 403].includes(err.status)) return sendJson(res, 500, { error: 'The server is not set up correctly.' });
      return sendJson(res, 502, { error: 'The AI service returned an error.' });
    }
    console.error(err);
    sendJson(res, 500, { error: 'Something went wrong.' });
  }
}).listen(PORT, () => console.log(`Lisan typer on http://localhost:${PORT}`));
