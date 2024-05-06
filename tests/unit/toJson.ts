import { assertSnapshot } from "https://deno.land/std@0.224.0/testing/snapshot.ts";
import {
	Decimal,
	Duration,
	GeometryCollection,
	GeometryLine,
	GeometryMultiPolygon,
	GeometryPoint,
	GeometryPolygon,
	RecordId,
	StringRecordId,
	Table,
	UUID,
} from "../../mod.ts";

Deno.test("toJSON matches snapshot", async function (t) {
	const json = JSON.stringify(
		{
			rid: new RecordId("some:thing", "under_score"),
			str_rid: new StringRecordId("⟨some:thing⟩:under_score"),
			dec: new Decimal("3.333333"),
			dur: new Duration("1d2h"),
			geo: new GeometryCollection([
				new GeometryPoint([1, 2]),
				new GeometryMultiPolygon([
					new GeometryPolygon([
						new GeometryLine([
							new GeometryPoint([1, 2]),
							new GeometryPoint([3, 4]),
						]),
						new GeometryLine([
							new GeometryPoint([5, 6]),
							new GeometryPoint([7, 8]),
						]),
					]),
				]),
				new GeometryPolygon([
					new GeometryLine([
						new GeometryPoint([1, 2]),
						new GeometryPoint([3, 4]),
					]),
					new GeometryLine([
						new GeometryPoint([5, 6]),
						new GeometryPoint([7, 8]),
					]),
				]),
			]),

			tb: new Table("some super _ cool table"),
			uuid: UUID.parse("92b84bde-39c8-4b4b-92f7-626096d6c4d9"),
			date: new Date("2024-05-06T17:44:57.085Z"),
		},
		null,
		2,
	);

	await assertSnapshot(t, json);
});
