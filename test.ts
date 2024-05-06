import { Decimal, Duration, GeometryCollection, GeometryLine, GeometryMultiPolygon, GeometryPoint, GeometryPolygon, RecordId, Table, UUID, uuidv4 } from "./mod.ts";

const rid = new RecordId("some:thing", "under_score");
const dec = new Decimal("3.333333");
const dur = new Duration("1d2h");
const geo = new GeometryCollection([
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
]);

const tb = new Table("some super _ cool table");
const uuid = UUID.parse(uuidv4());
const date = new Date();

console.log(JSON.stringify({
	rid,
	dec,
	dur,
	geo,
	tb,
	uuid,
	date,
}, null, 4))

new Array(1000000).fill(new RecordId("some:thing", "under_score")).map(rid => JSON.stringify(rid));
