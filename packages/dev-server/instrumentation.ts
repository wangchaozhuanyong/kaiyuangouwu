import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { getSdkConfiguration } from '@vendure/telemetry-plugin/preload';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function instrumentationValue(name: string, developmentDefault: string): string {
    const value = process.env[name]?.trim();
    if (value) {
        return value;
    }
    if (IS_PRODUCTION) {
        throw new Error(`${name} must be configured for production instrumentation`);
    }
    return developmentDefault;
}

const traceEndpoint = instrumentationValue(
    'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
    'http://localhost:4318/v1/traces',
);
const logEndpoint = instrumentationValue('OTEL_EXPORTER_OTLP_LOGS_ENDPOINT', 'http://localhost:3100/otlp');
process.env.OTEL_SERVICE_NAME = instrumentationValue('OTEL_SERVICE_NAME', 'vendure-dev-server');
process.env.OTEL_LOGS_EXPORTER ??= 'otlp';

const traceExporter = new OTLPTraceExporter({
    url: traceEndpoint,
});
const logExporter = new OTLPLogExporter({ url: logEndpoint });

const config = getSdkConfiguration({
    config: {
        spanProcessors: [new BatchSpanProcessor(traceExporter)],
        logRecordProcessors: [new BatchLogRecordProcessor({ exporter: logExporter })],
    },
});

const sdk = new NodeSDK(config);

sdk.start();
