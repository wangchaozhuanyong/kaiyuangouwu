import { type Customer } from '@vendure/core';

import { type ReferralWithdrawal } from '../entities/referral-withdrawal.entity';
const MAX_PAGE_SIZE = 200;

export function businessDateKey(value: Date): string {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        })
            .formatToParts(value)
            .filter(part => ['year', 'month', 'day'].includes(part.type))
            .map(part => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
}

export function businessDayRange(value: Date): { businessDate: string; start: Date; end: Date } {
    const businessDate = businessDateKey(value);
    const start = new Date(`${businessDate}T00:00:00+08:00`);
    return { businessDate, start, end: new Date(start.getTime() + 86_400_000) };
}

export function utcDatabaseTimestamp(value: Date): string {
    return value.toISOString().replace('T', ' ').replace('Z', '');
}

export function customerName(customer: Customer): string {
    return `${customer.lastName ?? ''}${customer.firstName ?? ''}`.trim() || customer.emailAddress;
}

export function maskedCustomerName(customer: Customer): string {
    const name = customerName(customer);
    if (name.includes('@')) {
        const [local, domain] = name.split('@');
        return `${local.slice(0, 2)}***@${domain}`;
    }
    return name.length <= 1 ? `${name}*` : `${name.slice(0, 1)}${'*'.repeat(Math.min(3, name.length - 1))}`;
}

export function pageSize(value: number): number {
    return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(value || 100)));
}

export function withdrawalView(withdrawal: ReferralWithdrawal, customer: Customer) {
    return {
        ...withdrawal,
        customerName: customerName(customer),
        customerEmail: customer.emailAddress,
    };
}
