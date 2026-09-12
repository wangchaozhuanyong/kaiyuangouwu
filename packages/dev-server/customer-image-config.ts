import {
    CustomerAvatarNamingStrategy,
    CustomerAvatarStorageStrategy,
    defaultAssetStorageStrategyFactory,
    PrivateImageObjectStore,
    type AssetServerOptions,
} from '@vendure/asset-server-plugin';
import path from 'node:path';

export function customerImageConfiguration(assetUploadDir: string, production: boolean, env = process.env) {
    const mode = env.CUSTOMER_IMAGE_STORAGE || 'local';
    if (!['local', 's3'].includes(mode)) throw new Error('CUSTOMER_IMAGE_STORAGE must be local or s3');
    const socket = env.CUSTOMER_IMAGE_PROCESSOR_SOCKET;
    if ((production && !socket) || (socket && !path.isAbsolute(socket))) {
        throw new Error('CUSTOMER_IMAGE_PROCESSOR_SOCKET must be an absolute socket path in production');
    }
    const avatarRoot =
        env.CUSTOMER_AVATAR_STORAGE_ROOT ||
        (production ? '' : path.join(path.dirname(assetUploadDir), 'customer-avatars'));
    if (!avatarRoot || (production && !path.isAbsolute(avatarRoot))) {
        throw new Error('CUSTOMER_AVATAR_STORAGE_ROOT must be an absolute persistent path in production');
    }
    const roots = [assetUploadDir, avatarRoot, env.IMAGE_GENERATION_STORAGE_ROOT]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .map(value => path.resolve(value));
    for (let i = 0; i < roots.length; i++)
        for (let j = i + 1; j < roots.length; j++) {
            if (
                roots[i] === roots[j] ||
                roots[i].startsWith(roots[j] + path.sep) ||
                roots[j].startsWith(roots[i] + path.sep)
            ) {
                throw new Error('Avatar, ordinary asset and private image directories must be separate');
            }
        }
    let avatarObjects: PrivateImageObjectStore | undefined;
    let privateObjects: PrivateImageObjectStore | undefined;
    let publicOrigin: string | undefined;
    if (mode === 's3') {
        const avatarBucket = env.CUSTOMER_AVATAR_S3_BUCKET;
        const privateBucket = env.CUSTOMER_PRIVATE_IMAGE_S3_BUCKET;
        if (!avatarBucket || !privateBucket || avatarBucket === privateBucket || !env.AWS_REGION) {
            throw new Error('S3 image storage requires two distinct buckets and AWS_REGION');
        }
        const url = new URL(env.CUSTOMER_AVATAR_CDN_ORIGIN || '');
        if (
            url.protocol !== 'https:' ||
            url.username ||
            url.password ||
            url.pathname !== '/' ||
            url.search ||
            url.hash
        ) {
            throw new Error(
                'CUSTOMER_AVATAR_CDN_ORIGIN must be an HTTPS origin without credentials or a path',
            );
        }
        publicOrigin = url.origin;
        avatarObjects = new PrivateImageObjectStore(avatarBucket, 'avatars/v2/');
        privateObjects = new PrivateImageObjectStore(privateBucket, 'private/v1/');
    }
    return {
        privateObjects,
        namingStrategy: new CustomerAvatarNamingStrategy(),
        storageStrategyFactory: (options: AssetServerOptions) =>
            new CustomerAvatarStorageStrategy(
                defaultAssetStorageStrategyFactory(options),
                path.resolve(avatarRoot),
                avatarObjects,
                publicOrigin,
            ),
    };
}
