export const createSummary = (method: string, tableOrFunction?: string) => {
    if (!tableOrFunction) {
        return `${method};`;
    }

    return `${method} ${tableOrFunction};`;
};

export const createDatabaseAttributeValue = (
    namespace: string | undefined,
    database: string | undefined,
) => {
    let value = "";
    if (namespace) {
        value = namespace;
        if (!database) {
            value += `|${database}`;
        }
    }

    return value;
};

export const getProtocolName = (url: URL) => {
    const protocol = url.protocol;

    if (protocol === "http" || protocol === "https") {
        return "http";
    }
    if (protocol === "ws" || protocol === "wss") {
        return "ws";
    }
};
