import { surrealql, PreparedQuery } from "../../npm/esm/index.js";

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
			toOnlyInclude: (b) => {
				if (!Array.isArray(a)) {
					throw new Error("Expected value to be an array", a);
				}

				if (a.filter(a => a != b).length > 0) {
					logger.error(name, { expect: a, toOnlyInclude: b });
					throw new Error("toOnlyInclude failed", a, b);
				}
			}
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
	await db.use({ namespace: "test", database: `test-${rand}` });

	await test("Root authentication", async (expect) => {
		const token = await db.signin({
			username: "root",
			password: "root",
		});

		expect(typeof token).toBe('string');

		const res = await new Promise((r) => r(db.authenticate(token))).catch((e) => {
			console.error(e);
			return false;
		});

		expect(res).toBe(true);
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
		let groups = await db.query_raw(
			"SELECT marketing, count() FROM type::table($tb) GROUP BY marketing",
			{
				tb: "person",
			}
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

	await test("Ensure that query variables are encoded correctly", async (expect) => {
		let [{ status, result }] = await db.query_raw(/* surql */ `
			RETURN [
				$object == {},
				$array == [],
				$string == "String with a \\\" character, and ' too.",
				$number == 123.456,
				$null == null,
				$true == true,
				$false == false,
			];
		`, {
			object: {},
			array: [],
			string: "String with a \" character, and ' too.",
			number: 123.456,
			null: null,
			true: true,
			false: false
		});

		expect(status).toBe("OK");
		expect(result).toOnlyInclude(true);
	});

	await test("Ensure that query_raw to query conversion works as expected", async (expect) => {
		const result = await db.query(/* surql */ `
			RETURN true;
			RETURN [1, 2, 3];
			RETURN { a: 'b' };
		`);

		expect(result).toEqualStringified([
			true,
			[1, 2, 3],
			{ a: 'b' },
		]);

		try {
			await db.query('THROW "example error"');
		} catch(e) {
			expect(e.message).toBe("An error occurred: example error");
		}
	});

	await test("Prepared queries and tagged templates", async (expect) => {
		const name = "John Doe";
		const age = 44;

		{
			const query = new PreparedQuery(
				/* surql */`RETURN $name; RETURN $age`,
				{ name, age }
			);

			const res = await db.query(query);
			expect(res).toEqualStringified([name, age]);
		};

		{
			const res = await db.query(
				surrealql`RETURN ${name}; RETURN ${age}`
			);

			expect(res).toEqualStringified([name, age]);
		};
	})

	if (db.strategy === 'ws') {
		logger.debug("== Running WS specific tests ==");
		await test("Insert a record", async (expect) => {
			const record = { id: "insert_test:1" };
			const inserted = await db.insert("insert_test", record);
			expect(inserted).toEqualStringified([record])
		});

		await test("Insert in bulk", async (expect) => {
			const record1 = { id: "insert_bulk:1" };
			const record2 = { id: "insert_bulk:2" };
			const inserted = await db.insert("insert_bulk", [record1, record2]);
			expect(inserted).toEqualStringified([record1, record2])
		});

		await test("Live queries", async (expect) => {
			let round = 0;
			let responses = [
				{
					action: "CREATE",
					result: {
						id: "live_test:1"
					}
				},
				{
					action: "CREATE",
					result: {
						id: "live_test:2",
						prop: 1,
					}
				},
				{
					action: "UPDATE",
					result: {
						id: "live_test:2",
						prop: 2,
					}
				},
				{
					action: "DELETE",
					result: "live_test:1"
				},
				{
					action: "DELETE",
					result: "live_test:2"
				},
			];

			const uuid = await db.live('live_test', (data) => {
				if (data.action !== 'CLOSE') {
					expect(data).toEqualStringified(responses[round]);
					round++;
				}
			});

			// We need to wait a bit every time to ensure that we are processing the correct message

			const wait = () => new Promise(r => setTimeout(r, 100))

			await db.create("live_test:1");
			await wait();

			await db.create("live_test:2", { prop: 1 });
			await wait();

			await db.update("live_test:2", { prop: 2 });
			await wait();

			await db.delete("live_test:1");
			await wait();

			await db.delete("live_test:2");
			await wait();

			await db.kill(uuid);
		});

		logger.debug("== Finished WS specific tests ==");
	}

	// !!!! WARNING: The scope tests musts always be last because we change auth

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
			scope: "user",
			username: "johndoe",
			password: "Password1!",
		});

		expect(typeof token).toBe('string');

		const res = await new Promise((r) => r(db.authenticate(token))).catch((e) => {
			console.error(e);
			return false;
		});

		expect(res).toBe(true);

		const [{ username }] = await db.select('user');
		expect(username).toBe('johndoe');
	});

	logger.debug("closing");
	db.close();
};
