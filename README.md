# Lisan Typer

Upload pictures of Lisan-ud-Dawat text. AI reads them and the page shows the text in the **Al-Kanz**, **Kanz-al-Yaqoot** and **Kanz-al-Lulu** fonts, line for line as in the image, together with the keys to press on the **AL Fatemi** Arabic keyboard layout.

Reading uses Google Gemini (`gemini-3.6-flash`) on its **free tier**: no card, no cost, but a daily request limit, and Google may use free-tier images to improve its products. When the AI is unavailable (no server, limit used up, error) the page falls back to free OCR in the browser ([Tesseract.js](https://github.com/naptha/tesseract.js), Urdu model plus an English pass), which is much less accurate.

Signed-in users (Google account) can **save** texts and reopen or delete them later under **My saved texts**.

- **Al-Kanz view:** the exact characters the AL Fatemi keyboard types. Al-Kanz draws doubled letters as Lisan-ud-Dawat letters (`ضض` → ٹ, `ثث` → پ, `حح` → چ, `سس` → ے, `كك` → گ, `طط` → ں), and `ر` + `ٌ` as ڑ.
- **Yaqoot / Lulu views:** the same text in standard Unicode (ٹ ڑ پ چ ے ں ھ).
- **Keystrokes:** type them on an English keyboard with the AL Fatemi layout switched on. A capital letter or symbol means hold Shift. `[EN:word]` means switch to English for that word.
- **Fix the text:** correct any misread word here; the view and keystrokes update as you type.

## Free Gemini key

1. Go to https://aistudio.google.com/apikey and sign in with Google.
2. **Create API key** and copy it.

The key must stay secret: it lives only on the server (`.env` locally, or the host's environment settings), never in `docs/`.

## Run it locally

Needs Node.js 22.9 or newer.

```bash
npm install
echo "GEMINI_API_KEY=your-key" > .env
npm start
```

Open http://localhost:3000. Without `GEMINI_API_KEY` the server stops at startup and says so.

## Hosting (free, on Render)

1. https://render.com → sign in with GitHub → **New → Web Service** → pick this repo.
2. Build command `npm install`, start command `npm start`, instance type **Free**.
3. **Environment → Add Environment Variable**: `GEMINI_API_KEY` = your key.
4. Deploy. Render gives you the public link. On the free plan the site sleeps when unused, so the first visit after a break takes about a minute.

| Variable | Default | Meaning |
|---|---|---|
| `GEMINI_API_KEY` | (required) | Free key from Google AI Studio |
| `GEMINI_MODEL` | `gemini-3.6-flash` | Gemini model to use |
| `RATE_LIMIT_PER_HOUR` | `30` | Images each visitor IP may send per hour, so one person can't use up the daily free limit |

The GitHub Pages copy (https://ctrl-create-3673.github.io/lisan-typer/) has no server, so it always uses the free OCR reader.

## Google sign-in (Firebase, free)

Sign-in and saving stay hidden until `docs/firebase-config.js` has a config.

1. Go to https://console.firebase.google.com, **Create a project** (Google Analytics not needed).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable**, pick a support email, **Save**.
3. **Authentication → Settings → Authorized domains → Add domain**: your site's domain (e.g. `lisan-typer.onrender.com`, and `ctrl-create-3673.github.io` for the Pages copy).
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
| `server.js` | Serves `docs/` and `POST /api/transcribe`, which sends one image to Gemini |
| `docs/index.html` | The page |
| `docs/app.js` | Upload, AI reading with OCR fallback, line layout, copy and save buttons, saved list |
| `docs/cloud.js` | Google sign-in and saved texts (Firebase Auth + Firestore) |
| `docs/firebase-config.js` | Your Firebase web app config (`null` = sign-in off) |
| `docs/keymap.js` | AL Fatemi key map and the Unicode → keyboard text → keystrokes conversion |
| `test.js` | `npm test`: checks the key map against a passage verified in Al-Kanz |

## Known limits

- The AI can still misread a word now and then; check before copying. The OCR fallback gets only about 6 words in 10 exactly right and loses colours.
- The keyboard PDF shows ر on the C key; this app types ؤ with C, as on the standard Arabic layout, because nothing else on the layout types ؤ.
- ﴿ ﴾ are not on the layout; insert them as symbols.
- In Al-Kanz, ں straight after و (as in چھوں) shows a small extra mark, and ڈ shows a plain mark instead of a small ط.

## Fonts

Al-Kanz, Kanz-al-Yaqoot and Kanz-al-Lulu belong to their owners and are included only to display the text. Check their licences before reusing them.
