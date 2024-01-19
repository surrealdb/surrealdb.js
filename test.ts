import { WebsocketConnection } from "./src/library/connection.ts";
import { decode, encode } from "./src/library/data/cbor.ts";
import { RecordId } from "./src/library/data/recordid.ts";
import { Duration } from "./src/library/data/duration.ts";
import { Uuid } from "./src/library/data/uuid.ts";
import { Decimal } from "./src/library/data/decimal.ts";

// console.log(decode(encode({rid: new RecordId('person', [new Date(), 'London'])})))
// console.log(new Duration(new Duration("26h").toString()))
// console.log(encode({
// 	id: "1",
// 	method: "query",
// 	params: [
// 		"$d",
// 		{
// 			d: new Date()
// 		}
// 	]
// }))










const conn = new WebsocketConnection();
await conn.connect('ws://127.0.0.1:8000/rpc');
console.log(
	await conn.send({
		method: 'use',
		params: ['test', 'test']
	})
);

console.log(
	await conn.send<"query", unknown[], [{ result: unknown[] }]>({
		method: "query",
		params: [
			"[$d, $r, $c, $u, $dur, $none, NONE]",
			{
				d: new Date(),
				r: new RecordId('person', 'tobie'),
				c: new RecordId('recording', [
					new Date(),
					'London',
					new Uuid(),
					{
						temparature: new Decimal("10.00003")
					}
				]),
				u: new Uuid(),
				dur: new Duration('1d20m'),
				none: undefined
			}
		]
	}).then(({ result }) => result?.[0].result)
);
