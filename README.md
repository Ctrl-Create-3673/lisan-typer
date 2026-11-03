# Lisan Ul Dawat Typer

**Live site:** https://ctrl-create-3673.github.io/lisan-typer/

Upload pictures or PDF files of Lisan-ud-Dawat text. The page reads them with OCR inside your browser and shows the text in the **Al-Kanz**, **Kanz-al-Lulu** and **Kanz-al-Yaqoot** fonts, line for line as in the original. Copy it for Al-Kanz or Kanz-al-Lulu, or export it to Word or PDF. Designed by Ctrl + Create.

No API key, no server, no outside AI and no image uploads: reading uses [Tesseract.js](https://github.com/naptha/tesseract.js) in the browser with **our own model**, `docs/tessdata/lsd.traineddata.gz` (1 MB). It is Tesseract's Urdu model fine-tuned on about 25,000 lines rendered in Al-Kanz, Kanz-al-Yaqoot and Kanz-al-Lulu: synthetic lines plus real Lisan-ud-Dawat documents typed with the AL Fatemi keyboard (doubled-letter forms, ؛ for چھے, اْ), plus 4,000 lines with small raised honorifics (ع، عم، تع، رض، طع …). English words, which the model reads as digits, are re-read with Tesseract's English model. Small raised letters (Word superscript, e.g. خداتع, ابراهيمع) are found from their position and kept raised. The first reading downloads the models (then cached by the browser).

Exact words read correctly (stock Urdu model in brackets):

| Test | Our model |
|---|---|
| Original screenshot, with English pass (round 3) | 94% (58–62%) |
| Held-out document never trained on, Al-Kanz | 92% (28%) |
| Same document, Kanz-al-Yaqoot | 97% (60%) |
| Test lines with raised honorifics read exactly | 6 of 12 (0 of 12 before round 4) |

Signed-in users (Google account) can **save** texts and reopen or delete them later under **My saved texts**.

- **Al-Kanz:** the exact characters the AL Fatemi keyboard types. Al-Kanz draws doubled letters as Lisan-ud-Dawat letters (`ضض` → ٹ, `ثث` → پ, `حح` → چ, `سس` → ے, `كك` → گ, `طط` → ں), `ر` + `ٌ` as ڑ and `؛` as چھے.
- **Kanz-al-Lulu / Kanz-al-Yaqoot:** the same text in standard Unicode (ٹ ڑ پ چ ے ں ھ).
- **Copy:** rich text, so Word keeps the font and raised letters; plain text elsewhere.
- **Export to Word:** a .docx in the chosen font, right-to-left, raised letters as superscript. **Export to PDF:** the browser's print dialog (choose *Save as PDF*), which keeps the real font.
- **PDF files:** every page is shown and read as its own card (pdf.js 4.10.38 in `docs/vendor/pdfjs`).
- **Fix the text:** correct any word; small raised letters go between `^` marks, e.g. `خدا^تع^`.

## Run it locally

Any static file server works, for example:

```bash
npx serve docs
```

Opening `docs/index.html` straight from disk does not work, because browsers block module scripts on `file://`.

## Hosting

GitHub Pages serves the `docs/` folder of the `main` branch (Settings → Pages). Pushing to `main` updates the site.

## Google sign-in (Firebase, free)

Sign-in and saving stay hidden until `docs/firebase-config.js` has a config.

1. Go to https://console.firebase.google.com, **Create a project** (Google Analytics not needed).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable**, pick a support email, **Save**.
3. **Authentication → Settings → Authorized domains → Add domain**: `ctrl-create-3673.github.io`.
4. **Build → Firestore Database → Create database** (any location, production mode). Open **Rules**, replace them with the rules below, **Publish**.
5. **Project settings (gear) → Your apps → Web (`</>`)**, register an app (no hosting), and copy the `firebaseConfig` object into `docs/firebase-config.js`.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/texts/{doc} {
      allow read, delete: if request.auth != null && request.auth.uid == uid;
      allow create, update: if request.auth != null && request.auth.uid == uid
        && request.resource.data.keys().hasOnly(['title', 'text', 'updatedAt'])
        && request.resource.data.title is string && request.resource.data.title.size() <= 200
        && request.resource.data.text is string && request.resource.data.text.size() <= 100000;
    }
  }
}
```

The config values are public by design; these rules are what keep every user's texts private to them.

## Files

| File | What it does |
|---|---|
| `docs/index.html` | The page |
| `docs/app.js` | Upload (images, PDF), OCR (our model, English re-read, raised letters), copy, Word/PDF export, saved list |
| `docs/img/` | Ctrl + Create logo and icons |
| `docs/vendor/pdfjs/` | pdf.js, served from the site so its worker can start |
| `docs/tessdata/lsd.traineddata.gz` | Our Kanz-font reading model (Tesseract LSTM, integer, gzipped) |
| `docs/cloud.js` | Google sign-in and saved texts (Firebase Auth + Firestore) |
| `docs/firebase-config.js` | Your Firebase web app config (`null` = sign-in off) |
| `docs/keymap.js` | AL Fatemi key map: Unicode → the keyboard text Al-Kanz expects |
| `test.js` | `npm test`: checks the key map against a passage verified in Al-Kanz |

## Known limits

- Roughly 1 word in 10–20 still needs fixing, most often words with آ written as اْ and the small ج marker. Photos of printed pages and other fonts read much worse than clean screenshots in the three Kanz fonts. Coloured text is read but its colour is not kept.
- The keyboard PDF shows ر on the C key; this app types ؤ with C, as on the standard Arabic layout, because nothing else on the layout types ؤ.
- ﴿ ﴾ are not on the layout; insert them as symbols.
- In Al-Kanz, ں straight after و (as in چھوں) shows a small extra mark, and ڈ shows a plain mark instead of a small ط.

## Training the reader

The training scripts live outside this repo (`~/lsd-ocr-training`, `run_all.sh`): they render practice lines from word lists and the AL Fatemi-typed documents, fine-tune `tessdata_best/urd` with `lstmtraining`, and test on a document kept out of training.

## Fonts

Al-Kanz, Kanz-al-Yaqoot and Kanz-al-Lulu belong to their owners and are included only to display the text. Check their licences before reusing them.
