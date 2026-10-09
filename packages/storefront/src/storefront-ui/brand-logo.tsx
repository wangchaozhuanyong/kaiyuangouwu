import { Store } from 'lucide-react';

import { responsiveImageSources } from '../responsive-image';
import { SafeImage } from '../safe-image';

export function BrandLogo({ url, name, className }: { url: string | null; name: string; className: string }) {
    const sourceUrl = url?.trim() || null;
    const responsiveSource = sourceUrl ? responsiveImageSources(sourceUrl, 'thumbnail') : null;

    if (!responsiveSource) {
        return (
            <span className={`${className} is-brand-fallback`} aria-hidden="true">
                <Store size={24} />
            </span>
        );
    }

    return (
        <span className={`${className} is-brand-image`}>
            <SafeImage
                src={sourceUrl ?? ''}
                imageKind="thumbnail"
                sizes="36px"
                width={36}
                height={36}
                alt={name}
            />
        </span>
    );
}
