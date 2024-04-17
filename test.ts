import { RecordId } from "./src/library/data/recordid.ts";
import { Duration } from "./src/library/data/duration.ts";
import { UUID } from "./src/library/data/uuid.ts";
import { Decimal } from "./src/library/data/decimal.ts";
import { Surreal } from "./src/index.ts";
import { encode } from "./src/library/data/cbor.ts";
import { GeometryCollection, GeometryLine, GeometryPoint } from "./src/library/data/geometry.ts";
// import { recordId } from "./src/library/orm/types.ts";

const surreal = new Surreal();
await surreal.connect('ws://127.0.0.1:8000/rpc');
await surreal.use({
	namespace: 'test',
	database: 'test',
});

// console.log(
// 	await surreal.query<[unknown[]]>(
// 		"[$d, $r, $c, $u, $dur, $none, NONE, $a, <string> $a, $nan, $geo]",
// 		{
// 			d: new Date(),
// 			r: new RecordId('person', 'tobie'),
// 			c: new RecordId('recording', [
// 				new Date(),
// 				'London',
// 				new Uuid(),
// 				{
// 					temparature: new Decimal("10.00003")
// 				}
// 			]),
// 			u: new Uuid(),
// 			dur: new Duration('1d20m'),
// 			none: undefined,
// 			a: 9223372036854775807n,
// 			nan: NaN,
// 			geo: new GeometryCollection([
// 				new GeometryPoint([1, 2]),
// 				new GeometryLine([ new GeometryPoint([1, 2]), new GeometryPoint([3, 4]) ])
// 			])
// 		}
// 	)
// )

const uuid = new Duration("2w6d100ms");
console.log(
	456,
	await surreal.query<[UUID, string]>(
		"$uuid; <string> $uuid",
		{
			uuid
		}
	).then(([u, a]) => [u.toString(), a])
)

// function bufferToHex (buffer: ArrayBuffer) {
//     return [...new Uint8Array (buffer)]
//         .map (b => b.toString (16).padStart (2, "0"))
//         .join ("");
// }

// console.log(bufferToHex(encode(new RecordId('recording', [
// 	new Date(),
// 	'London',
// 	new Uuid(),
// 	{
// 		temparature: new Decimal("10.00003")
// 	}
// ]))))

// const rid = recordId('test');
// console.log(rid.parse(new RecordId('tesst', 123) ))

// console.log()
