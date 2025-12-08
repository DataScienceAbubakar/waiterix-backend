const fs = require('fs');
const response = JSON.parse(fs.readFileSync('response.json', 'utf8'));
console.log(response.errorMessage);
