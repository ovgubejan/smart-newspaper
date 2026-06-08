const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'js', 'app.js');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

function findMatches(pattern) {
  console.log(`\nMatches for: ${pattern}`);
  const regex = new RegExp(pattern, 'i');
  lines.forEach((line, idx) => {
    if (regex.test(line)) {
      console.log(`${idx + 1}: ${line.trim().slice(0, 120)}`);
    }
  });
}

findMatches('activeVersion');
