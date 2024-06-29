import { Decimal } from "./decimal.ts";

export abstract class Geometry {
	abstract toJSON(): GeoJson;
	abstract is(geometry: Geometry): boolean;
	abstract clone(): Geometry;
}

function f(num: number | Decimal) {
	if (num instanceof Decimal) return Number.parseFloat(num.decimal);
	return num;
}

export class GeometryPoint extends Geometry {
	readonly point: [number, number];

	constructor(point: [number | Decimal, number | Decimal] | GeometryPoint) {
		super();
		if (point instanceof GeometryPoint) {
			this.point = point.clone().point;
		} else {
			this.point = [f(point[0]), f(point[1])];
		}
	}

	toJSON(): GeoJsonPoint {
		return {
			type: "Point" as const,
			coordinates: this.coordinates,
		};
	}

	get coordinates(): GeoJsonPoint["coordinates"] {
		return this.point;
	}

	is(geometry: Geometry): geometry is GeometryPoint {
		if (!(geometry instanceof GeometryPoint)) return false;
		return (
			this.point[0] === geometry.point[0] && this.point[1] === geometry.point[1]
		);
	}

	clone() {
		return new GeometryPoint([...this.point]);
	}
}

export class GeometryLine extends Geometry {
	readonly line: [GeometryPoint, GeometryPoint, ...GeometryPoint[]];

	// SurrealDB only has the concept of a "Line", which by spec is two points.
	// SurrealDB's "Line" however, is actually a "LineString" under the hood, which accepts two or more points
	constructor(
		line: [GeometryPoint, GeometryPoint, ...GeometryPoint[]] | GeometryLine,
	) {
		super();
		this.line = line instanceof GeometryLine ? line.clone().line : line;
	}

	toJSON(): GeoJsonLineString {
		return {
			type: "LineString" as const,
			coordinates: this.coordinates,
		};
	}

	get coordinates(): GeoJsonLineString["coordinates"] {
		return this.line.map(
			(g) => g.coordinates,
		) as GeoJsonLineString["coordinates"];
	}

	close() {
		if (!this.line[0].is(this.line.at(-1) as GeometryPoint)) {
			this.line.push(this.line[0]);
		}
	}

	is(geometry: Geometry): geometry is GeometryLine {
		if (!(geometry instanceof GeometryLine)) return false;
		if (this.line.length !== geometry.line.length) return false;
		for (let i = 0; i < this.line.length; i++) {
			if (!this.line[i].is(geometry.line[i])) return false;
		}

		return true;
	}

	clone() {
		return new GeometryLine(
			this.line.map((p) => p.clone()) as [
				GeometryPoint,
				GeometryPoint,
				...GeometryPoint[],
			],
		);
	}
}

export class GeometryPolygon extends Geometry {
	readonly polygon: [GeometryLine, ...GeometryLine[]];

	constructor(polygon: [GeometryLine, ...GeometryLine[]] | GeometryPolygon) {
		super();
		this.polygon =
			polygon instanceof GeometryPolygon
				? polygon.clone().polygon
				: (polygon.map((l) => {
						const line = l.clone();
						line.close();
						return line;
					}) as [GeometryLine, ...GeometryLine[]]);
	}

	toJSON(): GeoJsonPolygon {
		return {
			type: "Polygon" as const,
			coordinates: this.coordinates,
		};
	}

	get coordinates(): GeoJsonPolygon["coordinates"] {
		return this.polygon.map(
			(g) => g.coordinates,
		) as GeoJsonPolygon["coordinates"];
	}

	is(geometry: Geometry): geometry is GeometryPolygon {
		if (!(geometry instanceof GeometryPolygon)) return false;
		if (this.polygon.length !== geometry.polygon.length) return false;
		for (let i = 0; i < this.polygon.length; i++) {
			if (!this.polygon[i].is(geometry.polygon[i])) return false;
		}

		return true;
	}

	clone() {
		return new GeometryPolygon(
			this.polygon.map((p) => p.clone()) as [GeometryLine, ...GeometryLine[]],
		);
	}
}

export class GeometryMultiPoint extends Geometry {
	readonly points: [GeometryPoint, ...GeometryPoint[]];

	constructor(
		points: [GeometryPoint, ...GeometryPoint[]] | GeometryMultiPoint,
	) {
		super();
		this.points = points instanceof GeometryMultiPoint ? points.points : points;
	}

	toJSON(): GeoJsonMultiPoint {
		return {
			type: "MultiPoint" as const,
			coordinates: this.coordinates,
		};
	}

	get coordinates(): GeoJsonMultiPoint["coordinates"] {
		return this.points.map(
			(g) => g.coordinates,
		) as GeoJsonMultiPoint["coordinates"];
	}

	is(geometry: Geometry): geometry is GeometryMultiPoint {
		if (!(geometry instanceof GeometryMultiPoint)) return false;
		if (this.points.length !== geometry.points.length) return false;
		for (let i = 0; i < this.points.length; i++) {
			if (!this.points[i].is(geometry.points[i])) return false;
		}

		return true;
	}

	clone() {
		return new GeometryMultiPoint(
			this.points.map((p) => p.clone()) as [GeometryPoint, ...GeometryPoint[]],
		);
	}
}

export class GeometryMultiLine extends Geometry {
	readonly lines: [GeometryLine, ...GeometryLine[]];

	constructor(lines: [GeometryLine, ...GeometryLine[]] | GeometryMultiLine) {
		super();
		this.lines = lines instanceof GeometryMultiLine ? lines.lines : lines;
	}

	toJSON(): GeoJsonMultiLineString {
		return {
			type: "MultiLineString" as const,
			coordinates: this.coordinates,
		};
	}

	get coordinates(): GeoJsonMultiLineString["coordinates"] {
		return this.lines.map(
			(g) => g.coordinates,
		) as GeoJsonMultiLineString["coordinates"];
	}

	is(geometry: Geometry): geometry is GeometryMultiLine {
		if (!(geometry instanceof GeometryMultiLine)) return false;
		if (this.lines.length !== geometry.lines.length) return false;
		for (let i = 0; i < this.lines.length; i++) {
			if (!this.lines[i].is(geometry.lines[i])) return false;
		}

		return true;
	}

	clone() {
		return new GeometryMultiLine(
			this.lines.map((p) => p.clone()) as [GeometryLine, ...GeometryLine[]],
		);
	}
}

export class GeometryMultiPolygon extends Geometry {
	readonly polygons: [GeometryPolygon, ...GeometryPolygon[]];

	constructor(
		polygons: [GeometryPolygon, ...GeometryPolygon[]] | GeometryMultiPolygon,
	) {
		super();
		this.polygons =
			polygons instanceof GeometryMultiPolygon ? polygons.polygons : polygons;
	}

	toJSON(): GeoJsonMultiPolygon {
		return {
			type: "MultiPolygon" as const,
			coordinates: this.coordinates,
		};
	}

	get coordinates(): GeoJsonMultiPolygon["coordinates"] {
		return this.polygons.map(
			(g) => g.coordinates,
		) as GeoJsonMultiPolygon["coordinates"];
	}

	is(geometry: Geometry): geometry is GeometryMultiPolygon {
		if (!(geometry instanceof GeometryMultiPolygon)) return false;
		if (this.polygons.length !== geometry.polygons.length) return false;
		for (let i = 0; i < this.polygons.length; i++) {
			if (!this.polygons[i].is(geometry.polygons[i])) return false;
		}

		return true;
	}

	clone() {
		return new GeometryMultiPolygon(
			this.polygons.map((p) => p.clone()) as [
				GeometryPolygon,
				...GeometryPolygon[],
			],
		);
	}
}

export class GeometryCollection extends Geometry {
	readonly collection: [Geometry, ...Geometry[]];

	constructor(collection: [Geometry, ...Geometry[]] | GeometryCollection) {
		super();
		this.collection =
			collection instanceof GeometryCollection
				? collection.collection
				: collection;
	}

	toJSON(): GeoJsonCollection {
		return {
			type: "GeometryCollection" as const,
			geometries: this.geometries,
		};
	}

	get geometries(): GeoJsonCollection["geometries"] {
		return this.collection.map((g) =>
			g.toJSON(),
		) as GeoJsonCollection["geometries"];
	}

	is(geometry: Geometry): geometry is GeometryCollection {
		if (!(geometry instanceof GeometryCollection)) return false;
		if (this.collection.length !== geometry.collection.length) return false;
		for (let i = 0; i < this.collection.length; i++) {
			if (!this.collection[i].is(geometry.collection[i])) return false;
		}

		return true;
	}

	clone() {
		return new GeometryCollection(
			this.collection.map((p) => p.clone()) as [Geometry, ...Geometry[]],
		);
	}
}

// Geo Json Types

type GeoJson =
	| GeoJsonPoint
	| GeoJsonLineString
	| GeoJsonPolygon
	| GeoJsonMultiPoint
	| GeoJsonMultiLineString
	| GeoJsonMultiPolygon
	| GeoJsonCollection;

export type GeoJsonPoint = {
	type: "Point";
	coordinates: [number, number];
};

export type GeoJsonLineString = {
	type: "LineString";
	coordinates: [
		GeoJsonPoint["coordinates"],
		GeoJsonPoint["coordinates"],
		...GeoJsonPoint["coordinates"][],
	];
};

export type GeoJsonPolygon = {
	type: "Polygon";
	coordinates: [
		GeoJsonLineString["coordinates"],
		...GeoJsonLineString["coordinates"][],
	];
};

export type GeoJsonMultiPoint = {
	type: "MultiPoint";
	coordinates: [GeoJsonPoint["coordinates"], ...GeoJsonPoint["coordinates"][]];
};

export type GeoJsonMultiLineString = {
	type: "MultiLineString";
	coordinates: [
		GeoJsonLineString["coordinates"],
		...GeoJsonLineString["coordinates"][],
	];
};

export type GeoJsonMultiPolygon = {
	type: "MultiPolygon";
	coordinates: [
		GeoJsonPolygon["coordinates"],
		...GeoJsonPolygon["coordinates"][],
	];
};

export type GeoJsonCollection = {
	type: "GeometryCollection";
	geometries: GeoJson[];
};
