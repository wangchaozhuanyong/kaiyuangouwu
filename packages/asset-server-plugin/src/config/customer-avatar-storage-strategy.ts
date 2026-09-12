import { AssetStorageStrategy, processCustomerImage } from '@vendure/core';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Stream } from 'node:stream';

import { PrivateImageObjectStore } from './private-image-object-store';

const PREFIX = 'avatars/v2/';

/** Only the new avatar namespace changes backend; ordinary and legacy assets keep their original paths. */
export class CustomerAvatarStorageStrategy implements AssetStorageStrategy {
    constructor(
        private readonly original: AssetStorageStrategy,
        private readonly localRoot: string,
        private readonly objects?: PrivateImageObjectStore,
        private readonly publicOrigin?: string,
    ) {}

    async destroy(): Promise<void> {
        this.objects?.destroy();
        await this.original.destroy?.();
    }

    toAbsoluteUrl(request: any, identifier: string): string {
        if (identifier.startsWith(PREFIX) && this.publicOrigin) return `${this.publicOrigin}/${identifier}`;
        return this.original.toAbsoluteUrl?.(request, identifier) ?? identifier;
    }

    private localPath(key: string): string {
        const candidate = path.resolve(this.localRoot, key);
        if (!key.startsWith(PREFIX) || !candidate.startsWith(path.resolve(this.localRoot) + path.sep))
            throw new Error('Invalid avatar path');
        return candidate;
    }

    async writeFileFromBuffer(key: string, bytes: Buffer): Promise<string> {
        if (!key.startsWith(PREFIX)) return this.original.writeFileFromBuffer(key, bytes);
        // Also covers an administrator uploading a file under the reserved namespace.
        const normalized = await processCustomerImage(bytes, 'avatar');
        if (this.objects) await this.objects.put(key, normalized);
        else {
            const file = this.localPath(key);
            await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
            try {
                await writeFile(file, normalized, { mode: 0o600, flag: 'wx' });
            } catch (error) {
                if (
                    (error as NodeJS.ErrnoException).code !== 'EEXIST' ||
                    !(await readFile(file)).equals(normalized)
                )
                    throw error;
            }
        }
        return key;
    }

    async writeFileFromStream(key: string, stream: Stream): Promise<string> {
        if (!key.startsWith(PREFIX)) return this.original.writeFileFromStream(key, stream);
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of stream as Readable) {
            size += chunk.length;
            if (size > 5 * 1024 * 1024) throw new Error('Avatar too large');
            chunks.push(Buffer.from(chunk));
        }
        return this.writeFileFromBuffer(key, Buffer.concat(chunks));
    }

    async readFileToBuffer(key: string): Promise<Buffer> {
        if (!key.startsWith(PREFIX)) return this.original.readFileToBuffer(key);
        return this.objects ? this.objects.get(key) : readFile(this.localPath(key));
    }

    async readFileToStream(key: string): Promise<Stream> {
        if (!key.startsWith(PREFIX)) return this.original.readFileToStream(key);
        return Readable.from(await this.readFileToBuffer(key));
    }

    async fileExists(key: string): Promise<boolean> {
        if (!key.startsWith(PREFIX)) return this.original.fileExists(key);
        if (this.objects) return this.objects.has(key);
        try {
            await readFile(this.localPath(key));
            return true;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
            throw error;
        }
    }

    async deleteFile(key: string): Promise<void> {
        if (!key.startsWith(PREFIX)) return this.original.deleteFile(key);
        if (this.objects) await this.objects.delete(key);
        else {
            try {
                await unlink(this.localPath(key));
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }
        }
    }
}
