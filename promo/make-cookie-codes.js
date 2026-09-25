// Prints redeemable cookie codes for the in-game REDEEM CODE box, e.g. to paste
// into itch.io's "reward" / download notes after someone buys a cookie pack.
//   node promo/make-cookie-codes.js B 20      -> twenty COOKIE JAR codes
// Packs: A HANDFUL 120 | B COOKIE JAR 700 | C COOKIE BARREL 1600 | D GOLDEN TIN 3500
// Must match CODE_SALT / CODE_ABC / codeCheck() in game.js. Codes are checked
// in the browser, so treat them as a thank-you, not real payment security.
const crypto = require('crypto');
const CODE_SALT = 'wombaton-bitedown-cookies';
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function fnv32(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
function codeCheck(pack, body) { const h = fnv32(pack + body + CODE_SALT); return CODE_ABC[h % 32] + CODE_ABC[(h >>> 5) % 32]; }

const pack = (process.argv[2] || 'A').toUpperCase(), n = +process.argv[3] || 10;
if (!'ABCD'.includes(pack) || pack.length !== 1) { console.error('pack must be A, B, C or D'); process.exit(1); }
for (let i = 0; i < n; i++) {
  let body = '';
  for (const b of crypto.randomBytes(6)) body += CODE_ABC[b % 32];
  console.log('BD' + pack + '-' + body + '-' + codeCheck(pack, body));
}
