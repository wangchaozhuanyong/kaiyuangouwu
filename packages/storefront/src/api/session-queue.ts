type Entry = { exclusive: boolean; start: () => void };
class RequestQueue {
    #active = 0;
    #writing = false;
    readonly #waiting: Entry[] = [];

    run<T>(exclusive: boolean, signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const abort = () => {
                const index = this.#waiting.indexOf(entry);
                if (index < 0) return;
                this.#waiting.splice(index, 1);
                signal?.removeEventListener('abort', abort);
                const reason: unknown = signal?.reason;
                reject(
                    reason instanceof Error || reason instanceof DOMException
                        ? reason
                        : new DOMException('Request aborted', 'AbortError'),
                );
                this.#drain();
            };
            const entry: Entry = {
                exclusive,
                start: () => {
                    signal?.removeEventListener('abort', abort);
                    this.#active++;
                    this.#writing = exclusive;
                    let result: Promise<T>;
                    try {
                        signal?.throwIfAborted();
                        result = operation();
                    } catch (error) {
                        result = Promise.reject(sessionRequestError(error));
                    }
                    Promise.resolve(result)
                        .then(resolve, error => reject(sessionRequestError(error)))
                        .finally(() => {
                            this.#active--;
                            this.#writing = false;
                            this.#drain();
                        });
                },
            };
            this.#waiting.push(entry);
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted) abort();
            else this.#drain();
        });
    }

    #drain(): void {
        while (this.#waiting.length && !this.#writing) {
            const entry = this.#waiting[0];
            if (entry.exclusive && this.#active) return;
            this.#waiting.shift();
            entry.start();
        }
    }
}
const browserQueues = new Map<string, RequestQueue>();

export function localSessionTransport<T>(
    key: string,
    exclusive: boolean,
    signal: AbortSignal | undefined,
    operation: () => Promise<T>,
): Promise<T> {
    let queue = browserQueues.get(key);
    if (!queue) browserQueues.set(key, (queue = new RequestQueue()));
    return queue.run(exclusive, signal, operation);
}

function sessionRequestError(reason: unknown): Error | DOMException {
    return reason instanceof Error || reason instanceof DOMException
        ? reason
        : new Error('Session request failed', { cause: reason });
}
