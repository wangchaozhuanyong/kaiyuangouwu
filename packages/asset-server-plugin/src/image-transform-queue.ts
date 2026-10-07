import { clearTimeout, setTimeout } from 'node:timers';

export class ImageTransformBusyError extends Error {
    constructor() {
        super('Image transformation capacity exceeded');
    }
}

/** Authorization runs per request before entering this bounded, process-local conversion queue. */
export class ImageTransformQueue {
    private active = 0;
    private readonly pending = new Map<string, Promise<Buffer>>();
    private readonly waiting: Array<() => void> = [];

    constructor(
        private readonly concurrency = 2,
        private readonly capacity = 16,
        private readonly waitMs = 2000,
    ) {}

    run(key: string, load: () => Promise<Buffer>): Promise<Buffer> {
        const existing = this.pending.get(key);
        if (existing) return existing;
        if (this.active >= this.concurrency && this.waiting.length >= this.capacity)
            return Promise.reject(new ImageTransformBusyError());
        const pending = this.execute(load);
        this.pending.set(key, pending);
        void pending.then(
            () => this.pending.delete(key),
            () => this.pending.delete(key),
        );
        return pending;
    }

    private async execute(load: () => Promise<Buffer>): Promise<Buffer> {
        const release = await this.acquire();
        try {
            return await load();
        } finally {
            release();
        }
    }

    private acquire(): Promise<() => void> {
        const release = () => {
            const next = this.waiting.shift();
            if (next) next();
            else this.active--;
        };
        if (this.active < this.concurrency) {
            this.active++;
            return Promise.resolve(release);
        }
        if (this.waiting.length >= this.capacity) return Promise.reject(new ImageTransformBusyError());
        return new Promise((resolve, reject) => {
            const start = () => {
                clearTimeout(timer);
                resolve(release);
            };
            const timer = setTimeout(() => {
                const index = this.waiting.indexOf(start);
                if (index >= 0) this.waiting.splice(index, 1);
                reject(new ImageTransformBusyError());
            }, this.waitMs);
            this.waiting.push(start);
        });
    }
}
