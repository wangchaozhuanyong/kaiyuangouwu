import { Headphones, KeyRound, Mail, TicketPercent, WandSparkles } from 'lucide-react';
import { type ComponentType, useCallback, useContext, useEffect, useRef } from 'react';

import { shouldPrefetchMedia } from '../hooks/useOnlineStatus';
import { useStorefrontPageActivity } from '../hooks/useStorefrontPageActivity';
import { languageCodeFor } from '../i18n';
import { prepareImageStudioData } from '../pages/ai-image-studio-preload';
import { preloadStorefrontRouteComponent } from '../route-component-preload';
import { type RouteState } from '../storefront-router';
import { StorefrontContext } from '../StorefrontContext';
import { type StorefrontContentBlock, type StorefrontContentItem, type StorefrontLanguage } from '../types';

// Keep optional artwork out of the catalog's JavaScript parse path. The existing
// sized picture loads the same cacheable SVG only when that entry is displayed.
import couponArtwork from './artwork/coupon.svg?no-inline';
import supportArtwork from './artwork/support.svg?no-inline';

export const clientPluginPlacements = [
    'AFTER_HEADER',
    'AFTER_CATEGORY_NAVIGATION',
    'BEFORE_PRODUCT_LIST',
    'AFTER_PRODUCT_LIST',
    'BUSINESS_SERVICES_MAIN',
] as const;

export type ClientPluginPlacement = (typeof clientPluginPlacements)[number];
export type CategoryClientPluginPlacement = Exclude<ClientPluginPlacement, 'BUSINESS_SERVICES_MAIN'>;

export interface CategoryClientPluginContext {
    activeCollectionId: string;
    ancestorCollectionIds: string[];
}

export interface ClientPluginComponentProps {
    illustrated?: boolean;
    language: StorefrontLanguage;
    onNavigate: (route: RouteState) => void;
}

interface ResolvedClientPlugin {
    code: string;
    item: StorefrontContentItem;
    Component: ComponentType<ClientPluginComponentProps>;
}

const entryClass = 'category-client-plugin';

export function isAssistanceClientPlugin(plugin: Pick<ResolvedClientPlugin, 'code'>): boolean {
    return plugin.code === 'category-coupon-entry' || plugin.code === 'category-support-entry';
}

function AssistanceArtwork({ source }: Readonly<{ source: string }>) {
    return (
        <picture className={`${entryClass}-artwork`} aria-hidden="true">
            <source media="(max-width: 1023px)" srcSet={`${source}#compact`} />
            <img src={source} alt="" width="440" height="144" draggable={false} />
        </picture>
    );
}

function AiImageStudioEntryPlugin({ language, onNavigate }: Readonly<ClientPluginComponentProps>) {
    const storefront = useContext(StorefrontContext);
    const active = useStorefrontPageActivity();
    const warmupOwner = useRef({});

    const handleWarmup = useCallback(() => {
        if (!active || !shouldPrefetchMedia()) return;
        void preloadStorefrontRouteComponent('image-studio');
        if (storefront?.api && storefront.market) {
            const owner = warmupOwner.current;
            prepareImageStudioData(
                storefront.api,
                storefront.customer,
                storefront.market,
                () => warmupOwner.current === owner,
                languageCodeFor(language),
            );
        }
    }, [storefront, active]);

    useEffect(() => {
        warmupOwner.current = {};
        if (!storefront) return;
        const timer = setTimeout(() => {
            handleWarmup();
        }, 300);
        return () => {
            clearTimeout(timer);
            warmupOwner.current = {};
        };
    }, [handleWarmup, storefront]);

    return (
        <ToolEntryPlugin
            language={language}
            onNavigate={onNavigate}
            name="image-studio"
            onWarmup={handleWarmup}
        />
    );
}

const toolCopy = {
    coupons: [
        ['先领券，再选购', '查看可领取的优惠券', '去领券'],
        ['Claim a coupon first', 'See available coupons', 'View'],
    ],
    support: [
        ['选购遇到问题？', '联系客服获取商品与订单帮助', '联系客服'],
        ['Need help choosing?', 'Contact support for product and order help', 'Support'],
    ],
    'image-studio': [
        ['AI 图片工坊', '智能优化描述，选择模型快速生成图片', '开始创作'],
        ['AI Image Studio', 'Improve your prompt, choose a model, and create images', 'Create'],
    ],
    'two-factor': [
        ['2FA 动态码', '密钥不上传，在当前浏览器本地生成', '立即使用'],
        ['2FA codes', 'Generate codes locally without uploading secrets', 'Open'],
    ],
    'mail-query': [
        ['邮件验证码查询', '输入买家查询码，快速查看专属接收的验证码与邮件', '立即查询'],
        ['Mail verification codes', 'Enter your query code to view verification codes and emails', 'Query'],
    ],
    'gpt-recharge': [
        ['GPT自助充值', '验证兑换码，为你的 ChatGPT 账号充值并查询结果', '进入充值'],
        ['GPT self-service recharge', 'Redeem your code and check your recharge status', 'Recharge'],
    ],
} as const;

/** Public entries share their original frame; only the actual tool pages load lazily. */
function ToolEntryPlugin({
    onNavigate,
    language,
    name = 'gpt-recharge',
    illustrated,
    onWarmup,
}: Readonly<ClientPluginComponentProps & { name?: keyof typeof toolCopy; onWarmup?: () => void }>) {
    const [title, description, action] = toolCopy[name][language === 'zh' ? 0 : 1];
    const Icon = {
        coupons: TicketPercent,
        support: Headphones,
        'image-studio': WandSparkles,
        'mail-query': Mail,
        'two-factor': KeyRound,
        'gpt-recharge': KeyRound,
    }[name];
    const assistance = name === 'coupons' || name === 'support';
    const suffix = name === 'gpt-recharge' ? '' : ` ${entryClass}-${name === 'coupons' ? 'coupon' : name}`;
    return (
        <button
            type="button"
            className={`${entryClass}${suffix}${assistance && illustrated ? ' has-assistance-artwork' : ''}`}
            onClick={() => onNavigate({ name })}
            onMouseEnter={onWarmup}
            onTouchStart={onWarmup}
            onFocus={onWarmup}
        >
            <span className={`${entryClass}-icon`} aria-hidden={name === 'gpt-recharge' ? undefined : true}>
                <Icon />
            </span>
            <span className={`${entryClass}-copy`}>
                <strong>{title}</strong>
                <span>{description}</span>
            </span>
            <span className={`${entryClass}-action`}>{action}</span>
            {assistance && illustrated && (
                <AssistanceArtwork source={name === 'support' ? supportArtwork : couponArtwork} />
            )}
        </button>
    );
}

function toolEntry(name: keyof typeof toolCopy): ComponentType<ClientPluginComponentProps> {
    return props => <ToolEntryPlugin {...props} name={name} />;
}

const clientPluginRenderers: Readonly<Record<string, ComponentType<ClientPluginComponentProps> | undefined>> =
    {
        'category-coupon-entry': toolEntry('coupons'),
        'category-support-entry': toolEntry('support'),
        'ai-image-studio-entry': AiImageStudioEntryPlugin,
        'two-factor-code-tool': toolEntry('two-factor'),
        'icloud-mail-query-entry': toolEntry('mail-query'),
        'gpt-recharge-entry': ToolEntryPlugin,
    };

function itemPlacement(item: StorefrontContentItem): ClientPluginPlacement | null {
    const placement = item.settings?.placement;
    return clientPluginPlacements.includes(placement as ClientPluginPlacement)
        ? (placement as ClientPluginPlacement)
        : null;
}

function itemMatchesCategory(
    item: StorefrontContentItem,
    categoryContext: CategoryClientPluginContext | undefined,
): boolean {
    const scope = item.settings?.categoryScope ?? 'ALL';
    if (scope === 'ALL') return true;
    if (scope !== 'SELECTED' || !categoryContext) return false;
    const categoryIds = item.settings?.categoryIds;
    if (!Array.isArray(categoryIds) || categoryIds.some(id => typeof id !== 'string')) return false;
    if (categoryIds.includes(categoryContext.activeCollectionId)) return true;
    return (
        item.settings?.includeChildren === true &&
        categoryContext.ancestorCollectionIds.some(id => categoryIds.includes(id))
    );
}

export function resolveClientPlugins(
    block: StorefrontContentBlock | undefined,
    placement: ClientPluginPlacement,
    categoryContext?: CategoryClientPluginContext,
): ResolvedClientPlugin[] {
    if (!block?.enabled || block.type !== 'CLIENT_PLUGINS' || block.code !== 'storefront-client-plugins') {
        return [];
    }
    return [...block.items]
        .sort((left, right) => left.position - right.position)
        .flatMap(item => {
            const code = item.settings?.pluginCode;
            const Component = typeof code === 'string' ? clientPluginRenderers[code] : undefined;
            return item.enabled &&
                Component &&
                itemPlacement(item) === placement &&
                (placement === 'BUSINESS_SERVICES_MAIN' || itemMatchesCategory(item, categoryContext))
                ? [{ code: code as string, item, Component }]
                : [];
        });
}

export function ClientPluginSlot({
    block,
    placement,
    categoryContext,
    language,
    onNavigate,
    toolsFirst = false,
    group,
}: Readonly<{
    block: StorefrontContentBlock | undefined;
    placement: ClientPluginPlacement;
    categoryContext?: CategoryClientPluginContext;
    toolsFirst?: boolean;
    group?: 'tools' | 'assistance';
    language: StorefrontLanguage;
    onNavigate: (route: RouteState) => void;
}>) {
    const plugins = resolveClientPlugins(block, placement, categoryContext).filter(
        plugin => !group || isAssistanceClientPlugin(plugin) === (group === 'assistance'),
    );
    if (!plugins.length) return null;
    const renderPlugins = (entries: ResolvedClientPlugin[]) =>
        entries.map(({ code, item, Component }) => (
            <Component
                key={item.id || code}
                language={language}
                onNavigate={onNavigate}
                illustrated={group === 'assistance'}
            />
        ));
    // Keep managed order within each group, including when a merchant hides an entry.
    const tools = plugins.filter(plugin => !isAssistanceClientPlugin(plugin));
    const assistance = plugins.filter(isAssistanceClientPlugin);
    // The advertisement sidebar has fixed support / coupon positions. Other slots retain managed order.
    if (group === 'assistance') {
        assistance.sort(
            (left, right) =>
                Number(right.code === 'category-support-entry') -
                Number(left.code === 'category-support-entry'),
        );
    }
    return (
        <div className={`category-client-plugin-slot is-${placement.toLowerCase().replaceAll('_', '-')}`}>
            {toolsFirst || group ? (
                <>
                    {tools.length > 0 && (
                        <section
                            className="category-client-plugin-group is-tools"
                            aria-label={language === 'zh' ? '实用工具' : 'Useful tools'}
                        >
                            {renderPlugins(tools)}
                        </section>
                    )}
                    {assistance.length > 0 && (
                        <div className="category-client-plugin-group is-assistance">
                            {renderPlugins(assistance)}
                        </div>
                    )}
                </>
            ) : (
                renderPlugins(plugins)
            )}
        </div>
    );
}

export const resolveCategoryClientPlugins = resolveClientPlugins;
export const CategoryClientPluginSlot = ClientPluginSlot;
