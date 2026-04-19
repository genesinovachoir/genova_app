const fs = require('fs');
const path = require('path');

const inputPath = path.join(process.cwd(), 'public/lottie/player music.json');
const outputPath = path.join(process.cwd(), 'public/lottie/player music dark.json');

const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

function invertColors(obj) {
  if (Array.isArray(obj)) {
    // Check if it's a color array [r, g, b] or [r, g, b, a]
    // Normalized Lottie colors are usually 0-1
    if (obj.length >= 3 && obj.every(v => typeof v === 'number' && v >= 0 && v <= 1)) {
      if (obj[0] === 1 && obj[1] === 1 && obj[2] === 1) {
        // White -> Black
        obj[0] = 0; obj[1] = 0; obj[2] = 0;
      } else if (obj[0] === 0 && obj[1] === 0 && obj[2] === 0) {
        // Black -> White
        obj[0] = 1; obj[1] = 1; obj[2] = 1;
      }
    }
    obj.forEach(invertColors);
  } else if (obj && typeof obj === 'object') {
    Object.values(obj).forEach(invertColors);
  }
}

invertColors(data);

fs.writeFileSync(outputPath, JSON.stringify(data));
console.log('Inverted Lottie saved to:', outputPath);
