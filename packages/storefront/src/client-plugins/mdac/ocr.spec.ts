// @vitest-environment jsdom
import { createWorker } from 'tesseract.js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { readPassport } from './ocr';

const worker = vi.hoisted(() => ({
    setParameters: vi.fn().mockResolvedValue(undefined),
    recognize: vi.fn(),
    reinitialize: vi.fn(),
    terminate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('tesseract.js', () => ({
    createWorker: vi.fn().mockResolvedValue(worker),
    PSM: { SINGLE_BLOCK: '6', SPARSE_TEXT: '11', SINGLE_LINE: '7' },
}));
const sample = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10';
const file = () => new File(['synthetic'], 'sample.png', { type: 'image/png' });
beforeEach(() => {
    vi.mocked(createWorker)
        .mockReset()
        .mockResolvedValue(worker as never);
    worker.recognize.mockReset();
    worker.reinitialize.mockReset().mockRejectedValue(new Error('Optional body model unavailable'));
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 80, height: 60, close: vi.fn() }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        drawImage: vi.fn(),
        fillRect: vi.fn(),
        putImageData: vi.fn(),
        getImageData: (_x: number, _y: number, width: number, height: number) => ({
            width,
            height,
            data: new Uint8ClampedArray(width * height * 4).fill(255),
        }),
    } as never);
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

it('releases the canvas and worker when recognition is cancelled while pending', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 800, height: 600, close }));
    worker.recognize.mockReturnValue(new Promise(() => undefined));
    const controller = new AbortController();
    const pending = readPassport(
        new File(['synthetic'], 'sample.png', { type: 'image/png' }),
        controller.signal,
    );
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(worker.recognize).toHaveBeenCalled());
    const canvas = worker.recognize.mock.calls[0][0] as HTMLCanvasElement;
    controller.abort();
    await assertion;
    expect(canvas.width).toBe(0);
    expect(close).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalled();
});

it('retries a failed crop without relaxing checks and returns only verified fields', async () => {
    worker.recognize
        .mockResolvedValueOnce({ data: { text: sample.replace('L898902C36', 'L898902C35') } })
        .mockResolvedValueOnce({ data: { text: sample } });
    const result = await readPassport(file(), new AbortController().signal);
    expect(result).toMatchObject({ name: 'ERIKSSON ANNA MARIA', passNo: 'L898902C3' });
    expect(worker.recognize).toHaveBeenCalledTimes(2);
    expect(worker.recognize.mock.calls[0][1]).toEqual({ rotateAuto: true });
    expect(worker.terminate).toHaveBeenCalledOnce();
});

it('rejects invalid checksums after the bounded crop attempts', async () => {
    worker.recognize.mockResolvedValue({ data: { text: sample.replace('L898902C36', 'L898902C35') } });
    await expect(readPassport(file(), new AbortController().signal)).rejects.toThrow('recognition');
    expect(worker.recognize).toHaveBeenCalledTimes(3);
    expect(worker.terminate).toHaveBeenCalledOnce();
});

it('cancels while the model loads and releases a worker which finishes loading later', async () => {
    let loaded!: (value: typeof worker) => void;
    vi.mocked(createWorker).mockReturnValueOnce(
        new Promise(resolve => {
            loaded = resolve;
        }) as never,
    );
    const controller = new AbortController();
    const pending = readPassport(file(), controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(createWorker).toHaveBeenCalled());
    controller.abort();
    await assertion;
    loaded(worker);
    await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalledOnce());
    expect(worker.recognize).not.toHaveBeenCalled();
    expect(createImageBitmap).not.toHaveBeenCalled();
});

it('does not start recognition for a non-image', async () => {
    await expect(
        readPassport(
            new File(['synthetic'], 'test.txt', { type: 'text/plain' }),
            new AbortController().signal,
        ),
    ).rejects.toThrow('image');
    expect(worker.recognize).not.toHaveBeenCalled();
});

const birthLabel = {
    blocks: [
        {
            paragraphs: [
                {
                    lines: [
                        {
                            words: [
                                { text: 'Place', confidence: 95, bbox: { x0: 60, y0: 15, x1: 90, y1: 25 } },
                                { text: 'of', confidence: 95, bbox: { x0: 93, y0: 15, x1: 105, y1: 25 } },
                                { text: 'birth', confidence: 95, bbox: { x0: 108, y0: 15, x1: 135, y1: 25 } },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
};

it('reads birthplace only from its labelled visual field after checking the MRZ', async () => {
    worker.reinitialize.mockResolvedValue(undefined);
    worker.recognize
        .mockResolvedValueOnce({ data: { text: sample, rotateRadians: 0.02 } })
        .mockResolvedValueOnce({ data: birthLabel })
        .mockResolvedValueOnce({ data: { text: 'SICHUAN', confidence: 95 } });
    const fields = await readPassport(file(), new AbortController().signal);
    expect(fields.pob).toBe('CHN');
    expect(fields.nationality).toBe('UTO');
    expect(worker.recognize.mock.calls[2][1]).toMatchObject({
        rotateRadians: 0.02,
        rectangle: expect.any(Object),
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
});

it('keeps verified passport fields when birthplace cannot be read confidently', async () => {
    worker.reinitialize.mockResolvedValue(undefined);
    worker.recognize
        .mockResolvedValueOnce({ data: { text: sample } })
        .mockResolvedValueOnce({ data: birthLabel })
        .mockResolvedValueOnce({ data: { text: 'SICHUAN', confidence: 40 } })
        .mockResolvedValueOnce({ data: { blocks: [] } });
    const fields = await readPassport(file(), new AbortController().signal);
    expect(fields.passNo).toBe('L898902C3');
    expect(fields).not.toHaveProperty('pob');
});

it('does not substitute Chinese nationality or issuer for a foreign birthplace', async () => {
    worker.reinitialize.mockResolvedValue(undefined);
    worker.recognize
        .mockResolvedValueOnce({ data: { text: sample.replaceAll('UTO', 'CHN') } })
        .mockResolvedValueOnce({ data: birthLabel })
        .mockResolvedValueOnce({ data: { text: 'USA', confidence: 96 } });
    expect(await readPassport(file(), new AbortController().signal)).toMatchObject({
        nationality: 'CHN',
        pob: 'USA',
    });
});

it('cancels during birthplace recognition without returning late MRZ results', async () => {
    worker.reinitialize.mockResolvedValue(undefined);
    worker.recognize
        .mockResolvedValueOnce({ data: { text: sample } })
        .mockImplementationOnce(() => new Promise(() => undefined));
    const controller = new AbortController();
    const pending = readPassport(file(), controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(worker.recognize).toHaveBeenCalledTimes(2));
    controller.abort();
    await assertion;
    expect(worker.terminate).toHaveBeenCalled();
});
