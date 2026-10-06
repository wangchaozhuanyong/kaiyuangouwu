// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { newContentBlock } from './storefront-content-utils';
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
                        source: '/replacement-original.png',
                        width: 1280,
                        height: 960,
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
        const root = createRoot(host);
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

it('requires image review, invalidates it after another image change, and preserves normal saves', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
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
    const root = createRoot(host);
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

it.each([false, true])(
    'selects phone hero artwork, preserves desktop artwork and reviews existing phone changes: %s',
    async hasPhoneImage => {
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        const onSave = vi.fn(async () => undefined);
        const desktopImage = {
            id: 'desktop',
            name: 'desktop.png',
            preview: '/assets/desktop.png',
            source: '/assets/desktop-original.png',
            width: 1600,
            height: 650,
        };
        const value = {
            ...newContentBlock('HERO', 0),
            id: 'hero-saved',
            imageAsset: desktopImage,
            imageAssetId: desktopImage.id,
            imageUrl: desktopImage.preview,
            settings: {
                themePreset: 'bright',
                ...(hasPhoneImage
                    ? {
                          mobileImageAssetId: 'phone',
                          mobileImageUrl: '/assets/phone.png',
                          mobileImageWidth: 1200,
                          mobileImageHeight: 900,
                      }
                    : {}),
            },
        };
        value.translations[0].title = '首页轮播';
        const button = (name: string) =>
            Array.from(host.querySelectorAll('button')).find(item => item.textContent === name)!;
        const checkbox = () =>
            Array.from(host.querySelectorAll('label'))
                .find(label => label.textContent?.includes('我确认替换或清除以上图片'))!
                .querySelector('input')!;
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
            await act(async () => button('手机轮播图（可选）换图').click());
            expect(button('保存并核对').disabled).toBe(hasPhoneImage);
            if (hasPhoneImage) {
                expect(host.textContent).toContain('手机轮播图：phone.png → replacement.png');
                await act(async () => checkbox().click());
            }
            await act(async () => button('保存并核对').click());
            expect(onSave).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    imageAsset: desktopImage,
                    imageAssetId: 'desktop',
                    imageUrl: '/assets/desktop.png',
                    settings: {
                        themePreset: 'bright',
                        mobileImageAssetId: 'replacement',
                        mobileImageUrl: '/assets/replacement.png',
                        mobileImageWidth: 1280,
                        mobileImageHeight: 960,
                    },
                }),
                hasPhoneImage,
            );
            await act(async () => button('手机轮播图（可选）清除').click());
            expect(button('保存并核对').disabled).toBe(hasPhoneImage);
            if (hasPhoneImage) {
                expect(checkbox().checked).toBe(false);
                expect(host.textContent).toContain('手机轮播图：phone.png → 清除图片');
                await act(async () => checkbox().click());
            }
            await act(async () => button('保存并核对').click());
            expect(onSave).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    imageAsset: desktopImage,
                    imageAssetId: 'desktop',
                    imageUrl: '/assets/desktop.png',
                    settings: {
                        themePreset: 'bright',
                        mobileImageAssetId: null,
                        mobileImageUrl: null,
                        mobileImageWidth: null,
                        mobileImageHeight: null,
                    },
                }),
                hasPhoneImage,
            );
        } finally {
            await act(async () => root.unmount());
            host.remove();
        }
    },
);

// The business fixtures own mocked data; lifecycle behavior is tested with real Apollo.
vi.mock('../../hooks/use-admin-query', () => import('../../test/admin-query-mock'));
