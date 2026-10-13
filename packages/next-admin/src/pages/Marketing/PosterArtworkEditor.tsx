import { useMemo, useRef, useState, type PointerEvent } from 'react';
import {
    DEFAULT_ARTWORK_POSTER_DESIGN,
    POSTER_QR_STYLES,
    validateArtworkPosterDesign,
    type ArtworkPosterDesign,
} from '../../../../common/src/referral-poster-design';
import { createCircularQrSvgDataUrl } from '../../../../storefront/src/poster-qr';
import { renderPosterDesignGuide } from '../../../../storefront/src/referral-poster-layout';
import { AdminButton } from '../../components/AdminControls';
import { resizeArtworkCanvas } from './poster-artwork-helpers';
import { FormSelect, NumberField } from './referral-ui';

const PREVIEW_LINK = 'https://store.example/register?ref=PREVIEW&source=POSTER';
const PRESETS = [
    ['9:16', 1080, 1920],
    ['3:4', 1080, 1440],
    ['1:1', 1080, 1080],
] as const;

export function PosterArtworkEditor({
    design,
    onChange,
    backgroundUrl,
    onError,
}: {
    design: ArtworkPosterDesign;
    onChange: (design: ArtworkPosterDesign) => void;
    backgroundUrl?: string;
    onError: (message: string) => void;
}) {
    const stage = useRef<HTMLDivElement>(null);
    const drag = useRef<{
        mode: 'move' | 'resize';
        x: number;
        y: number;
        design: ArtworkPosterDesign;
    } | null>(null);
    const thumbnails = useMemo(
        () =>
            POSTER_QR_STYLES.map(style => ({
                ...style,
                image: createCircularQrSvgDataUrl(PREVIEW_LINK, style.id, 456),
            })),
        [],
    );
    const [customSize, setCustomSize] = useState(false);
    const validation = validateArtworkPosterDesign(design);
    const preset = customSize
        ? 'custom'
        : (PRESETS.find(
              ([, width, height]) => width === design.canvas.width && height === design.canvas.height,
          )?.[0] ?? 'custom');
    const updateQr = (value: Partial<ArtworkPosterDesign['qr']>) =>
        onChange({ ...design, qr: { ...design.qr, ...value } });
    const start = (event: PointerEvent<HTMLButtonElement>, mode: 'move' | 'resize') => {
        if (event.button !== 0 || validation) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { mode, x: event.clientX, y: event.clientY, design };
    };
    const move = (event: PointerEvent<HTMLButtonElement>) => {
        const previous = drag.current;
        const bounds = stage.current?.getBoundingClientRect();
        if (!previous || !bounds?.width) return;
        const scale = previous.design.canvas.width / bounds.width;
        const dx = (event.clientX - previous.x) * scale;
        const dy = (event.clientY - previous.y) * scale;
        const qr = previous.design.qr;
        if (previous.mode === 'move') {
            const r = qr.diameter / 2;
            updateQr({
                centerX: Math.round(
                    Math.max(Math.ceil(r), Math.min(Math.floor(design.canvas.width - r), qr.centerX + dx)),
                ),
                centerY: Math.round(
                    Math.max(Math.ceil(r), Math.min(Math.floor(design.canvas.height - r), qr.centerY + dy)),
                ),
            });
        } else {
            const maximum =
                2 *
                Math.min(
                    qr.centerX,
                    qr.centerY,
                    design.canvas.width - qr.centerX,
                    design.canvas.height - qr.centerY,
                );
            updateQr({ diameter: Math.round(Math.max(360, Math.min(maximum, qr.diameter + dx * 2))) });
        }
    };
    const end = () => {
        drag.current = null;
    };
    return (
        <section className="sm:col-span-2 space-y-4" aria-label="整图海报规格">
            <h3 className="text-xs font-bold text-slate-700">02 · 画布与固定圆位</h3>
            <FormSelect
                label="海报规格"
                value={preset}
                onChange={value => {
                    setCustomSize(value === 'custom');
                    const target = PRESETS.find(([id]) => id === value);
                    if (target) onChange(resizeArtworkCanvas(design, target[1], target[2]));
                }}
                options={[
                    ['9:16', '9:16 · 1080×1920'],
                    ['3:4', '3:4 · 1080×1440'],
                    ['1:1', '1:1 · 1080×1080'],
                    ['custom', '自定义（编辑宽高）'],
                ]}
            />
            <div className="grid gap-3 sm:grid-cols-2">
                <NumberField
                    label="画布宽度 (px)"
                    value={design.canvas.width}
                    min={720}
                    max={4096}
                    step={1}
                    onChange={width => onChange({ ...design, canvas: { ...design.canvas, width } })}
                />
                <NumberField
                    label="画布高度 (px)"
                    value={design.canvas.height}
                    min={720}
                    max={4096}
                    step={1}
                    onChange={height => onChange({ ...design, canvas: { ...design.canvas, height } })}
                />
                <NumberField
                    label="圆心 X (px)"
                    value={design.qr.centerX}
                    min={0}
                    max={4096}
                    step={1}
                    onChange={centerX => updateQr({ centerX })}
                />
                <NumberField
                    label="圆心 Y (px)"
                    value={design.qr.centerY}
                    min={0}
                    max={4096}
                    step={1}
                    onChange={centerY => updateQr({ centerY })}
                />
                <NumberField
                    label="圆形直径 (px)"
                    value={design.qr.diameter}
                    min={360}
                    max={4096}
                    step={1}
                    onChange={diameter => updateQr({ diameter })}
                />
            </div>
            <p className="text-xs text-slate-500">
                拖动圆盘定位，拖动右侧手柄调整尺寸；也可精确输入。图片、文字避开白色圆盘区域。
            </p>
            {!validation && (
                <div
                    ref={stage}
                    className="relative mx-auto w-full max-w-[260px] overflow-hidden rounded-lg bg-slate-100"
                    style={{ aspectRatio: `${design.canvas.width} / ${design.canvas.height}` }}
                    data-testid="poster-position-stage"
                >
                    {backgroundUrl && (
                        <img
                            src={backgroundUrl}
                            alt="设计图圆位定位底图"
                            draggable={false}
                            className="absolute inset-0 h-full w-full object-contain"
                        />
                    )}
                    <div
                        className="absolute"
                        style={{
                            left: `${((design.qr.centerX - design.qr.diameter / 2) / design.canvas.width) * 100}%`,
                            top: `${((design.qr.centerY - design.qr.diameter / 2) / design.canvas.height) * 100}%`,
                            width: `${(design.qr.diameter / design.canvas.width) * 100}%`,
                            aspectRatio: '1',
                        }}
                    >
                        <AdminButton
                            type="button"
                            aria-label="拖动二维码圆位"
                            className="h-full w-full touch-none cursor-move rounded-full p-0 focus-visible:ring-2 focus-visible:ring-blue-600"
                            onPointerDown={event => start(event, 'move')}
                            onPointerMove={move}
                            onPointerUp={end}
                            onPointerCancel={end}
                            onKeyDown={event => {
                                const delta = event.shiftKey ? 10 : 1;
                                const offsets: Record<string, [number, number]> = {
                                    ArrowLeft: [-delta, 0],
                                    ArrowRight: [delta, 0],
                                    ArrowUp: [0, -delta],
                                    ArrowDown: [0, delta],
                                };
                                const offset = offsets[event.key];
                                if (!offset) return;
                                event.preventDefault();
                                const next = {
                                    ...design,
                                    qr: {
                                        ...design.qr,
                                        centerX: design.qr.centerX + offset[0],
                                        centerY: design.qr.centerY + offset[1],
                                    },
                                };
                                if (!validateArtworkPosterDesign(next)) onChange(next);
                            }}
                        >
                            <img
                                src={thumbnails.find(style => style.id === design.qr.style)?.image}
                                alt="测试二维码圆形区域"
                                className="pointer-events-none h-full w-full"
                                draggable={false}
                            />
                        </AdminButton>
                        <AdminButton
                            type="button"
                            aria-label="拖动调整二维码直径"
                            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 touch-none cursor-ew-resize rounded-full bg-blue-600 p-2 text-xs text-white"
                            onPointerDown={event => start(event, 'resize')}
                            onPointerMove={move}
                            onPointerUp={end}
                            onPointerCancel={end}
                            onKeyDown={event => {
                                const delta =
                                    event.key === 'ArrowRight' ? 10 : event.key === 'ArrowLeft' ? -10 : 0;
                                if (!delta) return;
                                event.preventDefault();
                                const next = {
                                    ...design,
                                    qr: { ...design.qr, diameter: design.qr.diameter + delta },
                                };
                                if (!validateArtworkPosterDesign(next)) onChange(next);
                            }}
                        >
                            ↔
                        </AdminButton>
                    </div>
                </div>
            )}
            {validation && (
                <p role="alert" className="text-xs text-rose-600">
                    {validation}
                </p>
            )}
            <div className="flex flex-wrap gap-2">
                <AdminButton
                    type="button"
                    disabled={Boolean(validation)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700"
                    onClick={() => {
                        try {
                            const link = document.createElement('a');
                            link.href = renderPosterDesignGuide(design);
                            link.download = `poster-guide-${design.canvas.width}x${design.canvas.height}.png`;
                            link.click();
                        } catch (reason) {
                            onError(reason instanceof Error ? reason.message : '参考图生成失败');
                        }
                    }}
                >
                    下载留位参考图
                </AdminButton>
                <AdminButton
                    type="button"
                    className="rounded-lg px-3 py-2 text-xs text-slate-600"
                    onClick={() => onChange(structuredClone(DEFAULT_ARTWORK_POSTER_DESIGN))}
                >
                    恢复默认规格
                </AdminButton>
            </div>
            <h3 className="text-xs font-bold text-slate-700">03 · 圆形二维码款式</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {thumbnails.map(style => (
                    <AdminButton
                        key={style.id}
                        type="button"
                        aria-pressed={design.qr.style === style.id}
                        onClick={() => updateQr({ style: style.id })}
                        className={`rounded-lg border p-2 text-xs ${design.qr.style === style.id ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600'}`}
                    >
                        <img src={style.image} alt="" className="mx-auto mb-1 h-20 w-20" />
                        {style.name}
                    </AdminButton>
                ))}
            </div>
            <p className="text-xs text-slate-500">
                五款样式共用当前圆位；商品分享继承本店默认模板的二维码样式。
            </p>
        </section>
    );
}
