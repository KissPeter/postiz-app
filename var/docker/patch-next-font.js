// Google Fonts sometimes answers next/font's CSS request with extension-less
// font URLs (https://fonts.gstatic.com/l/font?kit=...). Next 14's loader then
// crashes on `.exec(url)[1]` of null. These files are woff2, so default to it.
const fs = require('fs');
const file =
  process.argv[2] ||
  '/app/node_modules/next/dist/compiled/@next/font/dist/google/loader.js';
const from = "/\\.(woff|woff2|eot|ttf|otf)$/.exec(googleFontFileUrl)[1]";
const to =
  "(/\\.(woff|woff2|eot|ttf|otf)$/.exec(googleFontFileUrl) || [null, 'woff2'])[1]";
const src = fs.readFileSync(file, 'utf8');
if (src.includes(to)) process.exit(0);
if (!src.includes(from)) {
  console.error('patch-next-font: pattern not found in ' + file);
  process.exit(1);
}
fs.writeFileSync(file, src.replace(from, to));
console.log('patch-next-font: patched ' + file);
