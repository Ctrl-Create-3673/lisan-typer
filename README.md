# Lisan Typer

**Live site:** https://ctrl-create-3673.github.io/lisan-typer/

Upload pictures of Lisan-ud-Dawat text. The page reads them with OCR inside your browser and shows the text in the **Al-Kanz**, **Kanz-al-Yaqoot** and **Kanz-al-Lulu** fonts, together with the keys to press on the **AL Fatemi** Arabic keyboard layout.

No API key, no server and no uploads: reading uses [Tesseract.js](https://github.com/naptha/tesseract.js) with its Urdu and Arabic models. The first reading downloads the models (about 25 MB, then cached by the browser).

- **Al-Kanz view:** the exact characters the AL Fatemi keyboard types. Al-Kanz draws doubled letters as Lisan-ud-Dawat letters (`ضض` → ٹ, `ثث` → پ, `حح` → چ, `سس` → ے, `كك` → گ, `طط` → ں), and `ر` + `ٌ` as ڑ.
- **Yaqoot / Lulu views:** the same text in standard Unicode (ٹ ڑ پ چ ے ں ھ).
- **Keystrokes:** type them on an English keyboard with the AL Fatemi layout switched on. A capital letter or symbol means hold Shift. `[EN:word]` means switch to English for that word.
- **Fix the text:** OCR often confuses Lisan-ud-Dawat letters (چ/ج, گ/ك, ھ/ه) and cannot read English words. Correct them here; the view and keystrokes update as you type.

## Run it locally

Any static file server works, for example:

```bash
npx serve docs
```

Opening `docs/index.html` straight from disk does not work, because browsers block module scripts on `file://`.

## Hosting

GitHub Pages serves the `docs/` folder of the `main` branch (Settings → Pages). Pushing to `main` updates the site.

## Files

| File | What it does |
|---|---|
| `docs/index.html` | The page |
| `docs/app.js` | Upload, OCR, results, copy buttons |
| `docs/keymap.js` | AL Fatemi key map and the Unicode → keyboard text → keystrokes conversion |
| `test.js` | `npm test`: checks the key map against a passage verified in Al-Kanz |

## Known limits

- OCR is far less accurate than reading by eye: expect to fix several words per paragraph, and English words.
- The keyboard PDF shows ر on the C key; this app types ؤ with C, as on the standard Arabic layout, because nothing else on the layout types ؤ.
- ﴿ ﴾ are not on the layout; insert them as symbols.
- In Al-Kanz, ں straight after و (as in چھوں) shows a small extra mark, and ڈ shows a plain mark instead of a small ط.

## Fonts

Al-Kanz, Kanz-al-Yaqoot and Kanz-al-Lulu belong to their owners and are included only to display the text. Check their licences before reusing them.
