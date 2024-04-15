import Duration from "@icholy/duration";
export { Duration } from "@icholy/duration";

export function durationToCborCustomDuration(duration: Duration) {
	const s = duration.seconds();
	const ns = duration.nanoseconds(); // need to calculate this separately...
	return ns > 0 ? [s, ns] : s > 0 ? [s] : [];
}

export function cborCustomDurationToDuration([s, ns]: [number, number]) {
	s = s ?? 0;
	ns = ns ?? 0;
	console.log(ns);
	const ms = (s * 1000) + (ns / 1000000);
	return new Duration(ms);
}
