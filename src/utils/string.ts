export function getId(text: string): string | undefined {
    const split = text.split(':');
    return split.length > 0 ? split[1] : undefined;
};