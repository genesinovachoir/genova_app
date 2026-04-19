const fs = require('fs');
const path = require('path');

const lightPath = path.join(__dirname, '../public/lottie/paperplane-light.json');
const darkPath = path.join(__dirname, '../public/lottie/paperplane-dark.json');

const colors = {
  amber: {
    base: [0.753, 0.698, 0.514, 1],
    mid: [0.587, 0.544, 0.401, 1],
    dark: [0.444, 0.412, 0.303, 1]
  },
  navy: {
    base: [0.1, 0.15, 0.4, 1],
    mid: [0.078, 0.117, 0.312, 1],
    dark: [0.059, 0.088, 0.236, 1]
  },
  gray: {
    light: [0.9, 0.9, 0.9, 1],
    dark: [0.15, 0.15, 0.15, 1]
  }
};

function updateLottie(filePath, planeColors, lineColors) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const assets = data.assets || [];

  assets.forEach(asset => {
    (asset.layers || []).forEach(layer => {
      // Background Lines (Group 4 and 5)
      if (layer.nm.includes('Group 5') || layer.nm.includes('Group 4')) {
        layer.shapes.forEach(shape => {
          shape.it.forEach(item => {
            if (item.ty === 'fl') {
              item.c.k = lineColors;
            }
          });
        });
      }

      // Merged Shape Layer (The Plane Body)
      if (layer.nm === 'Merged Shape Layer') {
        layer.shapes.forEach(group => {
          if (group.nm.includes('Group 3')) { // Top
            group.it.forEach(sub => {
              sub.it?.forEach(item => { if (item.ty === 'fl') item.c.k = planeColors.base; });
            });
          }
          if (group.nm.includes('Group 2')) { // Side
            group.it.forEach(sub => {
              sub.it?.forEach(item => { if (item.ty === 'fl') item.c.k = planeColors.mid; });
            });
          }
          if (group.nm.includes('Group 1')) { // Inner
            group.it.forEach(sub => {
              sub.it?.forEach(item => { if (item.ty === 'fl') item.c.k = planeColors.dark; });
            });
          }
        });
      }
    });
  });

  fs.writeFileSync(filePath, JSON.stringify(data));
  console.log(`Updated ${path.basename(filePath)}`);
}

// Light Mode: Amber Plane + Navy Lines
updateLottie(lightPath, colors.amber, colors.navy.base);

// Dark Mode: Navy Plane + Amber Lines
updateLottie(darkPath, colors.navy, colors.amber.base);
