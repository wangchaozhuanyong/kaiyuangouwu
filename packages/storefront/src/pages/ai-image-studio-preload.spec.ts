import { expect, it, vi } from 'vitest';

import { type ShopApi } from '../api';
import { type MarketConfig } from '../types';

const runtime = vi.hoisted(() => {
    let release = () => undefined as void;
    const gate = new Promise<void>(resolve => {
        release = resolve;
    });
    return { gate, release, imports: 0, preload: vi.fn().mockResolvedValue(undefined) };
});
vi.mock('./ai-image-studio-cache', async () => {
    runtime.imports++;
    await runtime.gate;
    return { preloadImageStudioData: runtime.preload };
});

import { clearStudioCache } from './ai-image-studio-cache-state';
import { prepareImageStudioData } from './ai-image-studio-preload';

it('loads only on intent, rejects pre-import logout/scope cancellation, and retains current warmup and optional-failure behavior', async () => {
    const api = {} as ShopApi;
    const market = { code: 'MY', currencyCode: 'MYR' } as MarketConfig;
    let current = true;
    expect(runtime.imports).toBe(0);
    expect(prepareImageStudioData(api, null, market, () => current)).toBeUndefined();
    clearStudioCache();
    prepareImageStudioData(api, null, market, () => current);
    current = false;
    runtime.release();
    await vi.dynamicImportSettled();
    expect(runtime.imports).toBe(1);
    expect(runtime.preload).not.toHaveBeenCalled();

    current = true;
    prepareImageStudioData(api, null, market, () => current);
    await vi.dynamicImportSettled();
    expect(runtime.preload).toHaveBeenCalledExactlyOnceWith(api, null, market);

    prepareImageStudioData(api, null, market, () => current);
    clearStudioCache();
    await vi.dynamicImportSettled();
    expect(runtime.preload).toHaveBeenCalledTimes(1);
    prepareImageStudioData(api, null, market, () => current);
    current = false;
    await vi.dynamicImportSettled();
    expect(runtime.preload).toHaveBeenCalledTimes(1);

    runtime.preload.mockRejectedValueOnce(new Error('optional warmup unavailable'));
    prepareImageStudioData(api, null, market, () => true);
    await vi.dynamicImportSettled();
    expect(runtime.preload).toHaveBeenCalledTimes(2);
});
