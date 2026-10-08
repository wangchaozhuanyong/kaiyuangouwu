// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { AdminOverlayHost } from '../../components/AdminOverlayHost';
import { AdminOverlayContext } from '../../runtime/admin-overlay-context';
import { newContentBlock, newContentItem, storefrontBlockInput } from './storefront-content-utils';
import { verifySavedBlock } from './storefront-save-verification';
import { StorefrontBlockEditor } from './StorefrontBlockEditor';

vi.mock('@apollo/client/react', () => ({ useQuery: () => ({ data: undefined }) }));
vi.mock('../../hooks/use-admin-permissions', () => ({
    useAdminPermissions: () => ({ hasAnyPermission: () => false }),
}));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));
vi.mock('./storefront-block-preview', () => ({ BlockPreview: () => null }));
vi.mock('./storefront-asset-picker', () => ({
    AssetPicker: ({ label, onChange }: any) => (
        <>
            <button
                onClick={() =>
                    onChange({
                        id: 'replacement',
                        name: 'replacement.png',
                        preview: '/replacement.png',
                        width: 1200,
                        height: 900,
                    })
                }
            >
                {label}换图
            </button>
            <button onClick={() => onChange(null)}>{label}清除</button>
        </>
    ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function createFixtureRoot(host: HTMLElement) {
    const mount = document.createElement('div');
    host.append(mount);
    const root = createRoot(mount);
    return {
        render: (children: ReactNode) =>
            root.render(<AdminOverlayContext.Provider value={host}>{children}</AdminOverlayContext.Provider>),
        unmount: () => root.unmount(),
    };
}

it('owns the complete drawer in the body overlay host, preserves its draft while hidden, and restores focus', async () => {
    const host = document.createElement('div');
    host.className = 'relative isolate';
    const trigger = document.createElement('button');
    trigger.textContent = '编辑轮播';
    const mount = document.createElement('div');
    host.append(trigger, mount);
    document.body.append(host);
    trigger.focus();
    const root = createRoot(mount);
    const value = { ...newContentBlock('HERO', 0), id: 'hero-overlay' };
    const onClose = vi.fn();
    const onSave = vi.fn();
    const render = async (active = true, open = true) =>
        act(async () =>
            root.render(
                <AdminOverlayHost owner="/storefront" active={active}>
                    {open && (
                        <StorefrontBlockEditor
                            value={value}
                            saving={false}
                            onClose={onClose}
                            onSave={onSave}
                        />
                    )}
                </AdminOverlayHost>,
            ),
        );
    try {
        await render();
        const owner = document.querySelector<HTMLElement>('[data-admin-overlay-owner="/storefront"]');
        const dialog = document.querySelector<HTMLElement>('[aria-label="编辑店铺楼层区块"]');
        if (!owner || !dialog) throw new Error('Expected the owned drawer');
        expect(owner.parentElement).toBe(document.body);
        expect(owner.contains(dialog)).toBe(true);
        expect(host.contains(dialog)).toBe(false);
        expect(dialog.className).toContain('fixed inset-0 z-50');
        expect(dialog.querySelector('header [aria-label="关闭编辑器"]')).not.toBeNull();
        const title = dialog.querySelector<HTMLInputElement>('[data-translation-field="title"]');
        if (!title) throw new Error('Expected the editable title');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (!setter) throw new Error('Expected the native input value setter');
        await act(async () => {
            setter.call(title, '尚未保存的轮播标题');
            title.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await render(false);
        expect(owner.hidden).toBe(true);
        expect(owner.hasAttribute('inert')).toBe(true);
        await render();
        expect(owner.hidden).toBe(false);
        expect(title.value).toBe('尚未保存的轮播标题');
        expect(onSave).not.toHaveBeenCalled();
        await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="关闭编辑器"]')?.click());
        expect(onClose).toHaveBeenCalledTimes(1);
        onClose.mockClear();
        const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        await act(async () => document.dispatchEvent(escape));
        expect(escape.defaultPrevented).toBe(true);
        expect(onClose).toHaveBeenCalledTimes(1);
        await render(true, false);
        expect(owner.querySelector('[role="dialog"]')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

it('focuses the requested existing item field in English without changing content or image bindings', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createFixtureRoot(host);
    const value = {
        ...newContentBlock('CUSTOM', 0),
        id: 'audit-block',
        items: [{ ...newContentItem(0), id: 'audit-item' }],
    };
    value.items[0].translations[1].description = 'Reviewed English';
    const before = structuredClone(value);
    const onSave = vi.fn();
    try {
        await act(async () =>
            root.render(
                <StorefrontBlockEditor
                    value={value}
                    saving={false}
                    onClose={() => undefined}
                    onSave={onSave}
                    initialLanguage="en"
                    reviewTarget={{ itemId: 'audit-item', field: 'description' }}
                />,
            ),
        );
        const target = host.querySelector<HTMLInputElement>(
            '[data-translation-item-id="audit-item"] [data-translation-field="description"]',
        )!;
        expect(target.value).toBe('Reviewed English');
        expect(document.activeElement).toBe(target);
        expect(value).toEqual(before);
        expect(onSave).not.toHaveBeenCalled();
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

it.each([
    ['AUTH_LOGIN', undefined, 'bottom'],
    ['AUTH_REGISTER', undefined, 'bottom'],
    ['AUTH_LOGIN', 'center', 'center'],
    ['AUTH_REGISTER', 'bottom', 'bottom'],
] as const)(
    'shows the shared auth position for %s without writing unset settings',
    async (type, position, expected) => {
        const host = document.createElement('div');
        document.body.append(host);
        const root = createFixtureRoot(host);
        const onSave = vi.fn(async () => undefined);
        const value = {
            ...newContentBlock(type, 0),
            settings: position ? { heroCopyPosition: position } : {},
        };
        value.translations[0].title = 'Auth visual';
        try {
            await act(async () =>
                root.render(
                    <StorefrontBlockEditor
                        value={value}
                        saving={false}
                        onClose={() => undefined}
                        onSave={onSave}
                    />,
                ),
            );
            const select = Array.from(host.querySelectorAll('label'))
                .find(label => label.textContent?.includes('电脑端图片上的文字位置'))!
                .querySelector('select')!;
            expect(select.value).toBe(expected);
            await act(async () =>
                Array.from(host.querySelectorAll('button'))
                    .find(button => button.textContent === '保存并核对')!
                    .click(),
            );
            expect(onSave).toHaveBeenLastCalledWith(
                expect.objectContaining({ settings: value.settings }),
                false,
            );
        } finally {
            await act(async () => root.unmount());
            host.remove();
        }
    },
);

it.each([
    [undefined, '30_DAYS'],
    ['UNKNOWN_PERIOD', '30_DAYS'],
    ['2_YEARS', '2_YEARS'],
])('shows the notice period for %s without overwriting existing settings', async (period, expected) => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createFixtureRoot(host);
    const value = {
        ...newContentBlock('NOTICE', 0),
        settings: {
            scrollIntervalSeconds: 8,
            ...(period ? { announcementDisplayPeriod: period } : {}),
        },
    };
    const before = structuredClone(value);
    const onSave = vi.fn();
    try {
        await act(async () =>
            root.render(
                <StorefrontBlockEditor
                    value={value}
                    saving={false}
                    onClose={() => undefined}
                    onSave={onSave}
                />,
            ),
        );
        const select = Array.from(host.querySelectorAll('label'))
            .find(label => label.textContent?.includes('公告展示期限'))!
            .querySelector('select')!;
        expect(select.value).toBe(expected);
        expect(value).toEqual(before);
        expect(onSave).not.toHaveBeenCalled();
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

it('saves a two-year notice period while preserving other settings and merchant images', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createFixtureRoot(host);
    const value = {
        ...newContentBlock('NOTICE', 0),
        id: 'saved-notice',
        imageAssetId: 'merchant-banner',
        imageUrl: '/assets/merchant-banner.webp',
        settings: { scrollIntervalSeconds: 8, merchantSetting: 'retain' },
        items: [
            {
                ...newContentItem(0),
                id: 'manual-notice',
                imageAssetId: 'merchant-item',
                imageUrl: '/assets/merchant-item.webp',
            },
        ],
    };
    value.items[0].translations[0].label = '手动公告';
    const before = structuredClone(value);
    const onSave = vi.fn(async (_draft: ReturnType<typeof newContentBlock>) => undefined);
    try {
        await act(async () =>
            root.render(
                <StorefrontBlockEditor
                    value={value}
                    saving={false}
                    onClose={() => undefined}
                    onSave={onSave}
                />,
            ),
        );
        const select = Array.from(host.querySelectorAll('label'))
            .find(label => label.textContent?.includes('公告展示期限'))!
            .querySelector('select')!;
        await act(async () => {
            select.value = '2_YEARS';
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        expect(select.value).toBe('2_YEARS');
        await act(async () =>
            Array.from(host.querySelectorAll('button'))
                .find(button => button.textContent === '保存并核对')!
                .click(),
        );
        expect(onSave).toHaveBeenCalledTimes(1);
        const draft = onSave.mock.calls[0][0];
        const expectedSettings = {
            ...value.settings,
            announcementDisplayPeriod: '2_YEARS',
        };
        expect(draft.settings).toEqual(expectedSettings);
        expect(draft.imageAssetId).toBe(value.imageAssetId);
        expect(draft.items[0].imageAssetId).toBe(value.items[0].imageAssetId);
        const input = storefrontBlockInput(draft, value);
        expect(input.settings).toEqual(expectedSettings);
        expect(input).not.toHaveProperty('imageAssetId');
        expect(input).not.toHaveProperty('imageUrl');
        expect(input).not.toHaveProperty('allowImageReplacement');
        expect(input.items[0]).not.toHaveProperty('imageAssetId');
        expect(input.items[0]).not.toHaveProperty('imageUrl');
        expect(value).toEqual(before);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

it('requires image review, invalidates it after another image change, and preserves normal saves', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createFixtureRoot(host);
    const onSave = vi.fn(async () => undefined);
    const value = {
        ...newContentBlock('STORY', 0),
        id: 'saved',
        imageAssetId: 'merchant',
        imageAsset: {
            id: 'merchant',
            name: 'merchant.png',
            source: '/merchant.png',
            preview: '/merchant.png',
        },
        imageUrl: '/merchant.png',
    };
    value.translations[0].title = '品牌介绍';
    value.targetType = 'NONE';
    const button = (name: string) =>
        Array.from(host.querySelectorAll('button')).find(item => item.textContent === name)!;
    try {
        await act(async () =>
            root.render(
                <StorefrontBlockEditor
                    value={value}
                    saving={false}
                    onClose={() => undefined}
                    onSave={onSave}
                />,
            ),
        );
        expect(button('保存并核对').disabled).toBe(false);
        await act(async () => button('保存并核对').click());
        expect(onSave).toHaveBeenLastCalledWith(expect.anything(), false);
        await act(async () => button('主图素材换图').click());
        expect(button('保存并核对').disabled).toBe(true);
        const checkbox = () =>
            Array.from(host.querySelectorAll('label'))
                .find(label => label.textContent?.includes('我确认替换或清除以上图片'))!
                .querySelector('input')!;
        await act(async () => checkbox().click());
        expect(button('保存并核对').disabled).toBe(false);
        await act(async () => button('主图素材清除').click());
        expect(checkbox().checked).toBe(false);
        expect(button('保存并核对').disabled).toBe(true);
        await act(async () => button('主图素材换图').click());
        expect(checkbox().checked).toBe(false);
        expect(button('保存并核对').disabled).toBe(true);
        await act(async () => button('主图素材清除').click());
        await act(async () => checkbox().click());
        await act(async () => button('保存并核对').click());
        expect(onSave).toHaveBeenLastCalledWith(
            expect.objectContaining({ imageAssetId: null, imageUrl: null }),
            true,
        );
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

it('saves shared auth presentation settings while retaining merchant artwork and bilingual copy', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createFixtureRoot(host);
    const onSave = vi.fn(async () => undefined);
    const value = {
        ...newContentBlock('AUTH_LOGIN', 0),
        id: 'auth-saved',
        imageAssetId: 'hero',
        imageUrl: '/hero.webp',
        settings: {
            formTitleZh: '欢迎登录',
            formTitleEn: 'Welcome',
            heroCopyPosition: 'bottom',
            heroBenefitsStyle: 'icons',
            mobileDecorationImageAssetId: 'skyline',
            mobileDecorationImageUrl: '/skyline.webp',
        },
    };
    value.translations[0].title = '更好的生活';
    const button = (name: string) =>
        Array.from(host.querySelectorAll('button')).find(item => item.textContent === name)!;
    try {
        await act(async () =>
            root.render(
                <StorefrontBlockEditor
                    value={value}
                    saving={false}
                    onClose={() => undefined}
                    onSave={onSave}
                />,
            ),
        );
        expect(host.textContent).toContain('表单标题（电脑与手机共用）');
        expect(host.textContent).toContain('电脑端图片上的文字位置');
        expect(host.textContent).toContain('卖点图标');
        await act(async () => button('保存并核对').click());
        expect(onSave).toHaveBeenLastCalledWith(
            expect.objectContaining({
                imageAssetId: 'hero',
                imageUrl: '/hero.webp',
                settings: value.settings,
            }),
            false,
        );
        await act(async () => button('装饰图素材清除').click());
        expect(button('保存并核对').disabled).toBe(true);
        expect(host.textContent).toContain('手机底部装饰图已替换或清除');
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

function fixtureAct(action: () => void): Promise<void> {
    return act(() => Promise.resolve(action()));
}

function fixtureButton(host: HTMLElement, text: string): HTMLButtonElement {
    const button = Array.from(host.querySelectorAll('button')).find(item => item.textContent === text);
    if (!button) throw new Error(`Expected fixture button: ${text}`);
    return button;
}

function fixtureInput(host: HTMLElement, labelText: string): HTMLInputElement {
    const input = Array.from(host.querySelectorAll('label'))
        .find(label => label.textContent?.includes(labelText))
        ?.querySelector('input');
    if (!input) throw new Error(`Expected fixture input: ${labelText}`);
    return input;
}

it.each([false, true])(
    'saves phone artwork separately and reviews replacements or clearing: %s',
    async existing => {
        const host = document.createElement('div');
        document.body.append(host);
        const root = createFixtureRoot(host);
        const onSave = vi.fn(() => Promise.resolve(undefined));
        const value = {
            ...newContentBlock('HERO', 0),
            id: 'hero',
            imageAssetId: 'desktop',
            imageUrl: '/assets/desktop.webp',
            settings: {
                themePreset: 'bright',
                ...(existing
                    ? {
                          mobileImageAssetId: 'phone',
                          mobileImageUrl: '/assets/phone.webp',
                          mobileImageWidth: 1200,
                          mobileImageHeight: 900,
                      }
                    : {}),
            },
        };
        const button = (text: string) => fixtureButton(host, text);
        const checkbox = () => fixtureInput(host, '我确认替换或清除以上图片');
        try {
            await fixtureAct(() =>
                root.render(
                    <StorefrontBlockEditor
                        value={value}
                        saving={false}
                        onClose={() => undefined}
                        onSave={onSave}
                    />,
                ),
            );
            await fixtureAct(() => button('手机轮播图（可选）换图').click());
            expect(button('保存并核对').disabled).toBe(existing);
            if (existing) {
                expect(host.textContent).toContain('手机轮播图已替换或清除');
                await fixtureAct(() => checkbox().click());
            }
            await fixtureAct(() => button('保存并核对').click());
            expect(onSave).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    imageAssetId: 'desktop',
                    imageUrl: '/assets/desktop.webp',
                    settings: {
                        themePreset: 'bright',
                        mobileImageAssetId: 'replacement',
                        mobileImageUrl: '/assets/replacement.png',
                        mobileImageWidth: 1200,
                        mobileImageHeight: 900,
                    },
                }),
                existing,
            );
            await fixtureAct(() => button('手机轮播图（可选）清除').click());
            expect(button('保存并核对').disabled).toBe(existing);
            if (existing) {
                expect(checkbox().checked).toBe(false);
                await fixtureAct(() => checkbox().click());
            }
            await fixtureAct(() => button('保存并核对').click());
            expect(onSave).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    imageAssetId: 'desktop',
                    imageUrl: '/assets/desktop.webp',
                    settings: {
                        themePreset: 'bright',
                        mobileImageAssetId: null,
                        mobileImageUrl: null,
                        mobileImageWidth: null,
                        mobileImageHeight: null,
                    },
                }),
                existing,
            );
        } finally {
            await fixtureAct(() => root.unmount());
            host.remove();
        }
    },
);

it('switches phone draft language and restores only the selected language to desktop copy', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createFixtureRoot(host);
    const onSave = vi.fn((_value: ReturnType<typeof newContentBlock>, _review?: boolean) =>
        Promise.resolve(undefined),
    );
    const value = {
        ...newContentBlock('HERO', 0),
        id: 'hero',
        imageAssetId: 'desktop',
        imageUrl: '/assets/desktop.webp',
        items: [
            {
                ...newContentItem(0),
                id: 'benefit',
                translations: [
                    { languageCode: 'zh_Hans' as const, label: '服务', description: '' },
                    { languageCode: 'en' as const, label: 'Service', description: '' },
                ],
            },
        ],
        settings: {
            mobileHeroTextColor: null,
            mobileHeroTranslations: [
                {
                    languageCode: 'zh_Hans',
                    title: '中文手机标题',
                    subtitle: '',
                    body: '中文简短说明',
                    ctaLabel: '浏览',
                },
                {
                    languageCode: 'en',
                    title: 'Phone title',
                    subtitle: '',
                    body: 'Short copy',
                    ctaLabel: 'Browse',
                },
            ],
        },
    };
    const button = (text: string) => fixtureButton(host, text);
    const title = () => fixtureInput(host, '手机标题（选填）');
    try {
        await fixtureAct(() =>
            root.render(
                <StorefrontBlockEditor
                    value={value}
                    saving={false}
                    onClose={() => undefined}
                    onSave={onSave}
                />,
            ),
        );
        expect(title().value).toBe('中文手机标题');
        const hideBenefits = fixtureInput(host, '手机隐藏轮播卖点');
        await fixtureAct(() => hideBenefits.click());
        await fixtureAct(() => button('英文').click());
        expect(title().value).toBe('Phone title');
        await fixtureAct(() => button('恢复当前语言电脑版文案').click());
        expect(title().value).toBe('');
        await fixtureAct(() => button('保存并核对').click());
        const saved = onSave.mock.calls.at(-1)?.[0];
        if (!saved) throw new Error('Expected a saved phone draft');
        // JSON settings omit undefined fields during the actual mutation transport.
        const readback = JSON.parse(JSON.stringify(saved));
        expect(() => verifySavedBlock(readback, storefrontBlockInput(saved, value))).not.toThrow();
        expect(saved.settings?.mobileHeroTranslations).toEqual([
            value.settings.mobileHeroTranslations[0],
            { languageCode: 'en' },
        ]);
        expect(() =>
            verifySavedBlock(
                { ...readback, settings: { ...readback.settings, mobileHeroHideStats: false } },
                storefrontBlockInput(saved, value),
            ),
        ).toThrow('settings');
        expect(JSON.parse(JSON.stringify(saved))).toMatchObject({
            imageAssetId: 'desktop',
            imageUrl: '/assets/desktop.webp',
            translations: value.translations,
            items: value.items,
            settings: {
                mobileHeroTextColor: null,
                mobileHeroHideStats: true,
                mobileHeroTranslations: [value.settings.mobileHeroTranslations[0], { languageCode: 'en' }],
            },
        });
        await fixtureAct(() => button('中文').click());
        expect(title().value).toBe('中文手机标题');
    } finally {
        await fixtureAct(() => root.unmount());
        host.remove();
    }
});

// The business fixtures own mocked data; lifecycle behavior is tested with real Apollo.
vi.mock('../../hooks/use-admin-query', () => import('../../test/admin-query-mock'));
