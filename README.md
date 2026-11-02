# Lisan Typer

Upload pictures of Lisan-ud-Dawat text. Claude reads them and the site shows the text in the **Al-Kanz**, **Kanz-al-Yaqoot** and **Kanz-al-Lulu** fonts, together with the keys to press on the **AL Fatemi** Arabic keyboard layout.

- **Al-Kanz view:** the exact characters the AL Fatemi keyboard types. Al-Kanz draws doubled letters as Lisan-ud-Dawat letters (`ضض` → ٹ, `ثث` → پ, `حح` → چ, `سس` → ے, `كك` → گ, `طط` → ں), and `ر` + `ٌ` as ڑ.
- **Yaqoot / Lulu views:** the same text in standard Unicode (ٹ ڑ پ چ ے ں ھ).
- **Keystrokes:** type them on an English keyboard with the AL Fatemi layout switched on. A capital letter or symbol means hold Shift. `[EN:word]` means switch to English for that word.
- **Fix the text:** edit the AI's reading; the view and keystrokes update as you type.

## Run it locally

Needs Node.js 22.9 or newer and an [Anthropic API key](https://console.anthropic.com/).

```bash
npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
npm start
```

Open http://localhost:3000.

## Deploy

The server keeps your API key secret and pays for every visitor's image, so it has to run on a host that runs Node, not GitHub Pages. For example, on [Render](https://render.com):

1. New → Web Service → connect this GitHub repo.
2. Build command `npm install`, start command `npm start`.
3. Add the environment variable `ANTHROPIC_API_KEY`.

Optional settings:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on (most hosts set this for you) |
| `RATE_LIMIT_PER_HOUR` | `30` | Images each visitor IP may send per hour, to protect your API bill |

Set a monthly spend limit on your Anthropic account as well: anyone who finds the site can use it.

## How it works

| File | What it does |
|---|---|
| `server.js` | Serves `public/` and `POST /api/transcribe`: sends one image to `claude-opus-5-5` and returns the text as segments (coloured text flagged) |
| `public/keymap.js` | AL Fatemi key map and the Unicode → keyboard text → keystrokes conversion |
| `public/app.js` | Upload, image shrinking, results, copy buttons |
| `test.js` | `npm test`: checks the key map against a passage verified in Al-Kanz |

## Known limits

- The AI can misread words. Use **Fix the text** before copying.
- The keyboard PDF shows ر on the C key; this app types ؤ with C, as on the standard Arabic layout, because nothing else on the layout types ؤ.
- ﴿ ﴾ are not on the layout; insert them as symbols.
- In Al-Kanz, ں straight after و (as in چھوں) shows a small extra mark, and ڈ shows a plain mark instead of a small ط.

## Fonts

Al-Kanz, Kanz-al-Yaqoot and Kanz-al-Lulu belong to their owners and are included only to display the text. Check their licences before reusing them.
