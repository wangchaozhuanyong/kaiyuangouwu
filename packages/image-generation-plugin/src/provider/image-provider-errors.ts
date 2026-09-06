import { ProviderTelemetry } from '../types';
export type ImageProviderErrorDetails = ProviderTelemetry;

export class ImageProviderError extends Error {
    constructor(
        message: string,
        readonly details: ImageProviderErrorDetails = {},
    ) {
        super(message);
        this.name = new.target.name;
    }
}

export class RetryableImageProviderError extends ImageProviderError {}

export class AmbiguousImageProviderError extends ImageProviderError {}

export class DefinitiveImageProviderError extends ImageProviderError {}

export class LocalImageProcessingError extends DefinitiveImageProviderError {
    constructor(
        message: string,
        details: ImageProviderErrorDetails,
        readonly sourceErrorName: string,
    ) {
        super(message, details);
    }
}
