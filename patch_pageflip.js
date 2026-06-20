const fs = require('fs');

let content = fs.readFileSync('js/components/eGazeteMode.js', 'utf8');

// Replace stretch with fixed and adjust dimensions
content = content.replace(/width: 600,\s*height: 850,\s*size: "stretch",/g, 'width: 794,\n        height: 1123,\n        size: "fixed",');

// Also ensure that the previous printPdf is correctly patched, just in case.
fs.writeFileSync('js/components/eGazeteMode.js', content, 'utf8');
console.log('eGazeteMode.js stretch patched');
