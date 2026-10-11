// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDeferredHomeCatalogs } from './useDeferredHomeCatalogs';

afterEach(() => vi.unstubAllGlobals());
describe('home catalog viewport ownership', () => {
    it('registers a home section that mounts after the parent query hook', async () => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        const targets: Element[] = [];
        vi.stubGlobal(
            'IntersectionObserver',
            class {
                observe(target: Element) {
                    targets.push(target);
                }
                unobserve() {
                    // This case records registration only.
                }
                disconnect() {
                    // No native observer resources exist in this fixture.
                }
            },
        );
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        let mounted = false;
        function Harness() {
            useDeferredHomeCatalogs('late-home:MYR:zh', true);
            return mounted ? <section data-home-catalog="sales" /> : null;
        }
        try {
            await act(async () => {
                root.render(<Harness />);
                await Promise.resolve();
            });
            expect(targets).toHaveLength(0);
            mounted = true;
            await act(async () => {
                root.render(<Harness />);
                await Promise.resolve();
            });
            expect(targets).toEqual([host.querySelector('[data-home-catalog]')]);
        } finally {
            act(() => root.unmount());
            host.remove();
        }
    });

    it('activates only the nearby catalog and rejects late callbacks from the previous scope', async () => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        const records: Array<{ callback: IntersectionObserverCallback; targets: Element[] }> = [];
        vi.stubGlobal(
            'IntersectionObserver',
            class {
                record: (typeof records)[number];
                constructor(callback: IntersectionObserverCallback) {
                    this.record = { callback, targets: [] };
                    records.push(this.record);
                }
                observe(target: Element) {
                    this.record.targets.push(target);
                }
                unobserve() {
                    // Retain recorded targets to exercise late native callbacks.
                }
                disconnect() {
                    // Retain the callback so the previous-scope guard is verified.
                }
            },
        );
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);
        let scope = 'channel-a:zh';
        function Harness() {
            const state = useDeferredHomeCatalogs(scope, true);
            return (
                <>
                    <output>{JSON.stringify(state)}</output>
                    <section data-home-catalog="sales" />
                    <section data-home-catalog="recommended" />
                </>
            );
        }
        const enter = (record: (typeof records)[number], target: Element) =>
            record.callback(
                [{ target, isIntersecting: true } as IntersectionObserverEntry],
                {} as IntersectionObserver,
            );
        try {
            await act(async () => {
                root.render(<Harness />);
                await Promise.resolve();
            });
            expect(host.querySelector('output')?.textContent).toContain('"sales":false');
            expect(records[0].targets).toHaveLength(2);
            await act(async () => {
                enter(records[0], records[0].targets[0]);
                await Promise.resolve();
            });
            expect(host.querySelector('output')?.textContent).toContain('"sales":true');
            expect(host.querySelector('output')?.textContent).toContain('"recommended":false');
            scope = 'channel-b:en';
            await act(async () => {
                root.render(<Harness />);
                await Promise.resolve();
            });
            await act(async () => {
                enter(records[0], records[0].targets[1]);
                await Promise.resolve();
            });
            expect(host.querySelector('output')?.textContent).toContain('"recommended":false');
            await act(async () => {
                enter(records[1], records[1].targets[1]);
                await Promise.resolve();
            });
            expect(host.querySelector('output')?.textContent).toContain('"recommended":true');
            expect(host.querySelector('output')?.textContent).toContain('"sales":false');
        } finally {
            act(() => root.unmount());
            host.remove();
        }
    });
});
