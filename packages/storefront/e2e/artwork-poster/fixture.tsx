import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReferralPosterTemplate } from '../../src/types';

import { DEFAULT_ARTWORK_POSTER_DESIGN, POSTER_QR_STYLES } from '../../../common/src/referral-poster-design';
import {
    posterLayoutFields,
    renderPosterDesignGuide,
    renderReferralPoster,
    type PosterCopy,
} from '../../src/referral-poster-layout';
import { ReferralPosterModal } from '../../src/referral-poster-modal';
import '../../src/styles.css';
import '../../src/styles/visual-presets.css';
import { applyStorefrontVisualPreset } from '../../src/use-storefront-visual-preset';

applyStorefrontVisualPreset(document.documentElement, 'classic');
function background(width: number, height: number) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Local artwork fixture requires a 2D canvas');
    ctx.fillStyle = '#dce9e3';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#163d37';
    ctx.font = 'bold 64px sans-serif';
    ctx.fillText('本地上传设计图', 80, 200);
    return canvas.toDataURL('image/png');
}
const copy = Object.fromEntries(
    posterLayoutFields
        .filter(f => f.field.endsWith('Zh'))
        .flatMap(f => [
            [f.field, ''],
            [f.field.replace(/Zh$/, 'En'), ''],
        ]),
) as PosterCopy;
const base: ReferralPosterTemplate = {
    ...copy,
    serviceTextZh: '',
    serviceTextEn: '',
    id: 'minimal',
    name: '极简圆环',
    enabled: true,
    position: 0,
    headlineZh: '本地验收',
    headlineEn: 'Local acceptance',
    layoutVariant: 'ARTWORK_QR',
    design: structuredClone(DEFAULT_ARTWORK_POSTER_DESIGN),
    posterBackgroundAsset: {
        id: 'local-artwork',
        source: background(1080, 1920),
        preview: '',
        name: 'synthetic local artwork',
    },
    shareBackgroundAsset: null,
    foregroundColor: '#123456',
    accentColor: '#123456',
    overlayOpacity: 50,
};
const artworkAsset = base.posterBackgroundAsset;
if (!artworkAsset) throw new Error('Local artwork fixture requires a background asset');
const templates: ReferralPosterTemplate[] = POSTER_QR_STYLES.map(style => ({
    ...base,
    id: style.id,
    name: style.name,
    design: {
        ...DEFAULT_ARTWORK_POSTER_DESIGN,
        qr: { ...DEFAULT_ARTWORK_POSTER_DESIGN.qr, style: style.id },
    },
}));
templates.push({
    ...base,
    id: 'square',
    name: '正方形海报',
    posterBackgroundAsset: { ...artworkAsset, source: background(1080, 1080) },
    design: {
        ...DEFAULT_ARTWORK_POSTER_DESIGN,
        canvas: { width: 1080, height: 1080 },
        qr: { ...DEFAULT_ARTWORK_POSTER_DESIGN.qr, centerY: 700 },
    },
});
templates.push({
    ...base,
    id: 'invalid',
    name: '错误图片比例',
    posterBackgroundAsset: { ...artworkAsset, source: background(720, 720) },
});
Object.assign(window, { artworkAcceptance: { renderReferralPoster, renderPosterDesignGuide, base } });
function Fixture() {
    const [open, setOpen] = useState(true);
    const [message, setMessage] = useState('');
    return (
        <main>
            <button onClick={() => setOpen(true)}>打开海报</button>
            <output role="status">{message}</output>
            {open && (
                <ReferralPosterModal
                    inviteCode="ABCD2345"
                    storefrontName="本地测试店铺"
                    logoUrl={null}
                    language="zh"
                    rewardRate={0}
                    templates={[]}
                    templateConfigs={templates}
                    defaultTemplate="minimal"
                    channelId="local-artwork"
                    onClose={() => setOpen(false)}
                    onNotify={setMessage}
                />
            )}
        </main>
    );
}
const root = document.getElementById('root');
if (!root) throw new Error('Local artwork fixture requires a root element');
createRoot(root).render(<Fixture />);
