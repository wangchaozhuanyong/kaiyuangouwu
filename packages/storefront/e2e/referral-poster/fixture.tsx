/* eslint-disable import/order -- The Prettier import organizer places type imports after runtime imports. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReferralPosterTemplate } from '../../src/types';

import {
    resolveStorefrontSemanticPalette,
    semanticPaletteCssVariables,
    storefrontSkinCssVariables,
} from '../../../storefront-content-plugin/src/shared/storefront-semantic-palette';
import { normalizeStorefrontVisualPreset } from '../../../storefront-content-plugin/src/visual-presets';
import { posterLayoutFields, type PosterCopy } from '../../src/referral-poster-layout';
import { ReferralPosterModal } from '../../src/referral-poster-modal';
import '../../src/styles.css';
import '../../src/styles/visual-presets.css';
import { applyStorefrontVisualPreset } from '../../src/use-storefront-visual-preset';
/* eslint-enable import/order */

const preset = normalizeStorefrontVisualPreset(new URLSearchParams(location.search).get('preset'));
applyStorefrontVisualPreset(document.documentElement, preset);
for (const [name, value] of Object.entries({
    ...semanticPaletteCssVariables(resolveStorefrontSemanticPalette(preset, {})),
    ...storefrontSkinCssVariables(preset),
})) {
    document.documentElement.style.setProperty(name, value);
}

function template(id: string, name: string, accentColor: string): ReferralPosterTemplate {
    const copy = Object.fromEntries(
        posterLayoutFields
            .filter(field => field.field.endsWith('Zh'))
            .flatMap(field => [
                [field.field, '本地验收邀请海报'],
                [field.field.replace(/Zh$/, 'En'), 'Local referral poster'],
            ]),
    ) as PosterCopy;
    return {
        ...copy,
        id,
        name,
        enabled: true,
        position: id === 'BRAND_MINIMAL' ? 0 : 1,
        layoutVariant: 'STANDARD_CENTER',
        posterBackgroundAsset: null,
        shareBackgroundAsset: null,
        foregroundColor: '#152c49',
        accentColor,
        overlayOpacity: 0,
        rewardTextZh: '好友消费，获得 {rewardRate}% 奖励',
        rewardTextEn: 'Earn {rewardRate}% rewards',
    };
}

const templates = [
    template('BRAND_MINIMAL', '品牌简约', '#9b3b2f'),
    template('PRODUCT_STORY', '商品故事', '#286f74'),
];

function Fixture() {
    const [open, setOpen] = useState(true);
    const [message, setMessage] = useState('');
    return (
        <main>
            <button type="button" onClick={() => setOpen(true)}>
                打开海报
            </button>
            <output role="status">{message}</output>
            {open && (
                <ReferralPosterModal
                    inviteCode="ABCD2345"
                    storefrontName="大马通"
                    logoUrl={null}
                    language="zh"
                    rewardRate={10}
                    templates={templates.map(item => item.id)}
                    systemTemplateConfigs={templates}
                    defaultTemplate="BRAND_MINIMAL"
                    channelId="local-referral-acceptance"
                    onClose={() => setOpen(false)}
                    onNotify={setMessage}
                />
            )}
        </main>
    );
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Referral poster fixture root is missing');
createRoot(rootElement).render(<Fixture />);
