import { context, metrics, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { MeterProvider, type MetricReader } from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { SEMRESATTRS_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

export type TelemetryExporterOptions = {
  readonly spanExporter?: SpanExporter;
  readonly metricReader?: MetricReader;
};

export const DEFAULT_SERVICE_NAME = "deep-agent-template-web";

let tracerProvider: BasicTracerProvider | null = null;
let meterProvider: MeterProvider | null = null;
let contextManager: AsyncLocalStorageContextManager | null = null;
let registered = false;

export function registerTelemetry(options: TelemetryExporterOptions = {}): void {
  if (registered) return;
  registered = true;

  const serviceName = process.env.OTEL_SERVICE_NAME?.trim() || DEFAULT_SERVICE_NAME;
  const resource = resourceFromAttributes({
    [SEMRESATTRS_SERVICE_NAME]: serviceName,
  });

  const spanProcessors = options.spanExporter ? [new BatchSpanProcessor(options.spanExporter)] : [];
  tracerProvider = new BasicTracerProvider({ resource, spanProcessors });
  trace.setGlobalTracerProvider(tracerProvider);

  contextManager = new AsyncLocalStorageContextManager();
  (
    context as unknown as { setGlobalContextManager: (manager: unknown) => void }
  ).setGlobalContextManager(contextManager);

  meterProvider = new MeterProvider({
    readers: options.metricReader ? [options.metricReader] : [],
    resource,
  });
  metrics.setGlobalMeterProvider(meterProvider);
}

export async function shutdownTelemetry(): Promise<void> {
  await Promise.all([
    tracerProvider?.shutdown().catch(() => undefined),
    meterProvider?.shutdown().catch(() => undefined),
  ]);
  contextManager?.disable();
  trace.disable();
  metrics.disable();
  context.disable();
  tracerProvider = null;
  meterProvider = null;
  contextManager = null;
  registered = false;
}

export function isTelemetryRegistered(): boolean {
  return registered;
}
