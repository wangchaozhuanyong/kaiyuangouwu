import { RequestContext } from '@vendure/core';
import path from 'node:path';

import { HashedAssetNamingStrategy } from './hashed-asset-naming-strategy';

export class CustomerAvatarNamingStrategy extends HashedAssetNamingStrategy {
    generateSourceFileName(ctx: RequestContext, filename: string, conflict?: string): string {
        const generated = super.generateSourceFileName(ctx, filename, conflict);
        return /^customer-avatar-[a-zA-Z0-9-]+\.webp$/.test(filename)
            ? `avatars/v2/source/${path.basename(generated)}`
            : generated;
    }

    generatePreviewFileName(ctx: RequestContext, filename: string, conflict?: string): string {
        const generated = super.generatePreviewFileName(ctx, filename, conflict);
        return filename.startsWith('avatars/v2/')
            ? `avatars/v2/preview/${path.basename(generated)}`
            : generated;
    }
}
