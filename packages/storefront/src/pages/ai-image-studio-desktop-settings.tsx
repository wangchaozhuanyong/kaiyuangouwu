import { ChevronDown } from 'lucide-react';

import { ImageResolution, ImageStudioModel } from '../types';

import { customerImageResolutions, imageResolutionAvailability } from './ai-image-studio-resolution';

/** Desktop presentation only. Selection, availability and billing remain owned by the page. */
export function ImageStudioDesktopSettings({
    isZh,
    models,
    selectedModel,
    aspectRatios,
    aspectRatio,
    resolution,
    quantity,
    maxQuantity,
    formatPrice,
    onModelChange,
    onAspectRatioChange,
    onResolutionChange,
    onQuantityChange,
}: Readonly<{
    isZh: boolean;
    models: ImageStudioModel[];
    selectedModel: ImageStudioModel | undefined;
    aspectRatios: readonly string[];
    aspectRatio: string;
    resolution: ImageResolution;
    quantity: number;
    maxQuantity: number;
    formatPrice(amount: number): string;
    onModelChange(code: string): void;
    onAspectRatioChange(value: string): void;
    onResolutionChange(value: ImageResolution): void;
    onQuantityChange(value: number): void;
}>) {
    return (
        <div className="ai-studio-desktop-settings">
            <label className="ai-studio-desktop-model">
                <span>{isZh ? '模型选择' : 'Model'}</span>
                <div className="ai-studio-desktop-select">
                    <select
                        value={selectedModel?.code ?? ''}
                        onChange={event => onModelChange(event.target.value)}
                        title={selectedModel?.officialModelId}
                    >
                        {!selectedModel ? (
                            <option value="">{isZh ? '请选择模型' : 'Choose model'}</option>
                        ) : null}
                        {models.map(model => (
                            <option key={model.code} value={model.code}>
                                {model.officialModelId}
                            </option>
                        ))}
                    </select>
                    <ChevronDown aria-hidden="true" />
                </div>
            </label>

            <fieldset className="ai-studio-desktop-field">
                <legend>{isZh ? '图片比例' : 'Aspect ratio'}</legend>
                <div className="ai-studio-desktop-ratios">
                    {aspectRatios.map(value => (
                        <label key={value}>
                            <input
                                type="radio"
                                name="desktop-image-ratio"
                                value={value}
                                checked={aspectRatio === value}
                                onChange={() => onAspectRatioChange(value)}
                            />
                            <span>
                                <i style={{ aspectRatio: value.replace(':', '/') }} aria-hidden="true" />
                                {value}
                            </span>
                        </label>
                    ))}
                </div>
            </fieldset>

            <fieldset className="ai-studio-desktop-field">
                <legend>{isZh ? '清晰度' : 'Resolution'}</legend>
                <div className="ai-studio-desktop-resolutions">
                    {customerImageResolutions.map(value => {
                        const availability = imageResolutionAvailability(selectedModel, value, aspectRatio);
                        const available = availability.status === 'AVAILABLE';
                        return (
                            <label key={value}>
                                <input
                                    type="radio"
                                    name="desktop-image-resolution"
                                    value={value}
                                    checked={available && resolution === value}
                                    disabled={!available}
                                    onChange={() => onResolutionChange(value)}
                                />
                                <span>
                                    <strong>{value}</strong>
                                    <small>
                                        {available
                                            ? `${formatPrice(availability.option.unitPrice)}${isZh ? ' / 张' : ' / image'}`
                                            : isZh
                                              ? '暂不支持'
                                              : 'Unavailable'}
                                    </small>
                                </span>
                            </label>
                        );
                    })}
                </div>
            </fieldset>

            <label className="ai-studio-desktop-quantity">
                <span>{isZh ? '生成张数' : 'Quantity'}</span>
                <div className="ai-studio-desktop-select">
                    <select value={quantity} onChange={event => onQuantityChange(Number(event.target.value))}>
                        {Array.from({ length: maxQuantity }, (_, i) => i + 1).map(value => (
                            <option key={value} value={value}>
                                {isZh ? `${value} 张` : value}
                            </option>
                        ))}
                    </select>
                    <ChevronDown aria-hidden="true" />
                </div>
            </label>
        </div>
    );
}
