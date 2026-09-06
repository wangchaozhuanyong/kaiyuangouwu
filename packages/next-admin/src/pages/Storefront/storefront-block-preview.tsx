import { gql } from '@apollo/client';
import { useQuery } from '@apollo/client/react';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    AuthVisual,
    authVisualStyle,
    configuredColor,
    readableColor,
    type AuthVisualData,
} from '../../../../storefront-content-plugin/src/shared/auth-visual';
import { HeroScene, type HeroSceneData } from '../../../../storefront-content-plugin/src/shared/hero-scene';
import heroSceneCss from '../../../../storefront-content-plugin/src/shared/hero-scene.css?inline';
import { heroThemeStyle } from '../../../../storefront-content-plugin/src/shared/hero-theme';
import {
    normalizeStorefrontAssetUrl,
    responsiveImageSources,
} from '../../../../storefront-content-plugin/src/shared/responsive-image';
import { getActiveChannelToken } from '../../apollo';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { type StorefrontContentBlock, type StorefrontLanguageCode } from '../../graphql/storefront.graphql';
import { blockTranslation, itemTranslation } from './storefront-content-utils';
import { stringSetting } from './storefront-editor-model';

export function BlockPreview({
    block,
    language,
}: {
    block: StorefrontContentBlock;
    language: StorefrontLanguageCode;
}) {
    if (block.type === 'HERO') return <HeroBlockPreview block={block} language={language} />;
    if (block.type === 'AUTH_LOGIN' || block.type === 'AUTH_REGISTER')
        return <AuthBlockPreview block={block} language={language} />;
    const translation = blockTranslation(block, language);
    const image = block.imageAsset?.preview ?? block.imageUrl;
    if (block.type === 'SUPPORT') {
        const isZh = language === 'zh_Hans';
        const days = stringSetting(
            isZh ? block.settings?.serviceDaysZh : block.settings?.serviceDaysEn,
            isZh ? '每日' : 'Daily',
        );
        const startTime = stringSetting(block.settings?.serviceStartTime, '09:00');
        const endTime = stringSetting(block.settings?.serviceEndTime, '18:00');
        const channels = block.items.filter(item => item.enabled);
        return (
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                    <h3 className="text-xs font-bold text-slate-900">
                        简易前台预览
                        <FeatureHelpButton topic="storefront.safe-preview" title="简易前台预览" />
                    </h3>
                    <span className="rounded bg-slate-100 px-2 py-1 font-mono text-[10px] text-slate-500">
                        SUPPORT
                    </span>
                </div>
                <div className="p-4" style={{ backgroundColor: block.backgroundColor ?? '#f8fafc' }}>
                    <h4 className="text-base font-bold text-slate-900">
                        {translation.title || (isZh ? '客服中心' : 'Customer support')}
                    </h4>
                    {translation.subtitle && (
                        <p className="mt-1 text-xs leading-5 text-slate-500">{translation.subtitle}</p>
                    )}
                    <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                        <div className="flex items-center justify-between gap-3 text-[11px]">
                            <strong className="text-slate-800">
                                {isZh ? '客服服务时间' : 'Customer-service hours'}
                            </strong>
                            <span className="rounded bg-blue-50 px-2 py-1 font-bold text-blue-700">
                                {days}
                            </span>
                        </div>
                        <div className="mt-2 font-mono text-xl font-bold text-slate-900">
                            {startTime}–{endTime}
                        </div>
                        {translation.body && (
                            <p className="mt-2 whitespace-pre-wrap text-[10px] leading-4 text-slate-500">
                                {translation.body}
                            </p>
                        )}
                    </div>
                    <div className="mt-3 space-y-2">
                        {channels.map((item, index) => {
                            const channel = stringSetting(item.settings?.supportChannel, '');
                            const qrImage = item.imageAsset?.preview ?? item.imageUrl;
                            return (
                                <div
                                    key={item.id ?? index}
                                    className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2"
                                >
                                    {channel === 'WECHAT' && qrImage ? (
                                        <img src={qrImage} alt="" className="h-8 w-8 rounded object-cover" />
                                    ) : (
                                        <div className="h-8 w-8 rounded bg-slate-100" />
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <strong className="block truncate text-[11px] text-slate-800">
                                            {itemTranslation(item, language).label || `客服渠道 ${index + 1}`}
                                        </strong>
                                        <span className="block truncate text-[10px] text-slate-400">
                                            {channel === 'WECHAT'
                                                ? isZh
                                                    ? '扫码联系'
                                                    : 'Scan QR code'
                                                : stringSetting(
                                                      item.settings?.supportAccount,
                                                      item.targetValue ?? '',
                                                  )}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                        {!channels.length && (
                            <p className="rounded-lg bg-white py-5 text-center text-[11px] text-slate-400">
                                {isZh ? '尚未启用客服渠道' : 'No support channel enabled'}
                            </p>
                        )}
                    </div>
                </div>
            </section>
        );
    }
    return (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <h3 className="flex items-center gap-2 text-xs font-bold text-slate-900">
                    简易前台预览
                    <FeatureHelpButton topic="storefront.structure-preview" title="简易前台预览" />
                </h3>
                <span className="rounded bg-slate-100 px-2 py-1 font-mono text-[10px] text-slate-500">
                    {block.type}
                </span>
            </div>
            <div className="p-4">
                <div
                    className="overflow-hidden rounded-xl p-5"
                    style={{
                        backgroundColor: block.backgroundColor ?? '#f1f5f9',
                        color: block.textColor ?? '#0f172a',
                    }}
                >
                    {image && (
                        <img
                            src={image}
                            alt={translation.title || block.internalName}
                            className="mb-4 aspect-[16/8] w-full rounded-lg object-cover"
                        />
                    )}
                    <h4 className="text-lg font-bold leading-tight">{translation.title || '未填写标题'}</h4>
                    {translation.subtitle && (
                        <p className="mt-2 text-xs opacity-75">{translation.subtitle}</p>
                    )}
                    {translation.body && (
                        <p className="mt-3 whitespace-pre-wrap text-xs leading-5 opacity-80">
                            {translation.body}
                        </p>
                    )}
                    {translation.ctaLabel && (
                        <span className="mt-4 inline-flex rounded-md bg-white/85 px-3 py-1.5 text-[11px] font-bold text-slate-900">
                            {translation.ctaLabel}
                        </span>
                    )}
                    {block.items.length > 0 && (
                        <div className="mt-4 grid grid-cols-2 gap-2">
                            {block.items
                                .filter(item => item.enabled)
                                .map((item, index) => (
                                    <div
                                        key={item.id ?? index}
                                        className="rounded-lg bg-white/75 p-2 text-slate-900"
                                    >
                                        <div className="text-[11px] font-bold">
                                            {itemTranslation(item, language).label || `子项 ${index + 1}`}
                                        </div>
                                        <div className="mt-1 line-clamp-2 text-[10px] text-slate-500">
                                            {itemTranslation(item, language).description}
                                        </div>
                                    </div>
                                ))}
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}

const PREVIEW_BRANDING = gql`
    query StorefrontPreviewBranding {
        storefrontVisualPreset {
            presetId
        }
        activeChannel {
            id
            token
        }
        storefrontPreviewBranding {
            channelId
            name
            backgroundColor
            primaryColor
            accentColor
            highlightColor
        }
    }
`;

function HeroBlockPreview({
    block,
    language,
}: {
    block: StorefrontContentBlock;
    language: StorefrontLanguageCode;
}) {
    const [viewport, setViewport] = useState<'mobile' | 'desktop'>('mobile');
    const previewFrame = useRef<HTMLDivElement>(null);
    const [previewWidth, setPreviewWidth] = useState(390);
    useEffect(() => {
        const frame = previewFrame.current;
        if (!frame) return;
        const observer = new ResizeObserver(entries => setPreviewWidth(entries[0].contentRect.width));
        observer.observe(frame);
        return () => observer.disconnect();
    }, []);
    const frameWidth = viewport === 'desktop' ? 1024 : 390;
    const frameHeight = viewport === 'desktop' ? 400 : 235;
    const frameScale = Math.min(1, previewWidth / frameWidth);
    const imageUrl = block.imageAsset?.preview ?? block.imageUrl ?? '';
    const content: HeroSceneData = {
        ...blockTranslation(block, language),
        backgroundColor: block.backgroundColor,
        textColor: block.textColor,
        settings: block.settings,
        targetType: block.targetType,
        items: block.items.map(item => ({ ...itemTranslation(item, language), enabled: item.enabled })),
    };
    const brandingQuery = useQuery<{
        activeChannel: { id: string; token: string };
        storefrontVisualPreset: { presetId: string };
        storefrontPreviewBranding: {
            channelId: string;
            backgroundColor?: string;
            primaryColor?: string;
            highlightColor?: string;
        };
    }>(PREVIEW_BRANDING, { fetchPolicy: 'no-cache' });
    const branding =
        brandingQuery.data?.storefrontPreviewBranding.channelId === brandingQuery.data?.activeChannel.id &&
        (!getActiveChannelToken() || getActiveChannelToken() === brandingQuery.data?.activeChannel.token)
            ? brandingQuery.data?.storefrontPreviewBranding
            : undefined;
    const oriental = branding && brandingQuery.data?.storefrontVisualPreset.presetId === 'modern-oriental';
    const background = configuredColor(branding?.backgroundColor);
    const imageSources = responsiveImageSources(imageUrl, 'hero');
    const style = {
        '--store-background': background,
        '--store-foreground': background ? readableColor(background) : undefined,
        '--store-primary': configuredColor(branding?.primaryColor),
        '--store-highlight': configuredColor(branding?.highlightColor),
    } as CSSProperties;
    const document =
        '<!doctype html>' +
        renderToStaticMarkup(
            <html
                lang={language === 'zh_Hans' ? 'zh' : 'en'}
                data-storefront-preset={oriental ? 'modern-oriental' : 'classic'}
            >
                <head>
                    <meta charSet="utf-8" />
                    <style>{`*{box-sizing:border-box;border:0 solid}body{margin:0;padding:12px;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','SF Pro Display','PingFang SC','Hiragino Sans GB','Microsoft YaHei','Segoe UI',Roboto,sans-serif;font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased;font-feature-settings:'cv02','cv03','cv04','cv11';--font-numeric:-apple-system,BlinkMacSystemFont,'SF Pro Display','PingFang SC','Segoe UI',Roboto,sans-serif}button{font:inherit;padding:0}h1,p{margin:0}img{display:block;max-width:100%;height:auto} ${heroSceneCss}`}</style>
                </head>
                <body style={style}>
                    <section
                        className="hero"
                        style={{
                            ...heroThemeStyle(content),
                            margin: 0,
                            width: viewport === 'desktop' ? 850 : '100%',
                            minHeight: viewport === 'desktop' ? 360 : 195,
                        }}
                    >
                        <HeroScene
                            content={content}
                            imageLabel={content.title}
                            image={
                                imageUrl ? (
                                    <img
                                        src={
                                            imageSources?.fallbackSrc ?? normalizeStorefrontAssetUrl(imageUrl)
                                        }
                                        srcSet={imageSources?.webpSrcSet}
                                        sizes={imageSources?.sizes}
                                        className="hero-rich-backdrop"
                                        alt={content.title}
                                    />
                                ) : (
                                    <span role="status">
                                        {language === 'zh_Hans' ? '尚未选择图片' : 'No image selected'}
                                    </span>
                                )
                            }
                        />
                    </section>
                </body>
            </html>,
        );
    return (
        <section
            className="overflow-hidden rounded-xl border border-slate-200 bg-white"
            aria-label="轮播效果预览"
        >
            <div className="flex items-center justify-between border-b border-slate-100 p-3">
                <h3 className="flex items-center gap-2 text-xs font-bold">
                    轮播效果预览
                    <FeatureHelpButton topic="storefront.hero-preview" title="轮播效果预览" />
                </h3>
                <div className="flex gap-2">
                    {(['mobile', 'desktop'] as const).map(value => (
                        <button
                            key={value}
                            type="button"
                            aria-pressed={viewport === value}
                            onClick={() => setViewport(value)}
                            className="rounded border px-2 py-1 text-xs"
                        >
                            {value === 'mobile' ? '手机' : '电脑'}
                        </button>
                    ))}
                </div>
            </div>
            <p className="p-3 text-xs text-slate-500">
                预览当前未保存的图片、文案、遮罩和配色；按钮仅展示，不会跳转。
            </p>
            {brandingQuery.error && (
                <p role="alert" className="p-3 text-xs">
                    品牌配色加载失败，请刷新预览。
                </p>
            )}
            <div
                ref={previewFrame}
                style={{
                    position: 'relative',
                    minWidth: 0,
                    overflow: 'hidden',
                    height: frameHeight * frameScale,
                }}
            >
                <iframe
                    title="首页轮播效果"
                    sandbox=""
                    srcDoc={document}
                    width={viewport === 'desktop' ? 1024 : 390}
                    height={viewport === 'desktop' ? 400 : 235}
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        display: 'block',
                        border: 0,
                        transform: `scale(${frameScale})`,
                        transformOrigin: 'top left',
                    }}
                />
            </div>
        </section>
    );
}

function AuthBlockPreview({
    block,
    language,
}: {
    block: StorefrontContentBlock;
    language: StorefrontLanguageCode;
}) {
    const [viewport, setViewport] = useState<'mobile' | 'desktop'>('mobile');
    const previewHost = useRef<HTMLDivElement>(null);
    const previewCanvas = useRef<HTMLDivElement>(null);
    const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
    const previewWidth = viewport === 'desktop' ? 1024 : 390;
    const previewScale = Math.min(1, previewSize.width / previewWidth || 1);
    useLayoutEffect(() => {
        const host = previewHost.current;
        const canvas = previewCanvas.current;
        if (!host || !canvas) return;
        const resize = () => {
            const width = host.clientWidth;
            const height = canvas.offsetHeight;
            setPreviewSize(current =>
                current.width === width && current.height === height ? current : { width, height },
            );
        };
        const observer = new ResizeObserver(resize);
        observer.observe(host);
        observer.observe(canvas);
        resize();
        return () => observer.disconnect();
    }, []);
    const brandingQuery = useQuery<{
        activeChannel: { id: string; token: string };
        storefrontVisualPreset: { presetId: string };
        storefrontPreviewBranding: {
            channelId: string;
            name: string;
            backgroundColor?: string;
            primaryColor?: string;
        };
    }>(PREVIEW_BRANDING, { fetchPolicy: 'no-cache' });
    const branding =
        brandingQuery.data?.storefrontPreviewBranding.channelId === brandingQuery.data?.activeChannel.id &&
        (!getActiveChannelToken() || getActiveChannelToken() === brandingQuery.data?.activeChannel.token)
            ? brandingQuery.data?.storefrontPreviewBranding
            : undefined;
    const oriental = Boolean(
        branding && brandingQuery.data?.storefrontVisualPreset.presetId === 'modern-oriental',
    );
    const background = configuredColor(branding?.backgroundColor);
    const accent = configuredColor(branding?.primaryColor);
    const content: AuthVisualData = {
        ...blockTranslation(block, language),
        imageUrl: block.imageAsset?.preview ?? block.imageUrl,
        backgroundColor: block.backgroundColor,
        textColor: block.textColor,
        settings: block.settings,
        items: block.items.map(item => ({
            ...itemTranslation(item, language),
            id: item.id,
            enabled: item.enabled,
        })),
    };
    const isZh = language === 'zh_Hans';
    return (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 p-3">
                <h3 className="text-xs font-bold">{isZh ? '登录 / 注册预览' : 'Authentication preview'}</h3>
                <div className="flex gap-2">
                    {(['mobile', 'desktop'] as const).map(value => (
                        <button
                            type="button"
                            key={value}
                            aria-pressed={viewport === value}
                            onClick={() => setViewport(value)}
                            className="rounded border px-2 py-1 text-xs"
                        >
                            {value === 'mobile' ? '手机' : '电脑'}
                        </button>
                    ))}
                </div>
            </div>
            {brandingQuery.error && (
                <p role="alert" className="p-3 text-xs">
                    品牌配色加载失败，请刷新预览。
                </p>
            )}
            <div style={{ padding: 12 }}>
                <div ref={previewHost} data-auth-preview-viewport>
                    <div style={{ height: previewSize.height * previewScale }}>
                        <div
                            ref={previewCanvas}
                            style={
                                {
                                    ...authVisualStyle(content),
                                    '--auth-store-background':
                                        background ?? (oriental ? '#f6f2ea' : '#f1f5f9'),
                                    '--auth-store-foreground': background
                                        ? readableColor(background)
                                        : oriental
                                          ? '#203346'
                                          : '#172033',
                                    '--accent': accent ?? (oriental ? '#a63d32' : '#635bff'),
                                    '--accent-foreground': accent ? readableColor(accent) : '#ffffff',
                                    width: previewWidth,
                                    transform: `scale(${previewScale})`,
                                    transformOrigin: 'top left',
                                    display: 'grid',
                                    gridTemplateColumns: viewport === 'desktop' ? '.9fr 1.1fr' : '1fr',
                                    alignItems: 'start',
                                } as CSSProperties
                            }
                        >
                            <AuthVisual content={content} language={isZh ? 'zh' : 'en'} />
                            <div style={{ padding: 32, color: '#172033', display: 'grid', gap: 16 }}>
                                <h3 style={{ margin: 0 }}>
                                    {block.type === 'AUTH_LOGIN'
                                        ? isZh
                                            ? '登录'
                                            : 'Sign in'
                                        : isZh
                                          ? '注册账户'
                                          : 'Create account'}
                                </h3>
                                {block.type === 'AUTH_LOGIN' && (
                                    <p>
                                        {isZh
                                            ? '登录后管理你的账户与订单'
                                            : 'Sign in to manage your account and orders'}
                                    </p>
                                )}
                                <div style={{ border: '1px solid #cbd5e1', padding: 12 }}>
                                    {isZh ? '电子邮箱' : 'Email address'}
                                </div>
                                <div style={{ border: '1px solid #cbd5e1', padding: 12 }}>
                                    {isZh ? '密码' : 'Password'}
                                </div>
                                <span
                                    style={{
                                        background: 'var(--auth-accent)',
                                        color: 'var(--auth-button-foreground)',
                                        padding: 12,
                                        textAlign: 'center',
                                    }}
                                >
                                    {block.type === 'AUTH_LOGIN'
                                        ? isZh
                                            ? '登录'
                                            : 'Sign in'
                                        : isZh
                                          ? '注册账户'
                                          : 'Create account'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
