// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MdacSubmissionService, MdacSubmissionView } from './mdac-submission';

import { MdacSubmitPanel } from './submit-panel';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

const traveler = { name: 'ZHANG SAN', passNo: 'E12345678', nationality: 'CHN' };
const shared = {
    arrDt: '2026-12-20',
    depDt: '2026-12-29',
    email: 'traveler@example.com',
    region: '86',
    mobile: '13800138000',
    trvlMode: '1',
    embark: 'CHN',
    vesselNm: 'MH123',
    accommodationStay: '01',
    accommodationAddress1: '1 JALAN BUKIT BINTANG',
    accommodationState: '14',
    accommodationPostcode: '55100',
    accommodationCity: 'KUALA LUMPUR',
};

function view(
    status: MdacSubmissionView['status'],
    extra: Partial<MdacSubmissionView> = {},
): MdacSubmissionView {
    return {
        id: 'b5b1f2f6-1c6c-4e2f-9c3a-0f0e1a2b3c4d',
        status,
        referenceNo: status === 'DONE' ? 'MDAC998877' : null,
        pin: status === 'DONE' ? 'AB12CD34' : null,
        attempts: 1,
        lastError: null,
        submittedAt: null,
        receiptAvailable: status === 'DONE',
        waitingForWindow: false,
        travelerName: 'ZHANG SAN',
        arrivalDate: '2026-12-20',
        ...extra,
    };
}

function service(overrides: Partial<MdacSubmissionService> = {}): MdacSubmissionService {
    return {
        create: vi.fn(() => Promise.resolve(view('QUEUED'))),
        status: vi.fn(() => Promise.resolve(view('DONE'))),
        receipt: vi.fn(() => Promise.resolve(null)),
        ...overrides,
    };
}

function render(props: Partial<Parameters<typeof MdacSubmitPanel>[0]> = {}) {
    return act(() =>
        root.render(
            <MdacSubmitPanel
                language="zh"
                travelers={[traveler]}
                shared={shared}
                scope="damatong.net"
                disabled={false}
                {...props}
            />,
        ),
    );
}

function button(label: string) {
    const match = [...host.querySelectorAll('button')].find(item => item.textContent?.includes(label));
    assert.ok(match, `missing button: ${label}`);
    return match;
}

beforeEach(() => {
    localStorage.clear();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

it('keeps submission disabled until the traveller confirms the trip', () => {
    render({ service: service(), disabled: true });
    expect(button('提交入境卡').disabled).toBe(true);
});

it('explains that automatic submission is off instead of hiding the manual route', () => {
    render();
    expect(host.textContent).toContain('当前环境未启用自动提交');
});

it('submits every traveller with official field names and reports the receipt', async () => {
    vi.useFakeTimers();
    const submit = service();
    render({ service: submit });
    await act(async () => {
        button('提交入境卡').click();
        await vi.advanceTimersByTimeAsync(5000);
    });
    expect(submit.create).toHaveBeenCalledTimes(1);
    const input = (submit.create as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, string>;
    expect(input.arrDt).toBe('20/12/2026');
    expect(input.depDt).toBe('29/12/2026');
    expect(input.accommodationCity).toBe('KUALA LUMPUR');
    expect(submit.status).toHaveBeenCalled();
    expect(host.textContent).toContain('已提交');
    expect(host.textContent).toContain('MDAC998877');
    expect(host.textContent).toContain('下载回执');
});

it('explains a disabled submission service and leaves the button usable', async () => {
    vi.useFakeTimers();
    const failing = service({
        create: vi.fn(() => Promise.reject(new Error('自动提交服务尚未启用，请使用官方入口完成提交'))),
    });
    render({ service: failing });
    await act(async () => {
        button('提交入境卡').click();
        await vi.advanceTimersByTimeAsync(1000);
    });
    expect(host.textContent).toContain('自动提交服务尚未启用，请使用官方入口完成提交。');
    expect(button('提交入境卡').disabled).toBe(false);
});
