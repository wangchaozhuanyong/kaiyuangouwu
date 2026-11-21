import { useEffect, useRef } from 'react';

import { type StorefrontLanguage } from '../../types';

// The drawing uses a fixed coordinate system and scales to the visible canvas.
function rounded(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    fill: string | CanvasGradient | null,
    outline?: string,
    weight = 1,
) {
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, width, height, radius);
    } else {
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + width, y, x + width, y + height, radius);
        ctx.arcTo(x + width, y + height, x, y + height, radius);
        ctx.arcTo(x, y + height, x, y, radius);
        ctx.arcTo(x, y, x + width, y, radius);
        ctx.closePath();
    }
    if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
    }
    if (outline) {
        ctx.lineWidth = weight;
        ctx.strokeStyle = outline;
        ctx.stroke();
    }
}

function linear(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    stops: ReadonlyArray<readonly [number, string]>,
) {
    const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
    for (const [at, color] of stops) gradient.addColorStop(at, color);
    return gradient;
}

function browserScreen(ctx: CanvasRenderingContext2D, progress: number, scanning: boolean, english: boolean) {
    const panel = linear(ctx, 8, 8, 252, 151, [
        [0, '#fffef4'],
        [0.64, '#fcf9e9'],
        [1, '#eaeada'],
    ]);
    rounded(ctx, 8, 9, 244, 137, 5, panel);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = '#e6e2c9';
    ctx.fillRect(8, 9, 244, 19);
    ['#c3835e', '#c3a34a', '#819a7a'].forEach((color, index) => {
        rounded(ctx, 15 + index * 7, 16, 4.5, 4.5, 2, color);
    });
    rounded(ctx, 51, 13, 141, 10, 4, '#fdfbef', '#cecab5', 0.5);
    ctx.fillStyle = '#817e66';
    ctx.font = '7px ui-monospace, Menlo, monospace';
    ctx.fillText(english ? 'Environment check' : '环境检测', 61, 20.5);
    for (let y = 15; y <= 21; y += 3) {
        ctx.fillRect(234, y, 10, 0.9);
    }
    ctx.fillStyle = '#485646';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillText(english ? 'Browser signals' : '浏览器信号', 19, 46);
    const areas = english
        ? ['Timezone', 'Language', 'Fonts', 'Browser']
        : ['系统时区', '浏览器语言', '字体特征', '浏览器环境'];
    const stage = Math.min(3, Math.floor(progress * 4));
    // These marks illustrate the overall progress. Individual signal outcomes are shown in the report.
    areas.forEach((label, i) => {
        const y = 54 + i * 18;
        const active = scanning && stage === i;
        const read = progress >= (i + 1) / 4;
        if (active) rounded(ctx, 14, y, 134, 16, 3.5, '#f7e7ae');
        rounded(ctx, 20, y + 5, 6, 6, 2, read ? '#7a8c67' : active ? '#ad7b25' : '#e6e2cc', '#a3a58c', 0.65);
        ctx.fillStyle = '#535e4e';
        ctx.font = '9px system-ui, sans-serif';
        ctx.fillText(label, 31, y + 11);
        rounded(ctx, 98, y + 7, 36, 2.5, 1, '#e8e3ca');
        if (read || active) {
            const fraction = read ? 1 : (progress * 4) % 1;
            rounded(ctx, 98, y + 7, Math.max(1, 36 * fraction), 2.5, 1, '#c39d50');
        }
    });
    rounded(ctx, 156, 39, 82, 85, 6, '#ecf0df', '#cad1b8', 0.7);
    // A processor glyph on a printed circuit, with traces through the browser panel.
    ctx.save();
    ctx.translate(196.5, 81.5);
    ctx.lineCap = 'round';
    for (let side = 0; side < 4; side++) {
        for (let pin = -2; pin <= 2; pin++) {
            const x = pin * 4.3;
            const bend = 22 + Math.abs(pin) * 2.8;
            ctx.beginPath();
            ctx.moveTo(x, -15);
            ctx.lineTo(x, -bend);
            ctx.lineTo(x + pin * 3.5, -bend - 4);
            ctx.lineTo(x + pin * 3.5, -33);
            ctx.strokeStyle = '#92a489';
            ctx.lineWidth = 0.85;
            ctx.stroke();
            rounded(ctx, x + pin * 3.5 - 1.2, -34.1, 2.4, 2.4, 1, '#b0934f');
        }
        ctx.rotate(Math.PI / 2);
    }
    rounded(ctx, -17, -17, 34, 34, 3.5, '#8c997a', '#708066');
    rounded(ctx, -12, -12, 24, 24, 2.5, '#d4dabb', '#fbf6ce');
    rounded(ctx, -7, -7, 14, 14, 1.5, '#c2a368', '#a28c56', 0.7);
    ctx.restore();
    if (scanning) {
        const x = 9 + progress * 243;
        const beam = linear(ctx, x - 28, 0, x + 2, 0, [
            [0, '#e9bc4400'],
            [0.86, '#f5cf5869'],
            [1, '#fff1bfcc'],
        ]);
        ctx.fillStyle = beam;
        ctx.fillRect(x - 28, 28, 30, 116);
        ctx.fillStyle = '#c49635';
        ctx.fillRect(x, 28, 1.1, 116);
    }
    rounded(ctx, 19, 133, 217, 3, 1.5, '#dedfc9');
    if (progress > 0) rounded(ctx, 19, 133, Math.max(2, 217 * progress), 3, 1.5, '#ab8743');
    ctx.restore();
}

const keyWidths = [
    Array<number>(14).fill(1),
    [1.3, ...Array<number>(12).fill(1), 1.5],
    [1.5, ...Array<number>(11).fill(1), 1.8],
    [1.9, ...Array<number>(10).fill(1), 2.1],
    [1.1, 1.1, 1.15, 1.3, 6, 1.25, 1.1, 1.1, 1.1],
];

function keyboardDeck(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.transform(1, 0.108, -0.72, 0.54, 130, 167);
    // The front lip, palm rest, and keys share the same perspective plane.
    rounded(ctx, 0, 5, 260, 108, 7, '#b9a374', '#93855f', 1.2);
    const aluminium = linear(ctx, 0, 0, 210, 110, [
        [0, '#bfae86'],
        [0.27, '#efdfb7'],
        [0.63, '#e4d4a9'],
        [1, '#c8b78b'],
    ]);
    rounded(ctx, 0, 0, 260, 108, 7, aluminium, '#ab986e', 1.3);
    rounded(ctx, 4, 2, 252, 103, 6, null, '#fff4d2', 0.9);
    rounded(ctx, 13, 10, 233, 61, 4, '#ad9f7f', '#a09372', 0.8);
    keyWidths.forEach((row, r) => {
        const gap = 2.1;
        const unit = (224 - (row.length - 1) * gap) / row.reduce((sum, size) => sum + size, 0);
        let x = 18;
        const y = 14 + r * 11;
        for (const size of row) {
            const w = unit * size;
            rounded(ctx, x, y + 1, w, 8.3, 1.5, '#807c66');
            rounded(ctx, x, y, w, 7.7, 1.5, r === 0 ? '#d8d2b8' : '#f2ebcd', '#a69c7a', 0.6);
            if (size < 1.6) rounded(ctx, x + 2.7, y + 2.6, 2.6, 0.8, 0.3, '#a59b7a');
            x += w + gap;
        }
    });
    rounded(ctx, 85, 76, 81, 24, 3, '#dfcea5', '#b3a17b', 1);
    rounded(ctx, 87, 77, 77, 21, 2, null, '#eedeaf', 0.7);
    rounded(ctx, 107, 104, 48, 3, 1.5, '#a39370');
    ctx.restore();
}

function paintComputer(ctx: CanvasRenderingContext2D, progress: number, scanning: boolean, english: boolean) {
    ctx.save();
    ctx.translate(221, 223);
    ctx.scale(1, 0.145);
    const shadow = ctx.createRadialGradient(0, 0, 18, 0, 0, 161);
    shadow.addColorStop(0, '#7863375c');
    shadow.addColorStop(0.64, '#8771423a');
    shadow.addColorStop(1, '#927e4b00');
    ctx.fillStyle = shadow;
    ctx.fillRect(-162, -162, 324, 324);
    ctx.restore();
    // The display is almost face-on so the browser remains recognizable on a phone.
    ctx.save();
    ctx.transform(1, 0.108, -0.072, 0.935, 141, 21);
    rounded(ctx, 2.2, 1.8, 260, 154, 8, '#ac9970', '#978461', 1);
    const rim = linear(ctx, 0, 0, 160, 154, [
        [0, '#ffefc9'],
        [0.45, '#c7b58d'],
        [1, '#8b8164'],
    ]);
    rounded(ctx, 0, 0, 260, 154, 8, rim, '#9d8b60', 1.1);
    rounded(ctx, 4, 4, 252, 145, 6, '#515b4e', '#747c67', 1);
    browserScreen(ctx, progress, scanning, english);
    rounded(ctx, 128, 5.5, 3.2, 2, 1, '#b7bbaa');
    ctx.restore();
    keyboardDeck(ctx);
}

export function EnvironmentMonitorIllustration({
    language,
    progress,
    running,
}: {
    language: StorefrontLanguage;
    progress: number;
    running: boolean;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const paintedProgress = useRef(0);
    const english = language === 'en';

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || typeof CanvasRenderingContext2D === 'undefined') {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
        const target = Math.min(100, Math.max(0, progress)) / 100;
        const prior = paintedProgress.current;
        let frame = 0;

        function draw(value: number) {
            if (!canvas || !ctx) {
                return;
            }
            const { width, height } = canvas.getBoundingClientRect();
            if (!width || !height) {
                return;
            }
            const density = Math.min(window.devicePixelRatio || 1, 2);
            const pixelWidth = Math.round(width * density);
            const pixelHeight = Math.round(height * density);
            if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
                canvas.width = pixelWidth;
                canvas.height = pixelHeight;
            }
            const scale = Math.min(width / 396, height / 255);
            ctx.setTransform(density, 0, 0, density, 0, 0);
            ctx.clearRect(0, 0, width, height);
            ctx.translate(width / 2 - 237 * scale, height / 2 - 134 * scale);
            ctx.scale(scale, scale);
            paintComputer(ctx, reducedMotion.matches ? 0 : value, running && !reducedMotion.matches, english);
        }

        const redraw = () => draw(paintedProgress.current);
        const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(redraw) : undefined;
        resize?.observe(canvas);
        window.addEventListener('resize', redraw);

        function applyMotionPreference() {
            cancelAnimationFrame(frame);
            paintedProgress.current = target;
            redraw();
        }

        reducedMotion.addEventListener('change', applyMotionPreference);
        if (running && !reducedMotion.matches && target > prior) {
            const start = performance.now();
            function advance(now: number) {
                // Ease between actual progress updates. A stalled scan never advances on its own.
                const time = Math.min(1, (now - start) / 210);
                paintedProgress.current = prior + (target - prior) * (1 - (1 - time) ** 3);
                redraw();
                if (time < 1) {
                    frame = requestAnimationFrame(advance);
                }
            }
            redraw();
            frame = requestAnimationFrame(advance);
        } else {
            applyMotionPreference();
        }

        return () => {
            cancelAnimationFrame(frame);
            resize?.disconnect();
            window.removeEventListener('resize', redraw);
            reducedMotion.removeEventListener('change', applyMotionPreference);
        };
    }, [english, progress, running]);

    return (
        <figure
            className="environment-instrument"
            data-phase={running ? 'scan' : progress > 0 ? 'settled' : 'idle'}
        >
            <div className="environment-instrument-surface" aria-hidden="true">
                <canvas ref={canvasRef} />
            </div>
            <figcaption className="type-meta">
                <span className="environment-instrument-title">
                    {english ? 'Computer and browser check' : '电脑与浏览器检测'}
                </span>
                <span className="environment-instrument-readout" aria-hidden="true">
                    {english ? `Progress ${progress}%` : `检测进度 ${progress}%`}
                </span>
            </figcaption>
        </figure>
    );
}
