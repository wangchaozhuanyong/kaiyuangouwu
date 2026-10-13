import { describe, expect, it } from 'vitest';
import { DEFAULT_ARTWORK_POSTER_DESIGN } from '../../../../common/src/referral-poster-design';
import { referralPosterCopy } from '../../../../store-management-plugin/src/referral/referral-poster-presets';
import type { ReferralPosterRecord, ReferralProgramRecord } from '../../graphql/marketing.graphql';
import { posterDraft, posterDraftError, programDraft, programDraftError } from './referral-ui';

describe('referral attribution settings', () => {
    const program = {
        updatedAt: '2026-09-06T00:00:00Z',
        enabled: true,
        rewardRate: 5,
        releaseDelayDays: 7,
        minimumOrderAmount: 0,
        maxRewardPerOrder: null,
        allowBalanceSpend: true,
        attributionWindowDays: 0,
        defaultPosterTemplate: 'BRAND_MINIMAL',
        posterTemplates: ['BRAND_MINIMAL'],
    } as ReferralProgramRecord;

    it.each([0, 1, 30, 180, 365])('preserves and accepts %i days from the API', attributionWindowDays => {
        const draft = programDraft({ ...program, attributionWindowDays });
        expect(draft.attributionWindowDays).toBe(attributionWindowDays);
        expect(programDraftError(draft)).toBe('');
    });

    it.each([-1, 0.5, 366, NaN, Infinity])('rejects invalid days: %s', attributionWindowDays => {
        const draft = programDraft({ ...program, attributionWindowDays });
        expect(programDraftError(draft)).toBe('归因有效期必须是0到365的整数，0表示永久有效');
    });
});

const source = {
    ...referralPosterCopy,
    id: 'store-template',
    name: '本店海报',
    enabled: true,
    position: 3,
    layoutVariant: 'STANDARD_CENTER',
    posterBackgroundAsset: {
        id: 'asset-a',
        name: 'Background',
        source: '/asset-a',
        preview: '/asset-a-preview',
    },
    shareBackgroundAsset: null,
    foregroundColor: '#152c49',
    accentColor: '#2565ae',
    overlayOpacity: 0,
} as ReferralPosterRecord;

describe('poster editor drafts', () => {
    it('preserves every advanced bilingual field and asset during editing', () => {
        const template = {
            ...source,
            featureTwoTextZh: '本店独特文案',
            qrTitleEn: 'Visit this store',
            footerTextZh: '',
        };
        const draft = posterDraft(template);
        for (const field of Object.keys(referralPosterCopy) as (keyof typeof referralPosterCopy)[]) {
            expect(draft[field]).toBe(template[field]);
        }
        expect(draft.posterBackgroundAssetId).toBe('asset-a');
        expect(draft.enabled).toBe(true);
    });
    it('creates a separate hidden store copy without reusing the system identifier', () => {
        const draft = posterDraft({ ...source, id: '', enabled: false });
        expect(draft.id).toBeUndefined();
        expect(draft.enabled).toBe(false);
        expect(draft.name).toBe('本店海报 · 本店');
        expect(draft.featureOneTitleZh).toBe(source.featureOneTitleZh);
        expect(draft.posterBackgroundAssetId).toBe(source.posterBackgroundAsset?.id);
    });
    it('does not force an unused legacy field and rejects invalid sorting', () => {
        const draft = posterDraft(source);
        expect(posterDraftError({ ...draft, serviceTextZh: '', serviceTextEn: '' })).toBe('');
        expect(posterDraftError({ ...draft, position: -1 })).toContain('排序');
    });
});

describe('artwork poster drafts', () => {
    it('starts hidden with a separate default canvas and circle', () => {
        const draft = posterDraft('NEW');
        expect(draft.layoutVariant).toBe('ARTWORK_QR');
        expect(draft.enabled).toBe(false);
        expect(draft.design).toEqual(DEFAULT_ARTWORK_POSTER_DESIGN);
        expect(draft.design).not.toBe(DEFAULT_ARTWORK_POSTER_DESIGN);
    });
    it('requires only the copy used by artwork shares and retains image bindings when copied', () => {
        const template = {
            ...source,
            id: '',
            enabled: false,
            layoutVariant: 'ARTWORK_QR',
            design: DEFAULT_ARTWORK_POSTER_DESIGN,
        };
        const draft = posterDraft(template);
        expect(posterDraftError({ ...draft, titleZh: '', rewardTextZh: '', siteIntroZh: '' })).toBe('');
        expect(draft.design).toEqual(DEFAULT_ARTWORK_POSTER_DESIGN);
        expect(draft.posterBackgroundAssetId).toBe('asset-a');
        expect(draft.id).toBeUndefined();
        expect(posterDraftError({ ...draft, headlineZh: '' })).toContain('中文分享文案');
        expect(posterDraftError({ ...draft, posterBackgroundAssetId: '' })).toContain('完整设计图');
        expect(
            posterDraftError({
                ...draft,
                design: {
                    ...DEFAULT_ARTWORK_POSTER_DESIGN,
                    qr: { ...DEFAULT_ARTWORK_POSTER_DESIGN.qr, centerX: 0 },
                },
            }),
        ).toContain('画布内');
    });
});
