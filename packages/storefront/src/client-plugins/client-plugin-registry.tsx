import { Headphones, KeyRound, TicketPercent, WandSparkles } from 'lucide-react';
import { type ComponentType } from 'react';

import { type RouteState } from '../storefront-router';
import { type StorefrontContentBlock, type StorefrontContentItem, type StorefrontLanguage } from '../types';

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

interface ClientPluginComponentProps {
    language: StorefrontLanguage;
    onNavigate: (route: RouteState) => void;
}

interface ResolvedClientPlugin {
    code: string;
    item: StorefrontContentItem;
    Component: ComponentType<ClientPluginComponentProps>;
}

function CouponEntryPlugin({ language, onNavigate }: Readonly<ClientPluginComponentProps>) {
    const isZh = language === 'zh';
    return (
        <button
            type="button"
            className="category-client-plugin category-client-plugin-coupon"
            onClick={() => onNavigate({ name: 'coupons' })}
        >
            <span className="category-client-plugin-icon" aria-hidden="true">
                <TicketPercent />
            </span>
            <span className="category-client-plugin-copy">
                <strong>{isZh ? '先领券，再选购' : 'Claim a coupon first'}</strong>
                <span>{isZh ? '查看当前店铺可领取的优惠券' : 'See coupons available in this store'}</span>
            </span>
            <span className="category-client-plugin-action">{isZh ? '去领券' : 'View'}</span>
        </button>
    );
}

function SupportEntryPlugin({ language, onNavigate }: Readonly<ClientPluginComponentProps>) {
    const isZh = language === 'zh';
    return (
        <button
            type="button"
            className="category-client-plugin category-client-plugin-support"
            onClick={() => onNavigate({ name: 'support' })}
        >
            <span className="category-client-plugin-icon" aria-hidden="true">
                <Headphones />
            </span>
            <span className="category-client-plugin-copy">
                <strong>{isZh ? '选购遇到问题？' : 'Need help choosing?'}</strong>
                <span>
                    {isZh ? '联系客服获取商品与订单帮助' : 'Contact support for product and order help'}
                </span>
            </span>
            <span className="category-client-plugin-action">{isZh ? '联系客服' : 'Support'}</span>
        </button>
    );
}

function AiImageStudioEntryPlugin({ language, onNavigate }: Readonly<ClientPluginComponentProps>) {
    const isZh = language === 'zh';
    return (
        <button
            type="button"
            className="category-client-plugin category-client-plugin-image-studio"
            onClick={() => onNavigate({ name: 'image-studio' })}
        >
            <span className="category-client-plugin-icon" aria-hidden="true">
                <WandSparkles />
            </span>
            <span className="category-client-plugin-copy">
                <strong>{isZh ? 'AI 图片工坊' : 'AI Image Studio'}</strong>
                <span>
                    {isZh
                        ? '智能优化描述，选择模型快速生成图片'
                        : 'Improve your prompt, choose a model, and create images'}
                </span>
            </span>
            <span className="category-client-plugin-action">{isZh ? '开始创作' : 'Create'}</span>
        </button>
    );
}

function TwoFactorEntryPlugin({ language, onNavigate }: Readonly<ClientPluginComponentProps>) {
    const isZh = language === 'zh';
    return (
        <button
            type="button"
            className="category-client-plugin category-client-plugin-two-factor bg-[linear-gradient(135deg,#ecfdf5,#fff_55%,#ecfeff)]"
            onClick={() => onNavigate({ name: 'two-factor' })}
        >
            <span className="category-client-plugin-icon" aria-hidden="true">
                <KeyRound />
            </span>
            <span className="category-client-plugin-copy">
                <strong>{isZh ? '2FA 动态码' : '2FA codes'}</strong>
                <span>
                    {isZh
                        ? '密钥不上传，在当前浏览器本地生成'
                        : 'Generate codes locally without uploading secrets'}
                </span>
            </span>
            <span className="category-client-plugin-action">{isZh ? '立即使用' : 'Open'}</span>
        </button>
    );
}

const clientPluginRenderers: Readonly<Record<string, ComponentType<ClientPluginComponentProps> | undefined>> =
    {
        'category-coupon-entry': CouponEntryPlugin,
        'category-support-entry': SupportEntryPlugin,
        'ai-image-studio-entry': AiImageStudioEntryPlugin,
        'two-factor-code-tool': TwoFactorEntryPlugin,
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
}: Readonly<{
    block: StorefrontContentBlock | undefined;
    placement: ClientPluginPlacement;
    categoryContext?: CategoryClientPluginContext;
    toolsFirst?: boolean;
    language: StorefrontLanguage;
    onNavigate: (route: RouteState) => void;
}>) {
    const plugins = resolveClientPlugins(block, placement, categoryContext);
    if (!plugins.length) return null;
    // Desktop services group tools before assistance; preserve managed ordering within each group.
    const orderedPlugins = toolsFirst
        ? [
              ...plugins.filter(plugin => plugin.code !== 'category-support-entry'),
              ...plugins.filter(plugin => plugin.code === 'category-support-entry'),
          ]
        : plugins;
    return (
        <div className={`category-client-plugin-slot is-${placement.toLowerCase().replaceAll('_', '-')}`}>
            {orderedPlugins.map(({ code, item, Component }) => (
                <Component key={item.id || code} language={language} onNavigate={onNavigate} />
            ))}
        </div>
    );
}

export const resolveCategoryClientPlugins = resolveClientPlugins;
export const CategoryClientPluginSlot = ClientPluginSlot;
