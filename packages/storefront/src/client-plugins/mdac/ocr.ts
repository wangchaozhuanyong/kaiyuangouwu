import { birthCountry, birthRectangle } from './birthplace';
import { isIsoDate, malaysiaToday, type Fields } from './model';
import { extractMrzLines, normalizeOcrText, parseMRZ } from './mrz-parser.js';
import { drawMrzCandidate, imageContentBounds } from './ocr-image';

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException('Recognition cancelled', 'AbortError'));
        if (signal.aborted) {
            abort();
            return;
        }
        signal.addEventListener('abort', abort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}

function verifiedPassport(text: string) {
    const normalized = normalizeOcrText(text);
    const lines = normalized.split('\n');
    const pairs = lines.slice(0, -1).map((line, index) => [line, lines[index + 1]]);
    pairs.push(extractMrzLines(normalized));
    // Page text can also be 44 characters long. Require a passport header and the
    // complete data line before asking the unchanged upstream parser to check it.
    let result: ReturnType<typeof parseMRZ> | undefined;
    for (const [header, data] of pairs) {
        if (
            !/^P[A-Z<][A-Z<]{3}[A-Z<]{35,39}$/.test(header ?? '') ||
            !header.includes('<<') ||
            data?.length !== 44
        )
            continue;
        const parsed = parseMRZ([header, data]);
        if (parsed.valid && parsed.format === 'TD3 passport') {
            result = parsed;
            break;
        }
    }
    if (!result) throw new Error('recognition');
    return result;
}

export function passportFields(text: string, today = malaysiaToday()): Fields {
    const result = verifiedPassport(text);
    // Upstream uses a fixed 1960–2059 pivot. Correct future birthdays in the adapter.
    let dob = result.birthDate;
    if (dob > today) dob = `${Number(dob.slice(0, 4)) - 100}${dob.slice(4)}`;
    if (!isIsoDate(dob) || !isIsoDate(result.expirationDate)) throw new Error('date');
    return {
        name: [result.surname, result.givenNames].join(' ').trim(),
        passNo: result.documentNumber,
        nationality: result.nationality,
        dob,
        passExpDte: result.expirationDate,
        sex: result.sex === 'M' ? '1' : result.sex === 'F' ? '2' : '',
    };
}

/** Image pixels remain in this browser. All OCR resources are served from our origin. */
export async function readPassport(file: File, signal: AbortSignal): Promise<Fields> {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 10 * 1024 * 1024) {
        throw new Error('image');
    }
    const { createWorker, PSM } = await import('tesseract.js');
    signal.throwIfAborted();
    // The OCR-B model is trained for passport MRZ fonts, including '<' separators.
    const workerPromise = createWorker('ocrb_int', 1, {
        workerBlobURL: false,
        workerPath: '/mdac-ocr/worker.min.js',
        corePath: '/mdac-ocr',
        langPath: '/mdac-ocr',
        cacheMethod: 'none',
        logger: () => undefined,
    });
    // Loading the worker/model can outlive a cancelled scan too.
    void workerPromise.then(
        readyWorker => {
            if (signal.aborted) void readyWorker.terminate();
        },
        () => undefined,
    );
    const worker = await untilAborted(workerPromise, signal);
    const cancel = () => {
        void worker.terminate();
    };
    signal.addEventListener('abort', cancel, { once: true });
    const canvas = document.createElement('canvas');
    const candidate = document.createElement('canvas');
    try {
        signal.throwIfAborted();
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('canvas');
        const bitmap = await createImageBitmap(file);
        try {
            signal.throwIfAborted();
            const width = Math.round(
                bitmap.width * Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height)),
            );
            canvas.width = width;
            canvas.height = Math.round((bitmap.height * width) / bitmap.width);
            context.fillStyle = 'white';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        } finally {
            bitmap.close();
        }
        signal.throwIfAborted();
        await worker.setParameters({
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
            preserve_interword_spaces: '1',
            tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        });
        const bounds = imageContentBounds(context.getImageData(0, 0, canvas.width, canvas.height));
        let fields: Fields | undefined;
        let issuer = '';
        let rotation = 0;
        // A spread/page normally has the MRZ near its bottom. Include a full-image fallback
        // for already-cropped MRZ images. Attempts are bounded by the page's abort/timeout.
        for (const fraction of [0.24, 0.4, 1]) {
            signal.throwIfAborted();
            drawMrzCandidate(canvas, candidate, bounds, fraction);
            const { data } = await untilAborted(worker.recognize(candidate, { rotateAuto: true }), signal);
            signal.throwIfAborted();
            try {
                fields = passportFields(data.text);
                issuer = verifiedPassport(data.text).issuingCountry;
                rotation = data.rotateRadians ?? 0;
                break;
            } catch {
                // Re-read a different crop; never repair numbers to force a checksum match.
            }
        }
        if (!fields) throw new Error('recognition');
        // The visual birth field is optional OCR. A failed label/model read must
        // not discard the independently verified MRZ fields or infer nationality.
        try {
            await untilAborted(worker.reinitialize('eng', 1), signal);
            for (const fraction of [0.5, 1]) {
                signal.throwIfAborted();
                drawMrzCandidate(canvas, candidate, bounds, fraction, 1800, 4);
                await worker.setParameters({
                    tessedit_pageseg_mode: PSM.SPARSE_TEXT,
                    tessedit_char_whitelist: '',
                });
                const { data } = await untilAborted(
                    worker.recognize(candidate, { rotateRadians: rotation }, { text: true, blocks: true }),
                    signal,
                );
                signal.throwIfAborted();
                const words =
                    data.blocks?.flatMap(block =>
                        block.paragraphs.flatMap(paragraph => paragraph.lines.flatMap(line => line.words)),
                    ) ?? [];
                const rectangle = birthRectangle(words, candidate.width, candidate.height, issuer);
                if (!rectangle) continue;
                await worker.setParameters({
                    tessedit_pageseg_mode: PSM.SINGLE_LINE,
                    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz /.-',
                });
                const value = await untilAborted(
                    worker.recognize(candidate, { rotateRadians: rotation, rectangle }),
                    signal,
                );
                signal.throwIfAborted();
                const pob = birthCountry(value.data.text, value.data.confidence);
                if (pob) return { ...fields, pob };
            }
        } catch {
            signal.throwIfAborted();
        }
        return fields;
    } finally {
        canvas.width = canvas.height = 0;
        candidate.width = candidate.height = 0;
        signal.removeEventListener('abort', cancel);
        await worker.terminate();
    }
}
