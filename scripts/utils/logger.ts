import { Signale } from "signale";

export function createLogger(scope: string): Signale {
	return new Signale({
		scope,
		types: {
			success: {
				badge: "✔",
				color: "green",
				label: "",
			},
			error: {
				badge: "✖",
				color: "red",
				label: "",
			},
			info: {
				badge: "●",
				color: "blue",
				label: "",
			},
		},
	});
}
