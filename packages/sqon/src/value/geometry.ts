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
} from "../utils/symbols.ts";
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
        return this.is(other);
    }

    toString(): string {
        return JSON.stringify(this.toJSON());
    }

    /**
     * Create a Geometry instance from a GeoJSON object.
     */
    static fromJSON(json: GeoJson): Geometry {
        switch (json.type) {
            case "Point":
                return new GeometryPoint(json);
            case "LineString":
                return new GeometryLine(json);
            case "Polygon":
                return new GeometryPolygon(json);
            case "MultiPoint":
                return new GeometryMultiPoint(json);
            case "MultiLineString":
                return new GeometryMultiLine(json);
            case "MultiPolygon":
                return new GeometryMultiPolygon(json);
            case "GeometryCollection":
                return new GeometryCollection(json);
        }
    }
}

/**
 * A SurrealQL point geometry value.
 */
export class GeometryPoint extends Geometry {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, GEOMETRY_POINT_SYMBOL);
    }

    readonly point: [number, number];

    /** Construct from a coordinate pair. */
    constructor(point: [number | Decimal, number | Decimal]);
    /** Construct from a GeoJSON Point object. */
    constructor(json: GeoJsonPoint);
    /** Clone an existing GeometryPoint. */
    constructor(source: GeometryPoint);
    constructor(input: [number | Decimal, number | Decimal] | GeoJsonPoint | GeometryPoint) {
        super();
        if (input instanceof GeometryPoint) {
            this.point = (input as unknown as GeometryPoint).clone().point;
        } else if (Array.isArray(input)) {
            this.point = [f(input[0]), f(input[1])];
        } else {
            this.point = [...input.coordinates];
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
        return this.point[0] === geometry.point[0] && this.point[1] === geometry.point[1];
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

    /** Construct from an array of points. */
    constructor(line: [GeometryPoint, GeometryPoint, ...GeometryPoint[]]);
    /** Construct from a GeoJSON LineString object. */
    constructor(json: GeoJsonLineString);
    /** Clone an existing GeometryLine. */
    constructor(source: GeometryLine);
    constructor(
        input:
            | [GeometryPoint, GeometryPoint, ...GeometryPoint[]]
            | GeoJsonLineString
            | GeometryLine,
    ) {
        super();
        if (input instanceof GeometryLine) {
            this.line = (input as unknown as GeometryLine).clone().line;
        } else if (Array.isArray(input)) {
            this.line = input;
        } else {
            this.line = input.coordinates.map((c) => new GeometryPoint(c)) as [
                GeometryPoint,
                GeometryPoint,
                ...GeometryPoint[],
            ];
        }
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
        if (this.line.length !== geometry.line.length) return false;
        for (let i = 0; i < this.line.length; i++) {
            if (!this.line[i].is(geometry.line[i])) return false;
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

    /** Construct from an array of line rings. */
    constructor(polygon: [GeometryLine, ...GeometryLine[]]);
    /** Construct from a GeoJSON Polygon object. */
    constructor(json: GeoJsonPolygon);
    /** Clone an existing GeometryPolygon. */
    constructor(source: GeometryPolygon);
    constructor(input: [GeometryLine, ...GeometryLine[]] | GeoJsonPolygon | GeometryPolygon) {
        super();
        if (input instanceof GeometryPolygon) {
            this.polygon = (input as unknown as GeometryPolygon).clone().polygon;
        } else if (Array.isArray(input)) {
            this.polygon = input.map((l) => {
                const line = l.clone();
                line.close();
                return line;
            }) as [GeometryLine, ...GeometryLine[]];
        } else {
            this.polygon = input.coordinates.map((ring) => {
                const line = new GeometryLine(
                    ring.map((c) => new GeometryPoint(c)) as [
                        GeometryPoint,
                        GeometryPoint,
                        ...GeometryPoint[],
                    ],
                );
                line.close();
                return line;
            }) as [GeometryLine, ...GeometryLine[]];
        }
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
        if (this.polygon.length !== geometry.polygon.length) return false;
        for (let i = 0; i < this.polygon.length; i++) {
            if (!this.polygon[i].is(geometry.polygon[i])) return false;
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

    /** Construct from an array of points. */
    constructor(points: [GeometryPoint, ...GeometryPoint[]]);
    /** Construct from a GeoJSON MultiPoint object. */
    constructor(json: GeoJsonMultiPoint);
    /** Clone an existing GeometryMultiPoint. */
    constructor(source: GeometryMultiPoint);
    constructor(
        input: [GeometryPoint, ...GeometryPoint[]] | GeoJsonMultiPoint | GeometryMultiPoint,
    ) {
        super();
        if (input instanceof GeometryMultiPoint) {
            this.points = (input as unknown as GeometryMultiPoint).points;
        } else if (Array.isArray(input)) {
            this.points = input;
        } else {
            this.points = input.coordinates.map((c) => new GeometryPoint(c)) as [
                GeometryPoint,
                ...GeometryPoint[],
            ];
        }
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
        if (this.points.length !== geometry.points.length) return false;
        for (let i = 0; i < this.points.length; i++) {
            if (!this.points[i].is(geometry.points[i])) return false;
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

    /** Construct from an array of lines. */
    constructor(lines: [GeometryLine, ...GeometryLine[]]);
    /** Construct from a GeoJSON MultiLineString object. */
    constructor(json: GeoJsonMultiLineString);
    /** Clone an existing GeometryMultiLine. */
    constructor(source: GeometryMultiLine);
    constructor(
        input: [GeometryLine, ...GeometryLine[]] | GeoJsonMultiLineString | GeometryMultiLine,
    ) {
        super();
        if (input instanceof GeometryMultiLine) {
            this.lines = (input as unknown as GeometryMultiLine).lines;
        } else if (Array.isArray(input)) {
            this.lines = input;
        } else {
            this.lines = input.coordinates.map(
                (coords) =>
                    new GeometryLine(
                        coords.map((c) => new GeometryPoint(c)) as [
                            GeometryPoint,
                            GeometryPoint,
                            ...GeometryPoint[],
                        ],
                    ),
            ) as [GeometryLine, ...GeometryLine[]];
        }
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
        if (this.lines.length !== geometry.lines.length) return false;
        for (let i = 0; i < this.lines.length; i++) {
            if (!this.lines[i].is(geometry.lines[i])) return false;
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

    /** Construct from an array of polygons. */
    constructor(polygons: [GeometryPolygon, ...GeometryPolygon[]]);
    /** Construct from a GeoJSON MultiPolygon object. */
    constructor(json: GeoJsonMultiPolygon);
    /** Clone an existing GeometryMultiPolygon. */
    constructor(source: GeometryMultiPolygon);
    constructor(
        input: [GeometryPolygon, ...GeometryPolygon[]] | GeoJsonMultiPolygon | GeometryMultiPolygon,
    ) {
        super();
        if (input instanceof GeometryMultiPolygon) {
            this.polygons = (input as unknown as GeometryMultiPolygon).polygons;
        } else if (Array.isArray(input)) {
            this.polygons = input;
        } else {
            this.polygons = input.coordinates.map(
                (rings) =>
                    new GeometryPolygon(
                        rings.map(
                            (ring) =>
                                new GeometryLine(
                                    ring.map((c) => new GeometryPoint(c)) as [
                                        GeometryPoint,
                                        GeometryPoint,
                                        ...GeometryPoint[],
                                    ],
                                ),
                        ) as [GeometryLine, ...GeometryLine[]],
                    ),
            ) as [GeometryPolygon, ...GeometryPolygon[]];
        }
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
        if (this.polygons.length !== geometry.polygons.length) return false;
        for (let i = 0; i < this.polygons.length; i++) {
            if (!this.polygons[i].is(geometry.polygons[i])) return false;
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

    /** Construct from an array of geometries. */
    constructor(collection: [Geometry, ...Geometry[]]);
    /** Construct from a GeoJSON GeometryCollection object. */
    constructor(json: GeoJsonCollection);
    /** Clone an existing GeometryCollection. */
    constructor(source: GeometryCollection);
    constructor(input: [Geometry, ...Geometry[]] | GeoJsonCollection | GeometryCollection) {
        super();
        if (input instanceof GeometryCollection) {
            this.collection = (input as unknown as GeometryCollection).collection;
        } else if (Array.isArray(input)) {
            this.collection = input;
        } else {
            this.collection = input.geometries.map((g) => Geometry.fromJSON(g)) as [
                Geometry,
                ...Geometry[],
            ];
        }
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
        if (this.collection.length !== geometry.collection.length) return false;
        for (let i = 0; i < this.collection.length; i++) {
            if (!this.collection[i].is(geometry.collection[i])) return false;
        }

        return true;
    }

    clone(): GeometryCollection {
        return new GeometryCollection(
            this.collection.map((p) => p.clone()) as [Geometry, ...Geometry[]],
        );
    }
}

// Utility functions

function f(num: number | Decimal) {
    if (num instanceof Decimal) return num.toFloat();
    return num;
}

// Geo Json Types

export type GeoJson =
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
