import {
    type TaxFreeAddressClaim,
    type TaxFreeAddressStatus,
} from '../../../storefront-content-plugin/src/tax-free-address-contract';

export interface TaxFreeAddressApi {
    status(signal: AbortSignal): Promise<TaxFreeAddressStatus>;
    claim(requestId: string): Promise<TaxFreeAddressClaim>;
}
async function addressRequest<T>(path: '/api/address/status' | '/api/address/claim', options?: RequestInit) {
    const controller = new AbortController();
    const cancel = () => controller.abort(options?.signal?.reason);
    options?.signal?.addEventListener('abort', cancel, { once: true });
    if (options?.signal?.aborted) cancel();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
        const response = await fetch(path, {
            ...options,
            signal: controller.signal,
            credentials: 'same-origin',
            cache: 'no-store',
            redirect: 'error',
            referrerPolicy: 'no-referrer',
        });
        if (!response.ok) {
            const body = (await response.json().catch(() => null)) as { code?: unknown } | null;
            throw new Error(typeof body?.code === 'string' ? body.code : 'TAX_ADDRESS_UNAVAILABLE');
        }
        return (await response.json()) as T;
    } finally {
        window.clearTimeout(timeout);
        options?.signal?.removeEventListener('abort', cancel);
    }
}
export const standaloneAddressApi: TaxFreeAddressApi = {
    status: signal => addressRequest<TaxFreeAddressStatus>('/api/address/status', { signal }),
    claim: requestId =>
        addressRequest<TaxFreeAddressClaim>('/api/address/claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId }),
        }),
};
export function taxAddressError(error: unknown, zh = true): string {
    const message = error instanceof Error ? error.message : '';
    const descriptions: Record<string, [string, string]> = {
        COOLDOWN: [
            '每个浏览器每 5 分钟可提取一次，请等待倒计时结束。',
            'Please wait five minutes between requests in this browser.',
        ],
        RATE_LIMIT: ['请求过于频繁，请稍后重试。', 'Too many requests. Please try again later.'],
        EXHAUSTED: [
            '地址生成范围已用尽，请联系管理员。',
            'The address template pool is exhausted. Please contact support.',
        ],
        BROWSER_REQUIRED: [
            '请重新读取状态，并允许本站 Cookie。',
            'Refresh status and allow cookies for this site.',
        ],
        RESULT_EXPIRED: [
            '原请求已完成，但该地址已从后台清理。请查看本机记录；本次没有重新提取。',
            'The original request completed, but its address was pruned. Check local history; no new address was allocated.',
        ],
        CAPACITY: ['地址库已满，未使用地址会继续保留。', 'The pool is full. Unused addresses are preserved.'],
        CONFLICT: ['地址库已更新，请刷新后重新确认。', 'The pool changed. Refresh and review again.'],
        ALREADY_USED: [
            '地址已被其他请求提取，请刷新列表。',
            'This address was already claimed. Refresh the list.',
        ],
    };
    const match = Object.keys(descriptions).find(code => message.includes('TAX_ADDRESS_' + code));
    return match
        ? descriptions[match][zh ? 0 : 1]
        : zh
          ? '请求失败或结果暂时无法确认。重试会核对原请求，不会重复领取。'
          : 'The request failed or its result is unknown. Retry checks the same request without allocating twice.';
}
