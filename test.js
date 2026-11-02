// Self-test: npm test
import assert from 'node:assert/strict';
import { toKeyboardText, toKeystrokes, fromKeystrokes } from './docs/keymap.js';

// Passage checked by eye against the Al-Kanz rendering of the reference image.
const unicode = 'دل ني دھڑكن نا سبب جسم نا اعضاء سلامة رہے چھے، تو پڑھاؤنار واسطے دل نا محل ما كون چھے، دل گھني محنة كري نے سگلا اعضاء نے خون پہنچاوے چھے، يہ} مثل ايك جوئيے كہ ميں كئي نتھي ْايو، بلكہ پڑھوا نے } ْايو چھوں';
const keyboard = 'دل ني دهرٌكن نا سبب جسم نا اعضاء سلامة رهسس ححهسس، تو ثثرٌهاؤنار واسطسس دل نا محل ما كون ححهسس، دل ككهني محنة كري نسس سككلا اعضاء نسس خون ثثهنححاوسس ححهسس، يه} مثل ايك جوئيسس كه ميطط كئي نتهي ْايو، بلكه ثثرٌهوا نسس } ْايو ححهوطط';

assert.equal(toKeyboardText(unicode), keyboard);
const keys = toKeystrokes(keyboard);
assert.equal(keys.slice(0, 22), ']g kd ]ivR;k kh sff [s');
assert.ok(!keys.includes('[?'), keys);
assert.equal(fromKeystrokes(keys), keyboard); // every keystroke maps back

assert.equal(toKeystrokes('سلامة organs 1448'), 'sblm [EN:organs] 1448');
assert.equal(toKeystrokes(toKeyboardText('١٤٤٨ ﴿')), '1448 [Insert ▸ Symbol ﴿]');
assert.equal(toKeystrokes('¤'), '[?¤]');
console.log('keymap ok');
