export const getCurrentTraceparent = async (): Promise<string | undefined> => {
    try {
        const api = await import("@opentelemetry/api");
        const carrier: Record<string, string> = {};
        api.propagation.inject(api.context.active(), carrier);

        return carrier.traceparent;
    } catch {
        return undefined;
    }
};
