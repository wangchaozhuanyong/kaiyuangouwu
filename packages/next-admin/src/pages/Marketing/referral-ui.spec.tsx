import { describe, expect, it } from 'vitest';
import { referralPosterCopy } from '../../../../store-management-plugin/src/referral/referral-poster-presets';
import type { ReferralPosterRecord } from '../../graphql/marketing.graphql';
import { posterDraft, posterDraftError } from './referral-ui';

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
