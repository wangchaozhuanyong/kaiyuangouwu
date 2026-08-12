import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { PreviewPreset } from './asset-preview.js';

export interface AssetPreviewSelectorProps {
    size: PreviewPreset;
    setSize: (size: PreviewPreset) => void;
    width: number;
    height: number;
}

export function AssetPreviewSelector({ size, setSize, width, height }: Readonly<AssetPreviewSelectorProps>) {
    const { t } = useLingui();
    return (
        <div className="flex items-center gap-2">
            <Select
                items={{
                    tiny: 'Tiny',
                    thumb: 'Thumb',
                    small: 'Small',
                    medium: 'Medium',
                    large: 'Large',
                    full: 'Full Size',
                }}
                value={size}
                onValueChange={value => setSize(value as PreviewPreset)}
            >
                <SelectTrigger>
                    <SelectValue placeholder={t`Select size`} />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="tiny">
                        <Trans>Tiny</Trans>
                    </SelectItem>
                    <SelectItem value="thumb">
                        <Trans>Thumbnail</Trans>
                    </SelectItem>
                    <SelectItem value="small">
                        <Trans>Small</Trans>
                    </SelectItem>
                    <SelectItem value="medium">
                        <Trans>Medium</Trans>
                    </SelectItem>
                    <SelectItem value="large">
                        <Trans>Large</Trans>
                    </SelectItem>
                    <SelectItem value="full">
                        <Trans>Full size</Trans>
                    </SelectItem>
                </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
                {width} x {height}
            </p>
        </div>
    );
}
