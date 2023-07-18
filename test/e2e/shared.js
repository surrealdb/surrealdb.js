const logger = {
	error(...args) {
		console.error("TEST ERROR: ", ...args);
	},
	debug(...args) {
		console.debug("TEST LOG: ", ...args);
	},
};

const data = {
	"person:tobie": {
		// The order of the properties is alphabetically important here for the tests to pass...
		identifier: Math.random().toString(36).substr(2, 10),
		marketing: true,
		name: {
			first: "Tobie",
			last: "Morgan Hitchcock",
		},
		title: "Founder & CEO",
	},
	"person:jaime": {
		marketing: true,
	},
};

const dataFilled = Object.fromEntries(
	Object.entries(data).map(([id, val]) => [id, { id, ...val }])
);

/**
 * A simple expect helper without environment specific requirements.
 */
async function test(name, cb) {
	logger.debug(name);

	function expect(a) {
		return {
			toEqualStringified: (b) => {
				if (JSON.stringify(a) !== JSON.stringify(b)) {
					logger.error(name, { expect: a, toEqualStringified: b });
					throw new Error("toEqualStringified failed", a, b);
				}
			},
			toBe: (b) => {
				if (a !== b) {
					logger.error(name, { expect: a, toBe: b });
					throw new Error("toBe failed", a, b);
				}
			},
		};
	}

	await cb(expect);
}

/**
 * @type{(a: import('../../src/index.ts').default) => void}
 */
export default async (db) => {
	logger.debug("Signin as a namespace, database, or root user");

	// We need a random database because some tests depend on row count.
	// Easy way to "reset" for each test while debugging...
	const rand = (Math.random() + 1).toString(36).substring(7);
	logger.debug(`Select NS "test", DB "test-${rand}"`);
	await db.use({ ns: "test", db: `test-${rand}` });

	await db.signin({
		user: "root",
		pass: "root",
	});

	await test("Create a new person with a specific id", async (expect) => {
		let created = await db.create("person:tobie", data["person:tobie"]);
		expect(created).toEqualStringified([dataFilled["person:tobie"]]);
	});

	await test("Update a person record with a specific id", async (expect) => {
		let updated = await db.merge("person:jaime", data["person:jaime"]);
		expect(updated).toEqualStringified([dataFilled["person:jaime"]]);
	});

	await test("Select all people records", async (expect) => {
		let people = await db.select("person");
		expect(people).toEqualStringified([
			dataFilled["person:jaime"],
			dataFilled["person:tobie"],
		]);
	});

	test("Select single person", async (expect) => {
		let jaime = await db.select("person:jaime");
		expect(jaime).toEqualStringified([dataFilled["person:jaime"]]);
	});

	await test("Perform a custom advanced query", async (expect) => {
		let groups =
			db.strategy == "ws"
				? await db.query(
						"SELECT marketing, count() FROM type::table($tb) GROUP BY marketing",
						{
							tb: "person",
						}
				  )
				: // The HTTP protocol cannot accept variables, so needs to test different
				  await db.query(
						"SELECT marketing, count() FROM person GROUP BY marketing"
				  );

		expect(groups[0].status).toBe("OK");
		expect(groups[0].result).toEqualStringified([
			{ count: 2, marketing: true },
		]);
	});

	await test("Delete a record", async (expect) => {
		let deleted = await db.delete("person:tobie");
		expect(deleted).toEqualStringified([dataFilled["person:tobie"]]);
		let people = await db.select("person");
		expect(people).toEqualStringified([dataFilled["person:jaime"]]);
	});

	// Preparation for testing if scope authentication works :)
	await db.query(/* surql */ `
		DEFINE SCOPE user SIGNIN (
			SELECT * FROM user WHERE username = $username AND crypto::argon2::compare(password, $password)
		);

		DEFINE TABLE user SCHEMAFULL
			PERMISSIONS
				FOR select WHERE id = $auth.id;

		DEFINE FIELD username ON user TYPE string;
		DEFINE FIELD password ON user TYPE string;

		CREATE user CONTENT {
			username: "johndoe",
			password: crypto::argon2::generate("Password1!")
		};
	`);

	await test("Scope authentication", async (expect) => {
		const token = await db.signin({
			SC: "user",
			username: "johndoe",
			password: "Password1!",
		});

		expect(typeof token).toBe('string');

		const [{ username }] = await db.select('user');
		expect(username).toBe('johndoe');
	});

	logger.debug("closing");
	db.close();
};
