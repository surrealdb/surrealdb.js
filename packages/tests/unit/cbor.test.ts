import { describe, expect, test } from "bun:test";
import {
	CborFillMissing,
	CborInvalidMajorError,
	CborPartialDisabled,
	CborRangeError,
	Gap,
	POW_2_64,
	decode,
	encode,
} from "@surrealdb/cbor";

describe("cbor", () => {
	test("encode basic types", () => {
		expect(encode(123)).toMatchSnapshot("positive integer");
		expect(encode(-123)).toMatchSnapshot("negative integer");
		expect(encode(123.456)).toMatchSnapshot("positive float");
		expect(encode(-123.456)).toMatchSnapshot("negative float");
		expect(encode(POW_2_64 - 1n)).toMatchSnapshot("positive bigint");
		expect(encode(-POW_2_64)).toMatchSnapshot("negative bigint");
		expect(encode("Hello \nWorld!")).toMatchSnapshot("string");
		expect(encode(undefined)).toMatchSnapshot("undefined");
		expect(encode(null)).toMatchSnapshot("null");
		expect(encode(true)).toMatchSnapshot("true");
		expect(encode(false)).toMatchSnapshot("false");
		expect(encode(new Map([["key", "value"]]))).toMatchSnapshot("map");
		expect(encode({ key: "value" })).toMatchSnapshot("object");
		expect(encode([123, "abc"])).toMatchSnapshot("array");

		const bytes = new Uint8Array([1, 2, 3]);
		expect(encode(bytes)).toMatchSnapshot("uint8array");
		expect(encode(bytes.buffer)).toMatchSnapshot("arraybuffer");
	});

	test("encode/decode", () => {
		const bytes = new Uint8Array([1, 2, 3]);
		const input = {
			posint: 123,
			negint: -123,
			posflo: 123.456,
			negflo: -123.456,
			posbig: POW_2_64 - 1n,
			negbig: -POW_2_64,
			string: "Hello World!",
			undefined: undefined,
			null: null,
			false: false,
			true: true,
			map: new Map([["key", "value"]]),
			array: [123, "abc"],
			uint8array: bytes,
			arraybuffer: bytes.buffer,
		};

		const encoded = encode(input);
		expect(encoded).toMatchSnapshot("encoded input");

		const decoded = decode(encoded);
		expect(decoded).toMatchSnapshot("decoded input");
	});

	describe("infinity", () => {
		test("valid bytes", () => {
			const decoded = decode(
				new Uint8Array([
					95, // infinite bytes start
					65, // byte string, len 1
					1, // Some byte
					66, // byte string, len 2
					1, // Some byte
					2, // Some byte
					255, // break
				]),
			);

			expect(decoded).toMatchObject(new Uint8Array([1, 1, 2]).buffer);
		});

		test("invalid bytes, nested infinite bytes", () => {
			const res = new Promise(() =>
				decode(
					new Uint8Array([
						95, // infinite bytes start
						95, // infinite bytes start (not allowed)
						65, // byte string, len 1
						1, // Some byte
						255, // break
						255, // break
					]),
				),
			);

			expect(res).rejects.toBeInstanceOf(CborRangeError);
		});

		test("invalid bytes, no break", () => {
			const res = new Promise(() =>
				decode(
					new Uint8Array([
						95, // infinite bytes start
						65, // byte string, len 1
						1, // Some byte
						// break (255) is missing
					]),
				),
			);

			expect(res).rejects.toBeInstanceOf(CborRangeError);
		});

		test("invalid bytes, invalid major", () => {
			const res = new Promise(() =>
				decode(
					new Uint8Array([
						95, // infinite bytes start
						96, // text string, len 1 (invalid major)
						1, // Some byte
						255, // break
					]),
				),
			);

			expect(res).rejects.toBeInstanceOf(CborInvalidMajorError);
		});

		test("valid text", () => {
			const decoded = decode(
				new Uint8Array([
					127, // infinite text start
					97, // byte string, len 1
					97, // letter "a"
					98, // byte string, len 2
					98, // letter "b"
					99, // letter "c"
					255, // break
				]),
			);

			expect(decoded).toMatch("abc");
		});

		test("valid array", () => {
			const decoded = decode(
				new Uint8Array([
					159, // infinite array start
					97, // byte string, len 1
					97, // letter "a"
					98, // byte string, len 2
					98, // letter "b"
					99, // letter "c"
					255, // break
				]),
			);

			expect(decoded).toMatchObject(["a", "bc"]);
		});

		test("valid map", () => {
			const decoded = decode(
				new Uint8Array([
					191, // infinite map start
					97, // byte string, len 1
					97, // letter "a"
					98, // byte string, len 2
					98, // letter "b"
					99, // letter "c"
					255, // break
				]),
			);

			expect(decoded).toMatchObject({ a: "bc" });
		});
	});

	describe("partial", () => {
		test("Fails if not enabled", () => {
			const res = new Promise(() => {
				const gap = new Gap();
				encode({ gap });
			});

			expect(res).rejects.toBeInstanceOf(CborPartialDisabled);
		});

		test("Fails to build if fill for gap is missing", () => {
			const res = new Promise(() => {
				const gap = new Gap();
				const partial = encode({ gap }, { partial: true });
				partial.build([]);
			});

			expect(res).rejects.toBeInstanceOf(CborFillMissing);
		});

		describe("Succeeds if configured correctly", () => {
			const name = new Gap<string>();
			const age = new Gap<number>();
			const enabled = new Gap(true);
			const partial = encode(
				[
					"CREATE person SET name = $name, age = $age, enabled = $enabled",
					{
						name,
						age,
						enabled,
					},
				],
				{ partial: true },
			);

			test("with gaps filled", () => {
				const res = decode(partial.build([name.fill("John"), age.fill(30)]));
				expect(res?.[1]).toStrictEqual({
					name: "John",
					age: 30,
					enabled: true,
				});
			});

			test("with defaults overwritten", () => {
				const res = decode(
					partial.build([name.fill("John"), age.fill(30), enabled.fill(false)]),
				);

				expect(res?.[1]).toStrictEqual({
					name: "John",
					age: 30,
					enabled: false,
				});
			});
		});
	});
});
