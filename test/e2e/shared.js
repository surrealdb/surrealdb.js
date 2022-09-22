const logger = {
	error(...args) {
		console.error("TEST ERROR: ", ...args);
	},
	debug(...args) {
		console.debug("TEST LOG: ", ...args);
	},
};

/**
 * A simple expect helper without environment specific requirements.
 */
function expect(a) {
	return {
		toEqualStringified: (b, comment) => {
			if (JSON.stringify(a) !== JSON.stringify(b)) {
				logger.error(comment, { expect: a, toEqualStringified: b });
				throw new Error("toEqualStringified failed", a, b);
			} else {
				logger.debug(comment, { input: a, isStringifiedEqualTo: b });
			}
		},
		toBe: (b, comment) => {
			if (a !== b) {
				logger.error(comment, { expect: a, toBe: b });
				throw new Error("toBe failed", a, b);
			} else {
				logger.debug(comment, { input: a, is: b });
			}
		},
	};
}

/**
 * @type{(a: import('../../src/index.ts').default) => void}
 */
export default async (db) => {
	logger.debug("Signin as a namespace, database, or root user");
	await db.signin({
		user: "root",
		pass: "root",
	});

	logger.debug("Select a specific namespace / database");
	await db.use("test", "test");

	logger.debug("Create a new person with a random id");
	let created = await db.create("person", {
		title: "Founder & CEO",
		name: {
			first: "Tobie",
			last: "Morgan Hitchcock",
		},
		marketing: true,
		identifier: Math.random().toString(36).substr(2, 10),
	});

	logger.debug("Update a person record with a specific id");
	let updated = await db.change("person:jaime", {
		marketing: true,
	});

	logger.debug("Select all people records");
	let people = await db.select("person");

	logger.debug("Perform a custom advanced query");
	let groups = await db.query(
		"SELECT marketing, count() FROM type::table($tb) GROUP BY marketing",
		{
			tb: "person",
		}
	);

	expect(groups[0].status).toBe("OK", "status");
	expect(groups[0].result).toEqualStringified(
		[{ count: 2, marketing: true }],
		"result"
	);

	logger.debug("closing");
	await db.close();
};
