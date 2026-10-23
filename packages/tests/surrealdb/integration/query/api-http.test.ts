import { expect, test } from "bun:test";
import getPort from "get-port";
import { Surreal } from "surrealdb";
import { SURREAL_BACKEND, SURREAL_EXECUTABLE_PATH } from "../__helpers__/env";
import { requestVersion } from "../__helpers__/surreal";

const { is3x } = await requestVersion();

test.skipIf(SURREAL_BACKEND !== "remote" || !is3x)(
    "HTTP APIs work when guest and record queries are disabled",
    async () => {
        const port = await getPort();
        const endpoint = `http://127.0.0.1:${port}`;
        const server = Bun.spawn(
            [
                SURREAL_EXECUTABLE_PATH,
                "start",
                "memory",
                "--bind",
                `127.0.0.1:${port}`,
                "--user",
                "root",
                "--pass",
                "root",
                "--allow-all",
                "--deny-arbitrary-query",
                "guest,record",
            ],
            { stdout: "ignore", stderr: "ignore" },
        );
        const admin = new Surreal();
        const guest = new Surreal();
        const record = new Surreal();
        try {
            let ready = false;
            for (let attempt = 0; attempt < 100; attempt++) {
                try {
                    if ((await fetch(`${endpoint}/health`)).ok) {
                        ready = true;
                        break;
                    }
                } catch {}
                await Bun.sleep(25);
            }
            expect(ready).toBe(true);
            await admin.connect(endpoint, {
                namespace: "test",
                database: "test",
                authentication: { username: "root", password: "root" },
            });
            await admin.query(`
            DEFINE NAMESPACE test;
            DEFINE DATABASE test;
            CREATE user:ada;
            DEFINE ACCESS user ON DATABASE TYPE RECORD
                SIGNIN (SELECT * FROM type::record('user', $id));
            DEFINE API '/whoami' FOR get MIDDLEWARE api::res::body('cbor')
                THEN { RETURN { body: <string>$auth.id }; };
            DEFINE API '/hello' FOR get MIDDLEWARE api::res::body('cbor')
                THEN { RETURN { body: { hello: 'world' } }; };
            DEFINE API '/echo' FOR post
                MIDDLEWARE api::req::body('cbor'), api::res::body('cbor')
                THEN { RETURN { status: 201, body: $request.body }; };
        `);
            await guest.connect(endpoint, { namespace: "test", database: "test" });
            await expect(Promise.resolve(guest.query("api::invoke('/hello')"))).rejects.toThrow();
            expect(await guest.api().get("/hello").value()).toEqual({ hello: "world" });
            expect(await guest.api().post("/echo", { ok: true })).toMatchObject({
                status: 201,
                body: { ok: true },
            });
            await record.connect(endpoint, {
                namespace: "test",
                database: "test",
                authentication: { access: "user", variables: { id: "ada" } },
            });
            await expect(Promise.resolve(record.query("api::invoke('/whoami')"))).rejects.toThrow();
            expect(await record.api().get("/whoami").value()).toBe("user:ada");
        } finally {
            await Promise.all([admin.close(), guest.close(), record.close()]);
            server.kill();
            await server.exited;
        }
    },
    15_000,
);
