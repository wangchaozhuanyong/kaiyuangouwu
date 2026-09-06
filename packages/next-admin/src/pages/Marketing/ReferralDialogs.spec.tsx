// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import { FeatureHelpProvider } from '../../components/FeatureHelp';
import type { ReferralPosterRecord } from '../../graphql/marketing.graphql';
import { PosterEditor } from './ReferralDialogs';
import { posterDraft } from './referral-ui';

const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('@apollo/client/react', () => ({
    useQuery: () => ({ data: undefined }),
    useMutation: () => [mocks.update, { loading: false }],
}));
vi.mock('./ReferralPosterPreview', () => ({
    ReferralPosterPreview: ({ onValidation }: { onValidation: (value: object) => void }) => {
        useEffect(() => onValidation({ pending: false, error: '' }), [onValidation]);
        return <div>Preview</div>;
    },
}));

afterEach(() => vi.restoreAllMocks());

it('keeps the opening version after a background refresh and preserves the draft on conflict', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const source = {
        ...posterDraft('NEW'),
        id: 'poster-1',
        name: 'Local draft',
        enabled: true,
        titleZh: '分享',
        titleEn: 'Share',
        headlineEn: 'Share good products',
        rewardTextEn: 'Earn rewards',
        siteIntroEn: 'Our store',
        headlineZh: '分享好物',
        rewardTextZh: '获得奖励',
        siteIntroZh: '本店服务',
    } as unknown as ReferralPosterRecord;
    const onError = vi.fn();
    const onSaved = vi.fn();
    let version = '2026-09-06T10:00:00Z';
    const render = () =>
        root.render(
            <FeatureHelpProvider>
                <PosterEditor
                    source={source}
                    programUpdatedAt={version}
                    rewardRate={5}
                    onError={onError}
                    onSaved={onSaved}
                    onClose={() => undefined}
                />
            </FeatureHelpProvider>,
        );
    try {
        await act(async () => render());
        version = '2026-09-06T10:01:00Z';
        await act(async () => render());
        mocks.update.mockRejectedValueOnce(new Error('CONCURRENT_MODIFICATION: 请重新载入后合并修改'));
        const save = Array.from(host.querySelectorAll('button')).find(button =>
            button.textContent?.includes('保存海报模板'),
        )!;
        expect(save.disabled).toBe(false);
        await act(async () => save.click());
        expect(mocks.update).toHaveBeenCalledWith({
            variables: {
                input: expect.objectContaining({
                    id: 'poster-1',
                    name: 'Local draft',
                    expectedUpdatedAt: '2026-09-06T10:00:00Z',
                }),
            },
        });
        expect(mocks.update.mock.calls[0][0].variables.input).not.toHaveProperty('enabled');
        expect(onSaved).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith(expect.stringContaining('CONCURRENT_MODIFICATION'));
        expect(Array.from(host.querySelectorAll('input')).some(input => input.value === 'Local draft')).toBe(
            true,
        );
    } finally {
        act(() => root.unmount());
        host.remove();
        vi.unstubAllGlobals();
    }
});
