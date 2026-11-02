// AL Fatemi keyboard layout (see the "Arabic keyboard" PDF) + Al-Kanz font conventions.
// Shared by the browser (app.js) and the self-test (test.js).

// Letters the layout has no key for. Al-Kanz draws a doubled letter as the
// Lisan-ud-Dawat letter (ضض → ٹ), and ر + ٌ as ڑ, so we type those instead.
const TO_KEYBOARD = {
  'پ': 'ثث', 'چ': 'حح', 'ے': 'سس', 'ۓ': 'ئسس', 'گ': 'كك', 'ٹ': 'ضض', 'ں': 'طط', 'ٮ': 'صص',
  'ڑ': 'رٌ', 'ڈ': 'دٌ', 'ک': 'ك', 'ی': 'ي', 'ۃ': 'ة',
  'ھ': 'ه', 'ہ': 'ه', 'ۂ': 'ه', 'ۀ': 'ه', // Al-Kanz picks the ھ / ہ shape from context
};
for (let d = 0; d < 10; d++) {
  // Al-Kanz draws ASCII digits as Arabic-Indic ones
  TO_KEYBOARD[String.fromCharCode(0x660 + d)] = String(d);
  TO_KEYBOARD[String.fromCharCode(0x6f0 + d)] = String(d);
}

// Character → key to press on a US keyboard with the layout active.
// Uppercase letters and shifted symbols mean "hold Shift".
const KEYS = {
  // normal (green cells, page 1)
  'ض': 'q', 'ص': 'w', 'ث': 'e', 'ق': 'r', 'ف': 't', 'غ': 'y', 'ع': 'u', 'ه': 'i', 'خ': 'o', 'ح': 'p', 'ج': '[', 'د': ']', 'ذ': '\\',
  'ش': 'a', 'س': 's', 'ي': 'd', 'ب': 'f', 'ل': 'g', 'ا': 'h', 'ت': 'j', 'ن': 'k', 'م': 'l', 'ك': ';', 'ط': "'",
  'ئ': 'z', 'ء': 'x', 'ؤ': 'c', 'ر': 'v', 'ى': 'n', 'ة': 'm', 'و': ',', 'ز': '.', 'ظ': '/',
  // Shift (blue cells, page 2)
  'َ': 'Q', 'ً': 'W', 'ُ': 'E', 'ٌ': 'R', 'إ': 'Y', '‘': 'U', '÷': 'I', '×': 'O', '؛': 'P', '}': '{', '{': '}', 'ّ': '|',
  '\\': 'A', '[': 'D', ']': 'F', 'أ': 'H', 'ـ': 'J', '،': 'K', '/': 'L', ':': ':', '"': '"',
  '~': 'Z', 'ْ': 'X', 'ِ': 'C', 'ٍ': 'V', 'آ': 'N', '’': 'M', ',': '<', '.': '>', '؟': '?',
  ' ': ' ', '\n': '\n',
};
const LIGATURES = { 'لا': 'b', 'لأ': 'G', 'لإ': 'T', 'لآ': 'B' }; // one key types both letters

// Standard Unicode Lisan-ud-Dawat → the exact characters the keyboard produces.
export function toKeyboardText(text) {
  // چھے has its own key: Shift+P types ؛, which Al-Kanz draws as چھے
  return [...text.replace(/چ[هھ]ے/g, '؛')].map((c) => TO_KEYBOARD[c] ?? c).join('');
}

// For Kanz-al-Yaqoot / Kanz-al-Lulu, which have the real letters but draw a
// final ہ oddly; plain ه takes the right shape from context.
export function toUnicodeDisplay(text) {
  return text.replace(/[ہۂ]/g, 'ه');
}

// Keyboard text → keystrokes. English runs become [EN:word]; anything the
// layout cannot type becomes [?x] so it is never silently dropped.
export function toKeystrokes(kbText) {
  let out = '';
  for (let i = 0; i < kbText.length; ) {
    const latin = /^[A-Za-z]+/.exec(kbText.slice(i));
    if (latin) { out += `[EN:${latin[0]}]`; i += latin[0].length; continue; }
    const lig = LIGATURES[kbText.slice(i, i + 2)];
    if (lig) { out += lig; i += 2; continue; }
    const c = kbText[i];
    if (/[0-9]/.test(c)) out += c;
    else if (c === '﴿' || c === '﴾') out += `[Insert ▸ Symbol ${c}]`;
    else out += KEYS[c] ?? `[?${c}]`;
    i += 1;
  }
  return out;
}

// Keystrokes → keyboard text, for the self-test (English/unknown markers excluded).
export function fromKeystrokes(keys) {
  const rev = Object.fromEntries(Object.entries(KEYS).map(([c, k]) => [k, c]));
  for (const [pair, k] of Object.entries(LIGATURES)) rev[k] = pair;
  return [...keys].map((k) => (/[0-9]/.test(k) ? k : rev[k])).join('');
}
