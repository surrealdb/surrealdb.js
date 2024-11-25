export interface Completable {
	promise: Promise<void>;
	resolve: () => void;
	reject: (reason?: Error) => void;
}

export function newCompletable(): Completable {
	const out = {} as Completable;
	out.promise = new Promise((resolve_, reject_) => {
		out.resolve = resolve_;
		out.reject = reject_;
	});
	return out;
}
