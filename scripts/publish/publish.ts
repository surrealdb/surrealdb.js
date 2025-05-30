export async function publishJSR(pkg: string, dryrun: boolean): Promise<void> {
	const cmd = ["bunx", "jsr", "publish"];

	if (dryrun) {
		cmd.push("--dry-run");
	}

	const task = Bun.spawn(cmd, {
		stdout: "inherit",
		stderr: "inherit",
		cwd: pkg,
		async onExit(_, exitCode) {
			if (exitCode !== 0) process.exit(exitCode);
		},
	});

	await task.exited;
}

export async function publishNPM(
	pkg: string,
	dryrun: boolean,
	channel: string,
): Promise<void> {
	const cmd = ["npm", "publish", "--tag", channel];

	if (dryrun) {
		cmd.push("--dry-run");
	} else {
		cmd.push("--provenance");
	}

	const task = Bun.spawn(cmd, {
		stdout: "inherit",
		stderr: "inherit",
		cwd: pkg,
		async onExit(_, exitCode) {
			if (exitCode !== 0) process.exit(exitCode);
		},
	});

	await task.exited;
}
