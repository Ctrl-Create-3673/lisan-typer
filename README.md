# Lisan Typer

**Live site:** https://ctrl-create-3673.github.io/lisan-typer/

Upload pictures of Lisan-ud-Dawat text. The page reads them with OCR inside your browser and shows the text in the **Al-Kanz**, **Kanz-al-Yaqoot** and **Kanz-al-Lulu** fonts, together with the keys to press on the **AL Fatemi** Arabic keyboard layout.

No API key, no server, no outside AI and no image uploads: reading uses [Tesseract.js](https://github.com/naptha/tesseract.js) in the browser with **our own model**, `docs/tessdata/lsd.traineddata.gz` (1 MB). It is Tesseract's Urdu model fine-tuned on 14,000 lines rendered in Al-Kanz, Kanz-al-Yaqoot and Kanz-al-Lulu (including the AL Fatemi doubled-letter forms). A second English pass puts back English words. The first reading downloads the models (then cached by the browser).

On the test screenshot it reads 91% of words exactly right (stock Urdu model: 58–62%). The test passage's words were part of the training vocabulary (not its lines or image), so expect somewhat lower on other texts.

Signed-in users (Google account) can **save** texts and reopen or delete them later under **My saved texts**.

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
| `docs/app.js` | Upload, OCR (our model + English pass), results, copy and save buttons, saved list |
| `docs/tessdata/lsd.traineddata.gz` | Our Kanz-font reading model (Tesseract LSTM, integer, gzipped) |
| `docs/cloud.js` | Google sign-in and saved texts (Firebase Auth + Firestore) |
| `docs/firebase-config.js` | Your Firebase web app config (`null` = sign-in off) |
| `docs/keymap.js` | AL Fatemi key map and the Unicode → keyboard text → keystrokes conversion |
| `test.js` | `npm test`: checks the key map against a passage verified in Al-Kanz |

## Known limits

- About 1 word in 10 still needs fixing; چھے is the most common slip (read as چه or چے). Photos of printed pages and other fonts read much worse than clean screenshots in the three Kanz fonts. Coloured text is read but its colour is not kept.
- The keyboard PDF shows ر on the C key; this app types ؤ with C, as on the standard Arabic layout, because nothing else on the layout types ؤ.
- ﴿ ﴾ are not on the layout; insert them as symbols.
- In Al-Kanz, ں straight after و (as in چھوں) shows a small extra mark, and ڈ shows a plain mark instead of a small ط.

## Fonts

Al-Kanz, Kanz-al-Yaqoot and Kanz-al-Lulu belong to their owners and are included only to display the text. Check their licences before reusing them.
