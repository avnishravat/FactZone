const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const inputDir = path.join(__dirname, '../raw-images');
const outputDir = path.join(__dirname, '../assets/images/posts');

// Ensure directories exist on clean checkout
if (!fs.existsSync(inputDir)) fs.mkdirSync(inputDir, { recursive: true });
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

async function convertImages() {
    try {
        const files = fs.readdirSync(inputDir);
        const validExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];

        if (files.length === 0) {
            console.log('[INFO] No raw images found in raw-images/ folder. Skipping conversion.');
            return;
        }

        for (const file of files) {
            const ext = path.extname(file).toLowerCase();
            if (validExtensions.includes(ext)) {
                const inputPath = path.join(inputDir, file);
                const fileName = path.parse(file).name;
                const outputPath = path.join(outputDir, `${fileName}.webp`);

                try {
                    // Google Discover Standard: 1200x675 px (16:9 ratio)
                    await sharp(inputPath)
                        .resize(1200, 675, {
                            fit: 'cover',
                            position: 'center'
                        })
                        .webp({
                            quality: 80,
                            effort: 6
                        })
                        .toFile(outputPath);

                    console.log(`[SUCCESS] Converted: ${file} -> ${fileName}.webp (1200x675px)`);
                    fs.unlinkSync(inputPath);
                } catch (err) {
                    console.error(`[ERROR] Failed converting ${file}:`, err.message);
                }
            }
        }
    } catch (err) {
        console.error('[ERROR] Directory read failed:', err.message);
    }
}

convertImages();
