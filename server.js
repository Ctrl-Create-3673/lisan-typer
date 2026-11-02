// Serves public/ and POST /api/transcribe, which sends one image to Claude.
// The API key stays here on the server: set ANTHROPIC_API_KEY (or put it in .env).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

const PORT = Number(process.env.PORT) || 3000;
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_HOUR) || 30; // images per visitor IP per hour
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Claude's per-image limit
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const client = new Anthropic();

const Transcription = z.object({
  segments: z.array(z.object({
    text: z.string(),
    highlighted: z.boolean().describe('true when this text is coloured (e.g. red) in the image'),
  })),
});

const SYSTEM = `You transcribe images of Lisan-ud-Dawat text: the Dawoodi Bohra language, Gujarati-based and written in Arabic script, often mixed with Arabic, Urdu and English words.

Copy the text exactly as written. Do not translate, correct, complete or normalise spelling, and do not add anything that is not in the image.

Letters:
- Use ٹ ڈ ڑ پ چ گ ے ں where the image shows them, ھ for the two-eyed aspirate h (دھ، چھ، گھ، پڑھ), and ہ or ه as shown.
- Keep Arabic ي and ك where the image uses them; use ک only where the image shows the Urdu form.
- A small raised ج written after a word (an emphatic particle, as in یہج or نے ج): output the single character } in its place.
- A short vertical tick written just before an alif (as in 'ايو): output ْ (U+0652) directly before the alif.
- Keep English words in Latin letters, digits as they appear, ornate brackets as ﴿ ﴾, and quotation marks, ellipses and the Arabic comma ، as written.

Layout: join lines that only wrap with a single space; use \\n only where a new paragraph or a new line of verse starts.
Colour: put text that is coloured differently from the body text (for example red) in its own segment with highlighted: true; all other text has highlighted: false.
If the image contains no Lisan-ud-Dawat or Arabic-script text, return an empty segments list.`;

async function transcribe(image, mediaType) {
  const response = await client.beta.messages.parse({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    output_config: { effort: 'high', format: betaZodOutputFormat(Transcription) },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
        { type: 'text', text: 'Transcribe the text in this image.' },
      ],
    }],
  });
  if (response.stop_reason === 'refusal') throw new HttpError(422, 'The AI declined to read this image.');
  if (response.stop_reason === 'max_tokens') throw new HttpError(422, 'The text is too long for one image. Crop it into smaller parts.');
  if (!response.parsed_output) throw new HttpError(502, 'The AI returned an unreadable answer. Please try again.');
  return response.parsed_output;
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
    if (err instanceof Anthropic.RateLimitError) return sendJson(res, 503, { error: 'The AI service is busy. Please try again in a minute.' });
    if (err instanceof Anthropic.AuthenticationError) { console.error('Invalid ANTHROPIC_API_KEY'); return sendJson(res, 500, { error: 'The server is not set up correctly.' }); }
    if (err instanceof Anthropic.APIConnectionError) return sendJson(res, 502, { error: 'Could not reach the AI service. Please try again.' });
    if (err instanceof Anthropic.APIError) { console.error(err); return sendJson(res, 502, { error: 'The AI service returned an error. Please try again.' }); }
    console.error(err);
    sendJson(res, 500, { error: 'Something went wrong.' });
  }
}).listen(PORT, () => console.log(`Lisan typer on http://localhost:${PORT}`));
