import { AssetStorageStrategy } from '@vendure/core';
import { Request } from 'express';
import { ReadStream } from 'fs';
import fs from 'fs-extra';
import { randomUUID } from 'node:crypto';
import path from 'path';
import { Stream } from 'stream';
import { pipeline } from 'stream/promises';

/**
 * @description
 * A persistence strategy which saves files to the local file system.
 *
 * @docsCategory core plugins/AssetServerPlugin
 */
export class LocalAssetStorageStrategy implements AssetStorageStrategy {
    toAbsoluteUrl: ((reqest: Request, identifier: string) => string) | undefined;

    constructor(
        private readonly uploadPath: string,
        private readonly toAbsoluteUrlFn?: (reqest: Request, identifier: string) => string,
    ) {
        fs.ensureDirSync(this.uploadPath);
        if (toAbsoluteUrlFn) {
            this.toAbsoluteUrl = toAbsoluteUrlFn;
        }
    }

    async writeFileFromStream(
        fileName: string,
        data: ReadStream,
        encoding?: BufferEncoding | null,
    ): Promise<string> {
        const filePath = path.join(this.uploadPath, fileName);
        const directory = path.dirname(filePath);
        await fs.ensureDir(directory);
        const temporaryPath = path.join(directory, `.upload-${randomUUID()}`);
        try {
            await pipeline(
                data,
                fs.createWriteStream(temporaryPath, {
                    encoding: encoding === undefined ? 'binary' : (encoding ?? undefined),
                    flags: 'wx',
                }),
            );
            await fs.rename(temporaryPath, filePath);
            return this.filePathToIdentifier(filePath);
        } catch (error) {
            await fs.remove(temporaryPath).catch(() => undefined);
            throw error;
        }
    }

    async writeFileFromBuffer(fileName: string, data: Buffer): Promise<string> {
        const filePath = path.join(this.uploadPath, fileName);
        await fs.ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, data, 'binary');
        return this.filePathToIdentifier(filePath);
    }

    fileExists(fileName: string): Promise<boolean> {
        return new Promise(resolve => {
            fs.access(this.identifierToFilePath(fileName), fs.constants.F_OK, err => {
                resolve(!err);
            });
        });
    }

    readFileToBuffer(identifier: string): Promise<Buffer> {
        return fs.readFile(this.identifierToFilePath(identifier));
    }

    readFileToStream(identifier: string, encoding?: BufferEncoding | null): Promise<Stream> {
        const readStream = fs.createReadStream(
            this.identifierToFilePath(identifier),
            encoding === undefined ? 'binary' : encoding === null ? undefined : encoding,
        );
        return Promise.resolve(readStream);
    }

    deleteFile(identifier: string): Promise<void> {
        return fs.unlink(this.identifierToFilePath(identifier));
    }

    private filePathToIdentifier(filePath: string): string {
        const filePathDirname = path.dirname(filePath);
        const deltaDirname = filePathDirname.replace(this.uploadPath, '');
        const identifier = path.join(deltaDirname, path.basename(filePath));
        return identifier.replace(/^[\\/]+/, '');
    }

    private identifierToFilePath(identifier: string): string {
        return path.join(this.uploadPath, identifier);
    }
}
