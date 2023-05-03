let id = 0;
export function getIncrementalID() {
	return (id = (id + 1) % Number.MAX_SAFE_INTEGER).toString();
}
