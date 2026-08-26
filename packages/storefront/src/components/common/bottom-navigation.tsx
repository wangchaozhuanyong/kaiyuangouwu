/* eslint-disable max-len -- Tailwind utility strings must remain intact for static extraction. */
import { Link } from '@tanstack/react-router';
import clsx from 'clsx';
import { House, LayoutGrid, ShoppingCart, UserRound } from 'lucide-react';
import { ReactNode } from 'react';
import { twMerge } from 'tailwind-merge';
import type { MainPage } from '../../storefront-router';

import { StorefrontLanguage } from '../../types';

function cn(...classes: Array<string | undefined | null | false>) {
    return twMerge(clsx(classes));
}

export function BottomNavigation({
    active,
    cartQuantity,
    language,
}: {
    active: MainPage;
    cartQuantity: number;
    language: StorefrontLanguage;
}) {
    const isZh = language === 'zh';
    const items: Array<{
        id: MainPage;
        label: string;
        activeColor: string;
        icon: (isActive: boolean) => ReactNode;
    }> = [
        {
            id: 'home',
            label: isZh ? '首页' : 'Home',
            activeColor: '#EF4444', // text-red-500
            icon: isActive => (
                <House
                    className={cn(
                        'w-6 h-6 transition-transform duration-200',
                        isActive
                            ? 'text-red-500 scale-[1.15] drop-shadow-[0_2px_6px_rgba(239,68,68,0.35)]'
                            : 'text-slate-500',
                    )}
                />
            ),
        },
        {
            id: 'category',
            label: isZh ? '商品' : 'Shop',
            activeColor: '#3B82F6', // text-blue-500
            icon: isActive => (
                <LayoutGrid
                    className={cn(
                        'w-6 h-6 transition-transform duration-200',
                        isActive
                            ? 'text-blue-500 scale-[1.15] drop-shadow-[0_2px_6px_rgba(59,130,246,0.35)]'
                            : 'text-slate-500',
                    )}
                />
            ),
        },
        {
            id: 'cart',
            label: isZh ? '购物车' : 'Cart',
            activeColor: '#F59E0B', // text-amber-500
            icon: isActive => (
                <ShoppingCart
                    className={cn(
                        'w-6 h-6 transition-transform duration-200',
                        isActive
                            ? 'text-amber-500 scale-[1.15] drop-shadow-[0_2px_6px_rgba(245,158,11,0.35)]'
                            : 'text-slate-500',
                    )}
                />
            ),
        },
        {
            id: 'account',
            label: isZh ? '我的' : 'Account',
            activeColor: '#10B981', // text-emerald-500
            icon: isActive => (
                <UserRound
                    className={cn(
                        'w-6 h-6 transition-transform duration-200',
                        isActive
                            ? 'text-emerald-500 scale-[1.15] drop-shadow-[0_2px_6px_rgba(16,185,129,0.35)]'
                            : 'text-slate-500',
                    )}
                />
            ),
        },
    ];

    return (
        <nav
            className="fixed bottom-0 left-1/2 z-20 grid w-full max-w-[430px] -translate-x-1/2 grid-cols-4 border-t border-black/5 bg-white/95 px-2 pb-[calc(8px+env(safe-area-inset-bottom,0px))] pt-1.5 shadow-[0_-2px_14px_rgba(15,23,42,0.04)] backdrop-blur-md sm:top-0 sm:bottom-auto sm:h-[72px] sm:max-w-[420px] sm:border-t-0 sm:bg-transparent"
            aria-label={isZh ? '主导航' : 'Main navigation'}
        >
            {items.map(item => {
                const isActive = active === item.id;
                return (
                    <Link
                        key={item.id}
                        className={cn(
                            'flex w-[56px] min-w-[56px] flex-col items-center justify-center justify-self-center rounded-xl border-0 bg-transparent p-0.5 text-slate-500 transition-transform active:scale-95 sm:gap-[3px] sm:hover:bg-slate-100 sm:hover:text-slate-900',
                            isActive && 'font-bold text-slate-900 sm:hover:bg-transparent',
                        )}
                        aria-current={isActive ? 'page' : undefined}
                        to={item.id === 'home' ? '/' : `/${item.id}`}
                    >
                        <span className="relative flex h-[24px] w-[26px] items-center justify-center">
                            {item.icon(isActive)}
                            {item.id === 'cart' && cartQuantity > 0 && (
                                <b className="absolute -right-2 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full border-[1.5px] border-white bg-red-500 px-1 text-[10px] font-bold leading-none text-white shadow-sm">
                                    {cartQuantity > 99 ? '99+' : cartQuantity}
                                </b>
                            )}
                        </span>
                        <span
                            className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-tight sm:text-[13px]"
                            style={{
                                color: isActive ? item.activeColor : '#64748B',
                                fontWeight: isActive ? 700 : 500,
                            }}
                        >
                            {item.label}
                        </span>
                    </Link>
                );
            })}
        </nav>
    );
}
