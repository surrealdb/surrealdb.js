export function msToNs(ms: number): number {
	return ms * 1000000;
}

export function nsToMs(ns: number): number {
	return Math.floor(ns / 1000000);
}

export function dateToCborCustomDate(date: Date): [number, number] {
	const s = Math.floor(date.getTime() / 1000);
	const ms = date.getTime() - s * 1000;
	return [s, ms * 1000000];
}

export function cborCustomDateToDate([s, ns]: [number, number]): Date {
	const date = new Date(0);
	date.setUTCSeconds(Number(s));
	date.setMilliseconds(Math.floor(Number(ns) / 1000000));
	return date;
}
