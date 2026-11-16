import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pinned, local build inputs. No CDN, model download, or telemetry when a customer scans a passport.
const require = createRequire(import.meta.url);
const destination = fileURLToPath(new URL('../public/mdac-ocr/', import.meta.url));
await mkdir(destination, { recursive: true });
const tesseract = dirname(require.resolve('tesseract.js/package.json'));
const core = dirname(require.resolve('tesseract.js-core/package.json'));
const modelDirectory = fileURLToPath(new URL('../vendor/mdac-ocr/', import.meta.url));
const manifest = JSON.parse(await readFile(join(modelDirectory, 'manifest.json'), 'utf8'));
const modelPath = join(modelDirectory, 'ocrb_int.traineddata.gz');
const checksum = createHash('sha256')
    .update(await readFile(modelPath))
    .digest('hex');
if (checksum !== manifest.sha256) throw new Error('MDAC OCR-B model checksum mismatch');
const birthModelDirectory = fileURLToPath(new URL('../vendor/mdac-birth-ocr/', import.meta.url));
const birthManifest = JSON.parse(await readFile(join(birthModelDirectory, 'manifest.json'), 'utf8'));
const birthModelPath = join(birthModelDirectory, 'eng.traineddata.gz');
if (
    createHash('sha256')
        .update(await readFile(birthModelPath))
        .digest('hex') !== birthManifest.sha256
) {
    throw new Error('MDAC birthplace model checksum mismatch');
}
await Promise.all([
    copyFile(join(tesseract, 'dist/worker.min.js'), join(destination, 'worker.min.js')),
    copyFile(join(tesseract, 'LICENSE.md'), join(destination, 'TESSERACT-LICENSE')),
    copyFile(join(core, 'LICENSE'), join(destination, 'CORE-LICENSE')),
    copyFile(modelPath, join(destination, 'ocrb_int.traineddata.gz')),
    copyFile(join(modelDirectory, 'LICENSE'), join(destination, 'OCRB-LICENSE')),
    copyFile(join(modelDirectory, 'manifest.json'), join(destination, 'OCRB-MANIFEST.json')),
    copyFile(birthModelPath, join(destination, 'eng.traineddata.gz')),
    copyFile(join(birthModelDirectory, 'LICENSE'), join(destination, 'BIRTHPLACE-LICENSE')),
    copyFile(join(birthModelDirectory, 'manifest.json'), join(destination, 'BIRTHPLACE-MANIFEST.json')),
    ...['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'].map(file =>
        copyFile(join(core, file), join(destination, file)),
    ),
]);
for (const obsolete of ['tesseract-core.wasm.js', 'tesseract-core-simd.wasm.js']) {
    await unlink(join(destination, obsolete)).catch(error => {
        if (error.code !== 'ENOENT') throw error;
    });
}
process.stdout.write('Prepared same-origin MDAC OCR resources.\n');
