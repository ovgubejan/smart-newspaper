const http = require('http');
const fs = require('fs');

const html = `<!DOCTYPE html>
<html>
<head>
  <style>
    body { background: white; color: black; font-size: 50px; }
    .page { width: 210mm; height: 297mm; background: #eee; margin: 0 auto; display: flex; flex-direction: column; }
    @media print {
      @page { size: A4 portrait; margin: 0; }
      .page { margin: 0; page-break-after: always; }
    }
  </style>
</head>
<body>
  <div class="page">HELLO WORLD THIS IS A TEST PDF FROM SERVER ENDPOINT</div>
</body>
</html>`;

const data = JSON.stringify({ html });

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/export-pdf',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = http.request(options, res => {
  console.log(`STATUS: ${res.statusCode}`);
  const chunks = [];
  res.on('data', chunk => chunks.push(chunk));
  res.on('end', () => {
    if (res.statusCode === 200) {
      fs.writeFileSync('test_server_output.pdf', Buffer.concat(chunks));
      console.log('Saved to test_server_output.pdf');
    } else {
      console.log('Error:', Buffer.concat(chunks).toString());
    }
  });
});

req.on('error', e => {
  console.error(`Problem with request: ${e.message}`);
});

req.write(data);
req.end();
