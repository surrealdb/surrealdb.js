import { describe, expect, test } from "bun:test";
import {
    Geometry,
    GeometryCollection,
    GeometryLine,
    GeometryMultiLine,
    GeometryMultiPoint,
    GeometryMultiPolygon,
    GeometryPoint,
    GeometryPolygon,
} from "surrealdb";

describe("GeometryPoint", () => {
    test("construct from coordinates", () => {
        const point = new GeometryPoint([1.5, 2.5]);
        expect(point.point).toEqual([1.5, 2.5]);
    });

    test("construct from GeoJSON", () => {
        const point = new GeometryPoint({ type: "Point" as const, coordinates: [10, 20] });
        expect(point.point).toEqual([10, 20]);
    });

    test("clone", () => {
        const point = new GeometryPoint([5, 10]);
        const cloned = point.clone();
        expect(cloned.point).toEqual([5, 10]);
        expect(cloned).not.toBe(point);
    });

    test("toJSON", () => {
        const point = new GeometryPoint([1, 2]);
        expect(point.toJSON()).toEqual({ type: "Point", coordinates: [1, 2] });
    });

    test("equals", () => {
        const a = new GeometryPoint([1, 2]);
        const b = new GeometryPoint([1, 2]);
        const c = new GeometryPoint([3, 4]);
        expect(a.equals(b)).toBe(true);
        expect(a.equals(c)).toBe(false);
    });

    test("toString", () => {
        const point = new GeometryPoint([1, 2]);
        expect(point.toString()).toBe('{"type":"Point","coordinates":[1,2]}');
    });
});

describe("GeometryLine", () => {
    const p1 = new GeometryPoint([0, 0]);
    const p2 = new GeometryPoint([1, 1]);
    const p3 = new GeometryPoint([2, 0]);

    test("construct from points", () => {
        const line = new GeometryLine([p1, p2, p3]);
        expect(line.line).toHaveLength(3);
    });

    test("construct from GeoJSON", () => {
        const line = new GeometryLine({
            type: "LineString" as const,
            coordinates: [[0, 0], [1, 1], [2, 0]] as [[number, number], [number, number], ...[number, number][]],
        });
        expect(line.line).toHaveLength(3);
        expect(line.line[0].point).toEqual([0, 0]);
    });

    test("clone", () => {
        const line = new GeometryLine([p1, p2]);
        const cloned = line.clone();
        expect(cloned.line).toHaveLength(2);
        expect(cloned).not.toBe(line);
    });

    test("toJSON", () => {
        const line = new GeometryLine([p1, p2]);
        const json = line.toJSON();
        expect(json.type).toBe("LineString");
        expect(json.coordinates).toHaveLength(2);
    });

    test("equals", () => {
        const a = new GeometryLine([p1, p2]);
        const b = new GeometryLine([new GeometryPoint([0, 0]), new GeometryPoint([1, 1])]);
        const c = new GeometryLine([p1, p3]);
        expect(a.equals(b)).toBe(true);
        expect(a.equals(c)).toBe(false);
    });
});

describe("GeometryPolygon", () => {
    const ring = new GeometryLine([
        new GeometryPoint([0, 0]),
        new GeometryPoint([1, 0]),
        new GeometryPoint([1, 1]),
        new GeometryPoint([0, 0]),
    ]);

    test("construct from lines", () => {
        const poly = new GeometryPolygon([ring]);
        expect(poly.polygon).toHaveLength(1);
    });

    test("construct from GeoJSON", () => {
        const poly = new GeometryPolygon({
            type: "Polygon" as const,
            coordinates: [
                [[0, 0], [1, 0], [1, 1], [0, 0]] as [[number, number], [number, number], ...[number, number][]],
            ] as [[[number, number], [number, number], ...[number, number][]]],
        });
        expect(poly.polygon).toHaveLength(1);
    });

    test("clone", () => {
        const poly = new GeometryPolygon([ring]);
        const cloned = poly.clone();
        expect(cloned.polygon).toHaveLength(1);
        expect(cloned).not.toBe(poly);
    });

    test("toJSON", () => {
        const poly = new GeometryPolygon([ring]);
        const json = poly.toJSON();
        expect(json.type).toBe("Polygon");
    });

    test("equals", () => {
        const a = new GeometryPolygon([ring]);
        const b = new GeometryPolygon([ring.clone()]);
        expect(a.equals(b)).toBe(true);
    });
});

describe("GeometryMultiPoint", () => {
    const p1 = new GeometryPoint([0, 0]);
    const p2 = new GeometryPoint([1, 1]);

    test("construct from points", () => {
        const mp = new GeometryMultiPoint([p1, p2]);
        expect(mp.points).toHaveLength(2);
    });

    test("construct from GeoJSON", () => {
        const mp = new GeometryMultiPoint({
            type: "MultiPoint" as const,
            coordinates: [[0, 0], [1, 1]] as [[number, number], ...[number, number][]],
        });
        expect(mp.points).toHaveLength(2);
        expect(mp.points[0].point).toEqual([0, 0]);
    });

    test("toJSON", () => {
        const mp = new GeometryMultiPoint([p1, p2]);
        const json = mp.toJSON();
        expect(json.type).toBe("MultiPoint");
        expect(json.coordinates).toHaveLength(2);
    });

    test("equals", () => {
        const a = new GeometryMultiPoint([p1, p2]);
        const b = new GeometryMultiPoint([
            new GeometryPoint([0, 0]),
            new GeometryPoint([1, 1]),
        ]);
        expect(a.equals(b)).toBe(true);
    });
});

describe("GeometryMultiLine", () => {
    const line = new GeometryLine([
        new GeometryPoint([0, 0]),
        new GeometryPoint([1, 1]),
    ]);

    test("construct from lines", () => {
        const ml = new GeometryMultiLine([line]);
        expect(ml.lines).toHaveLength(1);
    });

    test("construct from GeoJSON", () => {
        const ml = new GeometryMultiLine({
            type: "MultiLineString" as const,
            coordinates: [
                [[0, 0], [1, 1]] as [[number, number], [number, number], ...[number, number][]],
            ] as [[[number, number], [number, number], ...[number, number][]]],
        });
        expect(ml.lines).toHaveLength(1);
    });

    test("toJSON", () => {
        const ml = new GeometryMultiLine([line]);
        const json = ml.toJSON();
        expect(json.type).toBe("MultiLineString");
    });
});

describe("GeometryMultiPolygon", () => {
    const ring = new GeometryLine([
        new GeometryPoint([0, 0]),
        new GeometryPoint([1, 0]),
        new GeometryPoint([1, 1]),
        new GeometryPoint([0, 0]),
    ]);
    const poly = new GeometryPolygon([ring]);

    test("construct from polygons", () => {
        const mpoly = new GeometryMultiPolygon([poly]);
        expect(mpoly.polygons).toHaveLength(1);
    });

    test("toJSON", () => {
        const mpoly = new GeometryMultiPolygon([poly]);
        const json = mpoly.toJSON();
        expect(json.type).toBe("MultiPolygon");
    });
});

describe("GeometryCollection", () => {
    const point = new GeometryPoint([1, 2]);
    const line = new GeometryLine([
        new GeometryPoint([0, 0]),
        new GeometryPoint([3, 3]),
    ]);

    test("construct from geometries", () => {
        const coll = new GeometryCollection([point, line]);
        expect(coll.collection).toHaveLength(2);
    });

    test("construct from GeoJSON", () => {
        const coll = new GeometryCollection({
            type: "GeometryCollection" as const,
            geometries: [
                { type: "Point" as const, coordinates: [1, 2] as [number, number] },
            ],
        });
        expect(coll.collection).toHaveLength(1);
        expect(coll.collection[0]).toBeInstanceOf(GeometryPoint);
    });

    test("toJSON", () => {
        const coll = new GeometryCollection([point, line]);
        const json = coll.toJSON();
        expect(json.type).toBe("GeometryCollection");
        expect(json.geometries).toHaveLength(2);
    });

    test("equals", () => {
        const a = new GeometryCollection([point, line]);
        const b = new GeometryCollection([point.clone(), line.clone()]);
        expect(a.equals(b)).toBe(true);
    });
});

describe("Geometry.fromJSON", () => {
    test("dispatches Point", () => {
        const result = Geometry.fromJSON({ type: "Point", coordinates: [1, 2] });
        expect(result).toBeInstanceOf(GeometryPoint);
    });

    test("dispatches LineString", () => {
        const result = Geometry.fromJSON({
            type: "LineString",
            coordinates: [[0, 0], [1, 1]],
        } as { type: "LineString"; coordinates: [[number, number], [number, number]] });
        expect(result).toBeInstanceOf(GeometryLine);
    });

    test("dispatches Polygon", () => {
        const result = Geometry.fromJSON({
            type: "Polygon",
            coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
        } as { type: "Polygon"; coordinates: [[[number, number], [number, number], ...[number, number][]]] });
        expect(result).toBeInstanceOf(GeometryPolygon);
    });

    test("dispatches MultiPoint", () => {
        const result = Geometry.fromJSON({
            type: "MultiPoint",
            coordinates: [[0, 0], [1, 1]],
        } as { type: "MultiPoint"; coordinates: [[number, number], ...[number, number][]] });
        expect(result).toBeInstanceOf(GeometryMultiPoint);
    });

    test("dispatches GeometryCollection", () => {
        const result = Geometry.fromJSON({
            type: "GeometryCollection",
            geometries: [{ type: "Point", coordinates: [1, 2] }],
        });
        expect(result).toBeInstanceOf(GeometryCollection);
    });
});
