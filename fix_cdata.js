const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

const OLD = `  return match ? decodeHtml(match[1]) : "";`;
const NEW = `  if (!match) return "";
  // Strip CDATA wrappers used by CNN Turk, Sozcu etc: <![CDATA[...]]>
  const raw = match[1];
  const cdataMatch = raw.match(/^\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*$/);
  const val = cdataMatch ? cdataMatch[1].trim() : raw.trim();
  return decodeHtml(val);`;

if (code.includes(OLD)) {
  code = code.replace(OLD, NEW);
  fs.writeFileSync('server.js', code, 'utf8');
  console.log('SUCCESS: CDATA fix applied to extractXmlTag');
} else {
  console.log('Pattern not found. Searching...');
  code.split('\n').forEach((l, i) => {
    if (l.includes('decodeHtml')) console.log(i+1, l);
  });
}
