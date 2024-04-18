import { Decimal } from "npm:decimal.js@^10.4.3";

export class Geometry {}

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
}

export class GeometryLine extends Geometry {
	readonly line: [GeometryPoint, GeometryPoint];

	constructor(line: [GeometryPoint, GeometryPoint] | GeometryLine) {
		super();
		line = line instanceof GeometryLine ? line.line : line;
		this.line = [new GeometryPoint(line[0]), new GeometryPoint(line[1])];
	}
}

export class GeometryPolygon extends Geometry {
	readonly polygon: [GeometryLine, GeometryLine, ...GeometryLine[]];

	constructor(
		polygon:
			| [GeometryLine, GeometryLine, ...GeometryLine[]]
			| GeometryPolygon
	) {
		super();
		polygon =
			polygon instanceof GeometryPolygon ? polygon.polygon : polygon;
		this.polygon = polygon.map((line) => new GeometryLine(line)) as [
			GeometryLine,
			GeometryLine,
			...GeometryLine[]
		];
	}
}

export class GeometryMultiPoint extends Geometry {
	readonly points: [GeometryPoint, ...GeometryPoint[]];

	constructor(points: [GeometryPoint, ...GeometryPoint[]]) {
		super();
		points = points instanceof GeometryMultiPoint ? points.points : points;
		this.points = points.map((point) => new GeometryPoint(point)) as [
			GeometryPoint,
			...GeometryPoint[]
		];
	}
}

export class GeometryMultiLine extends Geometry {
	readonly lines: [GeometryLine, ...GeometryLine[]];

	constructor(lines: [GeometryLine, ...GeometryLine[]]) {
		super();
		lines = lines instanceof GeometryMultiLine ? lines.lines : lines;
		this.lines = lines.map((line) => new GeometryLine(line)) as [
			GeometryLine,
			...GeometryLine[]
		];
	}
}

export class GeometryMultiPolygon extends Geometry {
	readonly polygons: [GeometryPolygon, ...GeometryPolygon[]];

	constructor(polygons: [GeometryPolygon, ...GeometryPolygon[]]) {
		super();
		polygons =
			polygons instanceof GeometryMultiPolygon
				? polygons.polygons
				: polygons;

		this.polygons = polygons.map(
			(polygon) => new GeometryPolygon(polygon)
		) as [GeometryPolygon, ...GeometryPolygon[]];
	}
}

export class GeometryCollection extends Geometry {
	readonly collection: [Geometry, ...Geometry[]];

	constructor(collection: [Geometry, ...Geometry[]]) {
		super();
		collection = collection instanceof GeometryCollection ? collection.collection : collection;
		this.collection = collection;
	}
}
