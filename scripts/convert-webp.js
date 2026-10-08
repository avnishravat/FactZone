const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const inputFolder = './src/assets/raw-images';
const outputFolder = './public/images';

if (!fs.existsSync(outputFolder)) {
  fs.mkdirSync(outputFolder, { recursive: true });
}

fs.readdirSync(inputFolder).forEach(file => {
  if (file.match(/\.(jpg|jpeg|png)$/i)) {
    const fileName = path.parse(file).name;
    
    sharp(`${inputFolder}/${file}`)
      .resize(1200, 675, {         // Exact 16:9 Discover banner size
        fit: 'cover',              // Image stretched nahi hogi, properly crop hogi
        position: 'center'
      })
      .webp({ quality: 80 })       // Super sharp quality under 150 KB
      .toFile(`${outputFolder}/${fileName}.webp`)
      .then(() => console.log(`Discover-ready WebP created: ${fileName}.webp`))
      .catch(err => console.error(`Error processing ${file}:`, err));
  }
});
