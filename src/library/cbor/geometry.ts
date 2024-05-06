import { Decimal } from "npm:decimal.js@^10.4.3";

export abstract class Geometry {
	abstract toJSON(): {
		type: string,
		coordinates: unknown[],
	}

	abstract coordinates: unknown[];
}

export class GeometryPoint extends Geometry {
	readonly point: [Decimal, Decimal];

	constructor(point: [number | Decimal, number | Decimal] | GeometryPoint) {
		super();
		point = point instanceof GeometryPoint ? point.point : point;
		this.point = [
			point[0] instanceof Decimal ? point[0] : new Decimal(point[0]),
			point[1] instanceof Decimal ? point[1] : new Decimal(point[1]),
		];
	}

	toJSON() {
		return {
			type: "Point",
			coordinates: this.coordinates,
		};
	}

	get coordinates() {
		return this.point;
	}
}

export class GeometryLine extends Geometry {
	readonly line: [GeometryPoint, GeometryPoint];

	constructor(line: [GeometryPoint, GeometryPoint] | GeometryLine) {
		super();
		line = line instanceof GeometryLine ? line.line : line;
		this.line = [new GeometryPoint(line[0]), new GeometryPoint(line[1])];
	}

	toJSON() {
		return {
			type: "LineString",
			coordinates: this.coordinates,
		};
	}

	get coordinates() {
		return this.line.map(g => g.coordinates);
	}
}

export class GeometryPolygon extends Geometry {
	readonly polygon: [GeometryLine, GeometryLine, ...GeometryLine[]];

	constructor(
		polygon:
			| [GeometryLine, GeometryLine, ...GeometryLine[]]
			| GeometryPolygon,
	) {
		super();
		polygon = polygon instanceof GeometryPolygon
			? polygon.polygon
			: polygon;
		this.polygon = polygon.map((line) => new GeometryLine(line)) as [
			GeometryLine,
			GeometryLine,
			...GeometryLine[],
		];
	}

	toJSON() {
		return {
			type: "Polygon",
			coordinates: this.coordinates,
		};
	}

	get coordinates() {
		return this.polygon.map(g => g.coordinates);
	}
}

export class GeometryMultiPoint extends Geometry {
	readonly points: [GeometryPoint, ...GeometryPoint[]];

	constructor(
		points: [GeometryPoint, ...GeometryPoint[]] | GeometryMultiPoint,
	) {
		super();
		points = points instanceof GeometryMultiPoint ? points.points : points;
		this.points = points.map((point) => new GeometryPoint(point)) as [
			GeometryPoint,
			...GeometryPoint[],
		];
	}

	toJSON() {
		return {
			type: "MultiPoint",
			coordinates: this.coordinates,
		};
	}

	get coordinates() {
		return this.points.map(g => g.coordinates);
	}
}

export class GeometryMultiLine extends Geometry {
	readonly lines: [GeometryLine, ...GeometryLine[]];

	constructor(lines: [GeometryLine, ...GeometryLine[]] | GeometryMultiLine) {
		super();
		lines = lines instanceof GeometryMultiLine ? lines.lines : lines;
		this.lines = lines.map((line) => new GeometryLine(line)) as [
			GeometryLine,
			...GeometryLine[],
		];
	}

	toJSON() {
		return {
			type: "MultiLineString",
			coordinates: this.coordinates,
		};
	}

	get coordinates() {
		return this.lines.map(g => g.coordinates);
	}
}

export class GeometryMultiPolygon extends Geometry {
	readonly polygons: [GeometryPolygon, ...GeometryPolygon[]];

	constructor(
		polygons:
			| [GeometryPolygon, ...GeometryPolygon[]]
			| GeometryMultiPolygon,
	) {
		super();
		polygons = polygons instanceof GeometryMultiPolygon
			? polygons.polygons
			: polygons;

		this.polygons = polygons.map(
			(polygon) => new GeometryPolygon(polygon),
		) as [GeometryPolygon, ...GeometryPolygon[]];
	}

	toJSON() {
		return {
			type: "MultiPolygon",
			coordinates: this.coordinates,
		};
	}

	get coordinates() {
		return this.polygons.map(g => g.coordinates);
	}
}

export class GeometryCollection extends Geometry {
	readonly collection: [Geometry, ...Geometry[]];

	constructor(collection: [Geometry, ...Geometry[]] | GeometryCollection) {
		super();
		collection = collection instanceof GeometryCollection
			? collection.collection
			: collection;
		this.collection = collection;
	}

	toJSON() {
		return {
			type: "GeometryCollection",
			coordinates: this.coordinates,
		};
	}

	get coordinates() {
		return this.collection.map(g => g.toJSON());
	}
}
