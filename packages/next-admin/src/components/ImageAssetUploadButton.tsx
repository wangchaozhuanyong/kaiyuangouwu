import { UploadCloud } from 'lucide-react';
import { useRef, useState } from 'react';
import { uploadAdminFiles } from '../apollo';
import { CREATE_ASSETS_MULTIPART } from '../graphql/catalog-admin.graphql';
import { useAdminPermissions } from '../hooks/use-admin-permissions';
import { toUserFacingError } from '../utils/user-facing-error';

export interface UploadedImageAsset {
    id: string;
    name: string;
    preview: string;
    source: string;
    type: string;
    fileSize?: number;
    mimeType?: string;
    width?: number;
    height?: number;
}

interface CreateAssetResult extends Partial<UploadedImageAsset> {
    __typename: 'Asset' | 'MimeTypeError';
    message?: string;
}

interface CreateAssetsData {
    createAssets: CreateAssetResult[];
}

const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function ImageAssetUploadButton({
    onUploaded,
    multiple = false,
    disabled = false,
    channelToken,
    label = '上传图片',
    ariaLabel = label,
    className = '',
}: {
    onUploaded: (assets: UploadedImageAsset[]) => void;
    multiple?: boolean;
    disabled?: boolean;
    channelToken?: string;
    label?: string;
    ariaLabel?: string;
    className?: string;
}) {
    const { hasAnyPermission } = useAdminPermissions();
    const canCreateAssets = hasAnyPermission(['CreateCatalog', 'CreateAsset']);
    const inputRef = useRef<HTMLInputElement>(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');
    const unavailable = disabled || uploading || !canCreateAssets;

    const uploadImages = async (files: File[]) => {
        if (files.length === 0 || unavailable) return;
        const unsupported = files.find(file => !SUPPORTED_IMAGE_TYPES.has(file.type));
        if (unsupported) {
            setError(`《${unsupported.name}》仅支持 JPG、PNG 或 WebP 图片`);
            return;
        }
        const oversized = files.find(file => file.size > MAX_IMAGE_SIZE_BYTES);
        if (oversized) {
            setError(`《${oversized.name}》超过 20 MB，请压缩后重试`);
            return;
        }

        setUploading(true);
        setError('');
        try {
            const result = await uploadAdminFiles<CreateAssetsData>(
                CREATE_ASSETS_MULTIPART,
                files,
                placeholders => ({
                    input: placeholders.map(file => ({ file, tags: ['后台上传'] })),
                }),
                channelToken ? { channelToken } : undefined,
            );
            const uploaded: UploadedImageAsset[] = [];
            const failures: string[] = [];
            result.createAssets.forEach((asset, index) => {
                if (
                    asset?.__typename === 'Asset' &&
                    asset.id &&
                    asset.name &&
                    asset.preview &&
                    asset.source &&
                    asset.type
                ) {
                    uploaded.push(asset as UploadedImageAsset);
                } else {
                    failures.push(asset?.message || `《${files[index]?.name ?? '未知文件'}》上传失败`);
                }
            });
            if (uploaded.length > 0) onUploaded(uploaded);
            if (failures.length > 0) {
                setError(
                    uploaded.length > 0
                        ? `已上传 ${uploaded.length} 张；${failures.join('；')}`
                        : failures.join('；'),
                );
            }
        } catch (uploadError) {
            setError(toUserFacingError(uploadError, '图片上传失败，请稍后重试'));
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className={`inline-flex min-w-0 flex-col items-start gap-1 ${className}`}>
            <input
                ref={inputRef}
                type="file"
                multiple={multiple}
                accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                disabled={unavailable}
                className="sr-only"
                aria-label={`${ariaLabel}文件`}
                aria-hidden="true"
                tabIndex={-1}
                onChange={event => {
                    const files = Array.from(event.currentTarget.files ?? []);
                    event.currentTarget.value = '';
                    void uploadImages(multiple ? files : files.slice(0, 1));
                }}
            />
            <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={unavailable}
                aria-label={ariaLabel}
                aria-busy={uploading}
                title={!canCreateAssets ? '需要素材创建权限，请联系管理员' : undefined}
                className="flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
                <UploadCloud className={`h-3.5 w-3.5 ${uploading ? 'animate-pulse' : ''}`} />
                {uploading ? '上传中…' : label}
            </button>
            {error && (
                <span className="max-w-64 text-[11px] leading-4 text-rose-600" role="alert">
                    {error}
                </span>
            )}
        </div>
    );
}
