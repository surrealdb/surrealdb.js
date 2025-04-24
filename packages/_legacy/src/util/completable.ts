export interface Completable<T = void> {
	promise: Promise<T>;
	resolve: (arg: T) => void;
	reject: (reason?: Error) => void;
	completed: boolean;
}

export function newCompletable<T = void>(): Completable<T> {
	const out = {
		completed: false,
	} as Completable<T>;
	out.promise = new Promise<T>((resolve_, reject_) => {
		out.resolve = (arg: T) => {
			out.completed = true;
			resolve_(arg);
		};
		out.reject = (reason?: Error) => {
			out.completed = true;
			reject_(reason);
		};
	});
	return out;
}
