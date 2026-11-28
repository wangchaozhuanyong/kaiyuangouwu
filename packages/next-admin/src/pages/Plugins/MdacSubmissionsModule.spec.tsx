// @vitest-environment jsdom
import type { MdacAdminSubmission } from './mdac-submissions.graphql';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MdacSubmissionsModule } from './MdacSubmissionsModule';

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
    refetch: vi.fn().mockResolvedValue(undefined),
    retry: vi.fn(),
    cancel: vi.fn(),
}));

vi.mock('../../hooks/use-admin-query', () => ({
    useAdminQuery: (...args: unknown[]) => mocks.query(...args),
}));
vi.mock('@apollo/client/react', () => ({
    useMutation: (document: { definitions: Array<{ name?: { value: string } }> }) =>
        document.definitions[0]?.name?.value === 'RetryMdacSubmission'
            ? [mocks.retry, { loading: false }]
            : [mocks.cancel, { loading: false }],
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function row(overrides: Partial<MdacAdminSubmission> = {}): MdacAdminSubmission {
    return {
        id: 'job-1',
        status: 'FAILED',
        travelerName: 'ZHANG SAN',
        passportNo: 'E12345678',
        arrivalDate: '2026-12-20',
        attempts: 5,
        referenceNo: null,
        pin: null,
        lastError: 'captcha: slider did not verify',
        submittedAt: null,
        receiptAvailable: false,
        waitingForWindow: false,
        createdAt: '2026-11-28T08:00:00.000Z',
        ...overrides,
    };
}

function render(data: unknown, loading = false, error?: Error) {
    mocks.query.mockReturnValue({ data, loading, error, refetch: mocks.refetch });
    return act(() =>
        root.render(<MdacSubmissionsModule />),
    );
}

function button(label: string) {
    const match = [...host.querySelectorAll('button')].find(item =>
        item.textContent?.includes(label),
    );
    if (!match) throw new Error(`missing button: ${label}`);
    return match;
}

beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
});

describe('MDAC submission queue', () => {
    it('renders the empty state without inventing rows', () => {
        render({ mdacSubmissions: { items: [], totalItems: 0 } });
        expect(host.textContent).toContain('没有符合条件的提交任务');
    });

    it('lists tasks with the official reference and last error', () => {
        render({
            mdacSubmissions: {
                items: [
                    row({ status: 'DONE', referenceNo: 'MDAC998877', lastError: null }),
                    row({ id: 'job-2' }),
                ],
                totalItems: 2,
            },
        });
        expect(host.textContent).toContain('ZHANG SAN');
        expect(host.textContent).toContain('MDAC998877');
        expect(host.textContent).toContain('captcha: slider did not verify');
    });

    it('only offers retry on failed tasks and cancels queued ones', async () => {
        render({
            mdacSubmissions: { items: [row(), row({ id: 'job-2', status: 'QUEUED' })], totalItems: 2 },
        });
        expect([...host.querySelectorAll('button')].filter(b => b.textContent === '重新提交')).toHaveLength(1);
        expect([...host.querySelectorAll('button')].filter(b => b.textContent === '终止')).toHaveLength(1);

        mocks.retry.mockResolvedValue({});
        await act(async () => {
            button('重新提交').click();
        });
        expect(mocks.retry).toHaveBeenCalledWith({ variables: { id: 'job-1' } });
        expect(mocks.refetch).toHaveBeenCalled();
        expect(host.textContent).toContain('已重新排队');
    });

    it('keeps a read failure on the panel with an explicit retry', () => {
        render(undefined, false, new Error('network down'));
        expect(host.textContent).toContain('任务列表读取失败');
        expect(button('重新读取')).toBeTruthy();
    });
});
