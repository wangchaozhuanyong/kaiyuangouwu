import { readFileSync } from 'node:fs';
import { Node, Project, SyntaxKind } from 'ts-morph';
import { describe, expect, it } from 'vitest';

import {
    resolveBottomNavigationItems,
    shouldShowBottomNavigation,
} from './components/common/bottom-navigation';
import { StorefrontContentBlock, StorefrontContentItem } from './types';

function navigationItem(
    id: string,
    label: string,
    targetValue: string,
    imageUrl: string | null = null,
): StorefrontContentItem {
    return {
        id,
        enabled: true,
        position: Number(id.replace(/\D/g, '')) || 0,
        imageUrl,
        targetType: 'PAGE',
        targetValue,
        settings: null,
        label,
        description: '',
    };
}

function navigationBlock(items: StorefrontContentItem[]): StorefrontContentBlock {
    return {
        id: 'navigation',
        code: 'storefront-navigation',
        type: 'NAVIGATION',
        enabled: true,
        position: 10_000,
        startsAt: null,
        endsAt: null,
        imageUrl: null,
        backgroundColor: null,
        textColor: null,
        targetType: 'NONE',
        targetValue: null,
        settings: null,
        title: '客户端导航',
        subtitle: '',
        body: '',
        ctaLabel: '',
        items,
    };
}

describe('bottom navigation configuration', () => {
    it('places business services between shop and cart when no configuration is published', () => {
        expect(resolveBottomNavigationItems(undefined, 'zh').map(item => item.label)).toEqual([
            '首页',
            '商品',
            '智能服务',
            '购物车',
            '我的',
        ]);
    });

    it('uses configured names, order, targets and icons with a five-item limit', () => {
        const block = navigationBlock([
            navigationItem('1', '首页入口', '/', '/assets/home.webp'),
            navigationItem('2', '搜索', '/search'),
            navigationItem('3', '收藏', '/favorites'),
            navigationItem('4', '客服', '/support'),
            navigationItem('5', '我的账户', '/account'),
            navigationItem('6', '不会显示', '/orders'),
        ]);

        const items = resolveBottomNavigationItems(block, 'zh');
        expect(items).toHaveLength(5);
        expect(items.map(item => item.label)).toEqual(['首页入口', '搜索', '收藏', '客服', '我的账户']);
        expect(items[0]).toMatchObject({ target: '/', iconUrl: '/assets/home.webp' });
    });

    it('shows the navigation on configured destination pages while retaining root-page visibility', () => {
        const block = navigationBlock([navigationItem('1', '收藏', '/favorites')]);

        expect(shouldShowBottomNavigation('favorites', block)).toBe(true);
        expect(shouldShowBottomNavigation('services', block)).toBe(true);
        expect(shouldShowBottomNavigation('cart', block)).toBe(true);
        expect(shouldShowBottomNavigation('orders', block)).toBe(false);
    });

    it('keeps tablet navigation at the bottom and moves it into the desktop header at 1024px', () => {
        const source = readFileSync(
            new URL('./components/common/bottom-navigation.tsx', import.meta.url),
            'utf8',
        );

        expect(source).toContain('h-[calc(var(--bottom-navigation-height)+env(safe-area-inset-bottom,0px))]');
        expect(source).toContain('lg:top-0 lg:bottom-auto');
        expect(source).toContain('lg:shadow-none lg:backdrop-blur-none');
        expect(source).not.toContain('sm:top-0');
        expect(source).toContain('storefront-bottom-nav');
        expect(source).not.toContain('-translate-x-1/2');
    });

    it('mounts navigation outside storefront-app to prevent mobile Safari clipping traps', () => {
        const appSource = readFileSync(new URL('./storefront-shell.tsx', import.meta.url), 'utf8');
        const source = new Project({ useInMemoryFileSystem: true }).createSourceFile('App.tsx', appSource);
        const navigation = source
            .getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)
            .find(node => node.getTagNameNode().getText() === 'BottomNavigation');
        expect(navigation).toBeDefined();
        // Inspect JSX ancestry so wrapper providers and formatting cannot weaken the Safari guard.
        const insideApp = navigation
            ?.getAncestors()
            .some(
                ancestor =>
                    Node.isJsxElement(ancestor) &&
                    ancestor
                        .getOpeningElement()
                        .getAttribute('className')
                        ?.getText()
                        .includes('storefront-app'),
            );
        expect(insideApp).toBe(false);

        const stylesheet = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
        expect(stylesheet).toContain('.storefront-bottom-nav');
        expect(stylesheet).toContain('transform: translate3d(-50%, 0, 0)');
        expect(stylesheet).toContain('overscroll-behavior-y: none');
        expect(stylesheet).toContain('scrollbar-width: none');
    });
});
