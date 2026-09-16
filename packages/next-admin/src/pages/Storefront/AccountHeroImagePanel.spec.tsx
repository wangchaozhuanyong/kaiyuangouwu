// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StorefrontAssetRef, StorefrontContentBlock } from '../../graphql/storefront.graphql';
import { AccountHeroImagePanel } from './AccountHeroImagePanel';

const mockPickedAsset: StorefrontAssetRef = {
    id: 'picked-asset-id',
    name: 'picked.png',
    preview: '/picked.png',
    source: '/picked.png',
};

vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));
vi.mock('./storefront-asset-picker', () => ({
    AssetPicker: ({
        value,
        onChange,
    }: {
        value: StorefrontAssetRef | null;
        onChange: (asset: StorefrontAssetRef | null) => void;
    }) => (
        <div>
            <span data-testid="current-picker-value">{value?.id ?? 'none'}</span>
            <button type="button" data-testid="mock-pick-asset" onClick={() => onChange(mockPickedAsset)}>
                Pick Asset
            </button>
            <button type="button" data-testid="mock-clear-asset" onClick={() => onChange(null)}>
                Clear Asset
            </button>
        </div>
    ),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('AccountHeroImagePanel unsaved changes and dirty state', () => {
    let host: HTMLDivElement;
    let root: Root;
    let confirmSpy: { mockRestore: () => void } & ReturnType<typeof vi.fn>;

    beforeEach(() => {
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true) as any;
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
        confirmSpy.mockRestore();
    });

    function saveButton(): HTMLButtonElement {
        const button = Array.from(host.querySelectorAll('button')).find(element =>
            element.textContent?.includes('保存到当前店铺'),
        );
        if (!button) throw new Error('Missing save button');
        return button as HTMLButtonElement;
    }

    function restoreButton(): HTMLButtonElement {
        const button = Array.from(host.querySelectorAll('button')).find(element =>
            element.textContent?.includes('恢复默认图'),
        );
        if (!button) throw new Error('Missing restore button');
        return button as HTMLButtonElement;
    }

    it('is not dirty when mounted with no block or null imageAsset', () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        act(() => {
            root.render(
                <AccountHeroImagePanel
                    block={null}
                    channelName="默认店铺"
                    disabled={false}
                    onSave={onSave}
                />,
            );
        });

        expect(saveButton().disabled).toBe(true);
        expect(restoreButton().disabled).toBe(true);

        const prevented = !window.dispatchEvent(
            new CustomEvent('vendure:before-app-navigation', {
                cancelable: true,
                detail: { target: '/dashboard/settings' },
            }),
        );
        expect(prevented).toBe(false);
        expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('becomes dirty when a new asset is picked, guards navigation, and resets dirty on save', async () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        act(() => {
            root.render(
                <AccountHeroImagePanel
                    block={null}
                    channelName="默认店铺"
                    disabled={false}
                    onSave={onSave}
                />,
            );
        });

        expect(saveButton().disabled).toBe(true);

        act(() => {
            host.querySelector<HTMLButtonElement>('[data-testid="mock-pick-asset"]')?.click();
        });

        expect(saveButton().disabled).toBe(false);

        // Guard should prompt confirmation when dirty
        window.dispatchEvent(
            new CustomEvent('vendure:before-app-navigation', {
                cancelable: true,
                detail: { target: '/dashboard/settings' },
            }),
        );
        expect(confirmSpy).toHaveBeenCalledWith('个人中心头图尚未保存，离开后将放弃本次选择。');

        await act(async () => {
            saveButton().click();
        });

        expect(onSave).toHaveBeenCalledWith(mockPickedAsset);
        expect(saveButton().disabled).toBe(true);
        expect(host.querySelector('[role="status"]')?.textContent).toContain('已保存到当前店铺');
    });

    it('allows restoring default when an existing image is configured', async () => {
        const onSave = vi.fn().mockResolvedValue(undefined);
        const existingAsset: StorefrontAssetRef = {
            id: 'existing-asset',
            name: 'existing.png',
            preview: '/existing.png',
            source: '/existing.png',
        };
        const existingBlock = {
            id: 'block-1',
            code: 'ACCOUNT_HERO_1',
            internalName: 'Account Hero',
            type: 'ACCOUNT_HERO',
            enabled: true,
            position: 0,
            imageUrl: null,
            imageAssetId: 'existing-asset',
            imageAsset: existingAsset,
            targetType: 'NONE',
            targetValue: null,
            settings: null,
            translations: [],
            items: [],
            updatedAt: '2026-09-16T00:00:00.000Z',
        } as unknown as StorefrontContentBlock;

        act(() => {
            root.render(
                <AccountHeroImagePanel
                    block={existingBlock}
                    channelName="默认店铺"
                    disabled={false}
                    onSave={onSave}
                />,
            );
        });

        expect(saveButton().disabled).toBe(true);
        expect(restoreButton().disabled).toBe(false);

        act(() => {
            restoreButton().click();
        });

        expect(saveButton().disabled).toBe(false);

        await act(async () => {
            saveButton().click();
        });

        expect(onSave).toHaveBeenCalledWith(null);
        expect(saveButton().disabled).toBe(true);
        expect(host.querySelector('[role="status"]')?.textContent).toContain('已恢复前台默认头图');
    });
});
