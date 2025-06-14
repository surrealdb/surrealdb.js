export async function publishJSR(pkg: string, dryrun: boolean): Promise<void> {
	const cmd = ["bunx", "jsr", "publish", "--allow-dirty"];

	if (dryrun) {
		cmd.push("--dry-run");
	}

	const task = Bun.spawn(cmd, {
		stdout: "inherit",
		stderr: "inherit",
		env: import.meta.env,
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
	const cmd = ["bun", "publish", "--access", "public", "--tag", channel];

	if (dryrun) {
		cmd.push("--dry-run");
	}

	const task = Bun.spawn(cmd, {
		stdout: "inherit",
		stderr: "inherit",
		env: import.meta.env,
		cwd: pkg,
		async onExit(_, exitCode) {
			if (exitCode !== 0) process.exit(exitCode);
		},
	});

	await task.exited;
}
