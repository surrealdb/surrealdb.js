import { RecordId } from "./src/library/data/recordid.ts";
import { Duration } from "./src/library/data/duration.ts";
import { Uuid } from "./src/library/data/uuid.ts";
import { Decimal } from "./src/library/data/decimal.ts";
import { Surreal } from "./src/index.ts";

const surreal = new Surreal();
await surreal.connect('ws://127.0.0.1:8000/rpc');
await surreal.use({
	namespace: 'test',
	database: 'test',
});

console.log(
	await surreal.query<[unknown[]]>(
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
	)
)
