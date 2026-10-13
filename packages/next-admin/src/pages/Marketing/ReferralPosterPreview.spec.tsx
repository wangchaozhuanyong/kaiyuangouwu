// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ReferralPosterPreview } from './ReferralPosterPreview';
import { posterDraft } from './referral-ui';
import type { PosterAssetChoice } from './referrals-types';

const mocks = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('../../../../storefront/src/referral-poster-layout', () => ({
    renderReferralPoster: mocks.render,
}));

beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mocks.render.mockReset();
    mocks.render.mockResolvedValue('data:image/png;base64,preview');
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

const validAsset: PosterAssetChoice = {
    id: 'artwork',
    name: 'Artwork',
    source: 'https://store.example/artwork.png',
    preview: 'https://store.example/artwork-preview.png',
    width: 1080,
    height: 1920,
};

function fixture() {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const draft = { ...posterDraft('NEW'), posterBackgroundAssetId: validAsset.id };
    const onValidation = vi.fn();
    return {
        host,
        onValidation,
        render: async (assets: PosterAssetChoice[]) => {
            await act(async () =>
                root.render(
                    <ReferralPosterPreview
                        draft={draft}
                        assets={assets}
                        rewardRate={0}
                        onValidation={onValidation}
                    />,
                ),
            );
        },
        close: () => {
            act(() => root.unmount());
            host.remove();
        },
    };
}

it('derives missing and mismatched upload errors and recovers after a valid upload', async () => {
    const view = fixture();
    try {
        await view.render([]);
        expect(view.host.textContent).toContain('上传完整设计图后即可预览效果');
        expect(view.onValidation).toHaveBeenLastCalledWith({
            pending: false,
            error: '上传完整设计图后即可预览效果',
        });
        await view.render([{ ...validAsset, height: 1080 }]);
        expect(view.host.textContent).toContain('比例不一致');
        expect(mocks.render).not.toHaveBeenCalled();
        await view.render([validAsset]);
        expect(view.onValidation).toHaveBeenLastCalledWith({ pending: true, error: '' });
        await act(async () => vi.advanceTimersByTimeAsync(250));
        expect(view.host.querySelector('img')?.src).toBe('data:image/png;base64,preview');
        expect(view.onValidation).toHaveBeenLastCalledWith({ pending: false, error: '' });
        await view.render([]);
        expect(view.host.querySelector('img')).toBeNull();
        expect(view.host.textContent).toContain('上传完整设计图后即可预览效果');
    } finally {
        view.close();
    }
});

it('does not publish an old render when the selected upload becomes invalid', async () => {
    const completions: Array<(value: string) => void> = [];
    mocks.render.mockImplementation(() => new Promise<string>(resolve => completions.push(resolve)));
    const view = fixture();
    try {
        await view.render([validAsset]);
        await act(async () => vi.advanceTimersByTimeAsync(250));
        expect(completions).toHaveLength(2);
        await view.render([{ ...validAsset, height: 1080 }]);
        await act(async () => completions.forEach(resolve => resolve('data:image/png;base64,stale')));
        expect(view.host.querySelector('img')).toBeNull();
        expect(view.host.textContent).toContain('比例不一致');
        expect(view.onValidation).toHaveBeenLastCalledWith({
            pending: false,
            error: expect.stringContaining('比例不一致'),
        });
    } finally {
        view.close();
    }
});
