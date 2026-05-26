import {
    GEOMETRY_COLLECTION_SYMBOL,
    GEOMETRY_LINE_SYMBOL,
    GEOMETRY_MULTI_LINE_SYMBOL,
    GEOMETRY_MULTI_POINT_SYMBOL,
    GEOMETRY_MULTI_POLYGON_SYMBOL,
    GEOMETRY_POINT_SYMBOL,
    GEOMETRY_POLYGON_SYMBOL,
    GEOMETRY_SYMBOL,
    hasSymbol,
    markSymbol,
} from "../utils/symbols";
import { Decimal } from "./decimal.ts";
import { Value } from "./value.ts";

/**
 * A SurrealQL geometry value.
 */
export abstract class Geometry extends Value {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, GEOMETRY_SYMBOL);
    }

    constructor() {
        super();
        markSymbol(this, GEOMETRY_SYMBOL);
    }
    abstract override toJSON(): GeoJson;
    abstract is(geometry: Geometry): boolean;
    abstract clone(): Geometry;

    equals(other: unknown): boolean {
        if (!(other instanceof Geometry)) return false;
        return this.is(other as unknown as Geometry);
    }

    toString(): string {
        return JSON.stringify(this.toJSON());
    }
}

function f(num: number | Decimal): number {
    if (num instanceof Decimal) return (num as unknown as Decimal).toFloat();
    return num as number;
}

/**
 * A SurrealQL point geometry value.
 */
export class GeometryPoint extends Geometry {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, GEOMETRY_POINT_SYMBOL);
    }

    readonly point: [number, number];

    constructor(point: [number | Decimal, number | Decimal] | GeometryPoint) {
        super();
        if (point instanceof GeometryPoint) {
            this.point = (point as unknown as GeometryPoint).clone().point;
        } else {
            const arr = point as [number | Decimal, number | Decimal];
            this.point = [f(arr[0]), f(arr[1])];
        }
        markSymbol(this, GEOMETRY_POINT_SYMBOL);
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
        const gp = geometry as unknown as GeometryPoint;
        return this.point[0] === gp.point[0] && this.point[1] === gp.point[1];
    }

    clone(): GeometryPoint {
        return new GeometryPoint([...this.point]);
    }
}

/**
 * A SurrealQL line geometry value.
 */
export class GeometryLine extends Geometry {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, GEOMETRY_LINE_SYMBOL);
    }

    readonly line: [GeometryPoint, GeometryPoint, ...GeometryPoint[]];

    // SurrealDB only has the concept of a "Line", which by spec is two points.
    // SurrealDB's "Line" however, is actually a "LineString" under the hood, which accepts two or more points
    constructor(line: [GeometryPoint, GeometryPoint, ...GeometryPoint[]] | GeometryLine) {
        super();
        this.line =
            line instanceof GeometryLine
                ? (line as unknown as GeometryLine).clone().line
                : (line as [GeometryPoint, GeometryPoint, ...GeometryPoint[]]);
        markSymbol(this, GEOMETRY_LINE_SYMBOL);
    }

    toJSON(): GeoJsonLineString {
        return {
            type: "LineString" as const,
            coordinates: this.coordinates,
        };
    }

    get coordinates(): GeoJsonLineString["coordinates"] {
        return this.line.map((g) => g.coordinates) as GeoJsonLineString["coordinates"];
    }

    close(): void {
        if (!this.line[0].is(this.line.at(-1) as GeometryPoint)) {
            this.line.push(this.line[0]);
        }
    }

    is(geometry: Geometry): geometry is GeometryLine {
        if (!(geometry instanceof GeometryLine)) return false;
        const gl = geometry as unknown as GeometryLine;
        if (this.line.length !== gl.line.length) return false;
        for (let i = 0; i < this.line.length; i++) {
            if (!this.line[i].is(gl.line[i])) return false;
        }

        return true;
    }

    clone(): GeometryLine {
        return new GeometryLine(
            this.line.map((p) => p.clone()) as [GeometryPoint, GeometryPoint, ...GeometryPoint[]],
        );
    }
}

/**
 * A SurrealQL polygon geometry value.
 */
export class GeometryPolygon extends Geometry {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, GEOMETRY_POLYGON_SYMBOL);
    }

    readonly polygon: [GeometryLine, ...GeometryLine[]];

    constructor(polygon: [GeometryLine, ...GeometryLine[]] | GeometryPolygon) {
        super();
        this.polygon =
            polygon instanceof GeometryPolygon
                ? (polygon as unknown as GeometryPolygon).clone().polygon
                : ((polygon as [GeometryLine, ...GeometryLine[]]).map((l) => {
                      const line = l.clone();
                      line.close();
                      return line;
                  }) as [GeometryLine, ...GeometryLine[]]);
        markSymbol(this, GEOMETRY_POLYGON_SYMBOL);
    }

    toJSON(): GeoJsonPolygon {
        return {
            type: "Polygon" as const,
            coordinates: this.coordinates,
        };
    }

    get coordinates(): GeoJsonPolygon["coordinates"] {
        return this.polygon.map((g) => g.coordinates) as GeoJsonPolygon["coordinates"];
    }

    is(geometry: Geometry): geometry is GeometryPolygon {
        if (!(geometry instanceof GeometryPolygon)) return false;
        const gp = geometry as unknown as GeometryPolygon;
        if (this.polygon.length !== gp.polygon.length) return false;
        for (let i = 0; i < this.polygon.length; i++) {
            if (!this.polygon[i].is(gp.polygon[i])) return false;
        }

        return true;
    }

    clone(): GeometryPolygon {
        return new GeometryPolygon(
            this.polygon.map((p) => p.clone()) as [GeometryLine, ...GeometryLine[]],
        );
    }
}

/**
 * A SurrealQL multi-point geometry value.
 */
export class GeometryMultiPoint extends Geometry {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, GEOMETRY_MULTI_POINT_SYMBOL);
    }

    readonly points: [GeometryPoint, ...GeometryPoint[]];

    constructor(points: [GeometryPoint, ...GeometryPoint[]] | GeometryMultiPoint) {
        super();
        this.points =
            points instanceof GeometryMultiPoint
                ? (points as unknown as GeometryMultiPoint).points
                : (points as [GeometryPoint, ...GeometryPoint[]]);
        markSymbol(this, GEOMETRY_MULTI_POINT_SYMBOL);
    }

    toJSON(): GeoJsonMultiPoint {
        return {
            type: "MultiPoint" as const,
            coordinates: this.coordinates,
        };
    }

    get coordinates(): GeoJsonMultiPoint["coordinates"] {
        return this.points.map((g) => g.coordinates) as GeoJsonMultiPoint["coordinates"];
    }

    is(geometry: Geometry): geometry is GeometryMultiPoint {
        if (!(geometry instanceof GeometryMultiPoint)) return false;
        const gmp = geometry as unknown as GeometryMultiPoint;
        if (this.points.length !== gmp.points.length) return false;
        for (let i = 0; i < this.points.length; i++) {
            if (!this.points[i].is(gmp.points[i])) return false;
        }

        return true;
    }

    clone(): GeometryMultiPoint {
        return new GeometryMultiPoint(
            this.points.map((p) => p.clone()) as [GeometryPoint, ...GeometryPoint[]],
        );
    }
}

/**
 * A SurrealQL multi-line geometry value.
 */
export class GeometryMultiLine extends Geometry {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, GEOMETRY_MULTI_LINE_SYMBOL);
    }

    readonly lines: [GeometryLine, ...GeometryLine[]];

    constructor(lines: [GeometryLine, ...GeometryLine[]] | GeometryMultiLine) {
        super();
        this.lines =
            lines instanceof GeometryMultiLine
                ? (lines as unknown as GeometryMultiLine).lines
                : (lines as [GeometryLine, ...GeometryLine[]]);
        markSymbol(this, GEOMETRY_MULTI_LINE_SYMBOL);
    }

    toJSON(): GeoJsonMultiLineString {
        return {
            type: "MultiLineString" as const,
            coordinates: this.coordinates,
        };
    }

    get coordinates(): GeoJsonMultiLineString["coordinates"] {
        return this.lines.map((g) => g.coordinates) as GeoJsonMultiLineString["coordinates"];
    }

    is(geometry: Geometry): geometry is GeometryMultiLine {
        if (!(geometry instanceof GeometryMultiLine)) return false;
        const gml = geometry as unknown as GeometryMultiLine;
        if (this.lines.length !== gml.lines.length) return false;
        for (let i = 0; i < this.lines.length; i++) {
            if (!this.lines[i].is(gml.lines[i])) return false;
        }

        return true;
    }

    clone(): GeometryMultiLine {
        return new GeometryMultiLine(
            this.lines.map((p) => p.clone()) as [GeometryLine, ...GeometryLine[]],
        );
    }
}

/**
 * A SurrealQL multi-polygon geometry value.
 */
export class GeometryMultiPolygon extends Geometry {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, GEOMETRY_MULTI_POLYGON_SYMBOL);
    }

    readonly polygons: [GeometryPolygon, ...GeometryPolygon[]];

    constructor(polygons: [GeometryPolygon, ...GeometryPolygon[]] | GeometryMultiPolygon) {
        super();
        this.polygons =
            polygons instanceof GeometryMultiPolygon
                ? (polygons as unknown as GeometryMultiPolygon).polygons
                : (polygons as [GeometryPolygon, ...GeometryPolygon[]]);
        markSymbol(this, GEOMETRY_MULTI_POLYGON_SYMBOL);
    }

    toJSON(): GeoJsonMultiPolygon {
        return {
            type: "MultiPolygon" as const,
            coordinates: this.coordinates,
        };
    }

    get coordinates(): GeoJsonMultiPolygon["coordinates"] {
        return this.polygons.map((g) => g.coordinates) as GeoJsonMultiPolygon["coordinates"];
    }

    is(geometry: Geometry): geometry is GeometryMultiPolygon {
        if (!(geometry instanceof GeometryMultiPolygon)) return false;
        const gmp = geometry as unknown as GeometryMultiPolygon;
        if (this.polygons.length !== gmp.polygons.length) return false;
        for (let i = 0; i < this.polygons.length; i++) {
            if (!this.polygons[i].is(gmp.polygons[i])) return false;
        }

        return true;
    }

    clone(): GeometryMultiPolygon {
        return new GeometryMultiPolygon(
            this.polygons.map((p) => p.clone()) as [GeometryPolygon, ...GeometryPolygon[]],
        );
    }
}

/**
 * A SurrealQL geometry collection value.
 */
export class GeometryCollection extends Geometry {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, GEOMETRY_COLLECTION_SYMBOL);
    }

    readonly collection: [Geometry, ...Geometry[]];

    constructor(collection: [Geometry, ...Geometry[]] | GeometryCollection) {
        super();
        this.collection =
            collection instanceof GeometryCollection
                ? (collection as unknown as GeometryCollection).collection
                : (collection as [Geometry, ...Geometry[]]);
        markSymbol(this, GEOMETRY_COLLECTION_SYMBOL);
    }

    toJSON(): GeoJsonCollection {
        return {
            type: "GeometryCollection" as const,
            geometries: this.geometries,
        };
    }

    get geometries(): GeoJsonCollection["geometries"] {
        return this.collection.map((g) => g.toJSON()) as GeoJsonCollection["geometries"];
    }

    is(geometry: Geometry): geometry is GeometryCollection {
        if (!(geometry instanceof GeometryCollection)) return false;
        const gc = geometry as unknown as GeometryCollection;
        if (this.collection.length !== gc.collection.length) return false;
        for (let i = 0; i < this.collection.length; i++) {
            if (!this.collection[i].is(gc.collection[i])) return false;
        }

        return true;
    }

    clone(): GeometryCollection {
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
    coordinates: [GeoJsonLineString["coordinates"], ...GeoJsonLineString["coordinates"][]];
};

export type GeoJsonMultiPoint = {
    type: "MultiPoint";
    coordinates: [GeoJsonPoint["coordinates"], ...GeoJsonPoint["coordinates"][]];
};

export type GeoJsonMultiLineString = {
    type: "MultiLineString";
    coordinates: [GeoJsonLineString["coordinates"], ...GeoJsonLineString["coordinates"][]];
};

export type GeoJsonMultiPolygon = {
    type: "MultiPolygon";
    coordinates: [GeoJsonPolygon["coordinates"], ...GeoJsonPolygon["coordinates"][]];
};

export type GeoJsonCollection = {
    type: "GeometryCollection";
    geometries: GeoJson[];
};
