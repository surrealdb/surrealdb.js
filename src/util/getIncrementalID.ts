let id = 0;
export function getIncrementalID() {
	id = (id + 1) % Number.MAX_SAFE_INTEGER;
	return id.toString();
}
