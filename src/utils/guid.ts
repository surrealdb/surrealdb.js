let id = 0;

export default function (): string {
	return (id = (id + 1) % Number.MAX_SAFE_INTEGER).toString();
}
