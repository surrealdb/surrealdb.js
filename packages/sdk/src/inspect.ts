import type { InspectOptions } from "node:util";
import { BoundQuery } from "./utils";
import {
    DateTime,
    Decimal,
    Duration,
    FileRef,
    type Geometry,
    GeometryCollection,
    GeometryLine,
    GeometryMultiLine,
    GeometryMultiPoint,
    GeometryMultiPolygon,
    GeometryPoint,
    GeometryPolygon,
    Range,
    RecordId,
    RecordIdRange,
    StringRecordId,
    Table,
    Uuid,
} from "./value";

if (typeof process !== "undefined") {
    /*#__PURE__*/ setUpCustomInspectors();
    function setUpCustomInspectors() {
        const colors = {
            black: "\x1b[30m",
            red: "\x1b[31m",
            green: "\x1b[32m",
            yellow: "\x1b[33m",
            blue: "\x1b[34m",
            purple: "\x1b[35m",
            cyan: "\x1b[36m",
            white: "\x1b[37m",
            bold: {
                black: "\x1b[1;30m",
                red: "\x1b[1;31m",
                green: "\x1b[1;32m",
                yellow: "\x1b[1;33m",
                blue: "\x1b[1;34m",
                purple: "\x1b[1;35m",
                cyan: "\x1b[1;36m",
                white: "\x1b[1;37m",
            },
            bright: {
                black: "\x1b[90m",
                red: "\x1b[91m",
                green: "\x1b[92m",
                yellow: "\x1b[93m",
                blue: "\x1b[94m",
                purple: "\x1b[95m",
                cyan: "\x1b[96m",
                white: "\x1b[97m",
            },
            dim: "\x1b[2m",
            reset: "\x1b[0m",
        };

        function colorize(color: string, text: string) {
            return `${color}${text}${colors.reset}`;
        }

        const ColorsMap = new Map<new (...args: any[]) => any, string>([
            [DateTime, colors.bright.purple],
            [Decimal, colors.bright.yellow],
            [Duration, colors.bright.cyan],
            [FileRef, colors.bright.green],
            [GeometryPoint, colors.bright.yellow],
            [GeometryLine, colors.bright.yellow],
            [GeometryPolygon, colors.bright.yellow],
            [GeometryMultiPoint, colors.bright.yellow],
            [GeometryMultiLine, colors.bright.yellow],
            [GeometryMultiPolygon, colors.bright.yellow],
            [GeometryCollection, colors.bright.yellow],
            [Range, colors.bright.yellow],
            [RecordIdRange, colors.bright.blue],
            [RecordId, colors.bright.blue],
            [StringRecordId, colors.bright.blue],
            [Table, colors.bright.blue],
            [Uuid, colors.bright.green],
        ]);

        const { inspect } = require("node:util");
        function createCustomInspect<Cls extends new (...args: any[]) => any>(
            cls: Cls,
            format: (inst: InstanceType<Cls>, options: InspectOptions) => string,
        ) {
            const color = ColorsMap.get(cls);
            cls.prototype[inspect.custom] = function (
                this: InstanceType<Cls>,
                _: unknown,
                options: InspectOptions,
            ) {
                const string = format(this, options);
                return options.colors && color ? colorize(color, string) : string;
            };
        }

        createCustomInspect(DateTime, (inst) => inst.toISOString());
        createCustomInspect(Decimal, (inst) => `${inst.toString()}dec`);
        createCustomInspect(Duration, (inst) => inst.toString());
        createCustomInspect(FileRef, (inst) => `f"${inst.toString()}"`);
        // Futures were removed in SurrealDB 3.0 so we don't need to implement them
        createCustomInspect(GeometryPoint, (inst) => fmtPoint(inst));
        createCustomInspect(GeometryLine, (inst, options) => {
            const depth = options.depth ?? 0;
            if (depth < 2) {
                return `Line(${plural(inst.line.length, "point", "pts")})`;
            }

            return formatArray({
                ...options,
                items: inst.line,
                formatter: fmtPoint,
                chunking: options.compact
                    ? (acc, item) => {
                          if (acc.chunk.length < 4) {
                              acc.chunk.push(item);
                          } else {
                              acc.chunks.push(acc.chunk);
                              acc.chunk = [item];
                          }
                          return acc;
                      }
                    : undefined,
                prefix: "Line[",
                separator: " → ",
                suffix: "]",
            });
        });
        createCustomInspect(GeometryPolygon, (inst, options) => {
            const depth = options.depth ?? 0;

            if (depth < 2) {
                return `Polygon(${plural(inst.polygon.length, "ring")})`;
            }

            const fmtRing = (l: GeometryLine) => {
                if (depth === 2) return `Ring(${plural(l.line.length, "point", "pts")})`;
                return inspect(l, {
                    ...options,
                    colors: false,
                }).replace(/Line/, "Ring");
            };

            return formatArray({
                ...options,
                items: inst.polygon,
                formatter: fmtRing,
                inline: 0,
                prefix: "Polygon[",
                separator: ", ",
                suffix: "]",
            });
        });
        createCustomInspect(GeometryMultiPoint, (inst, options) => {
            const depth = options.depth ?? 0;
            if (depth < 2) {
                return `MultiPoint(${plural(inst.points.length, "point")})`;
            }
            return formatArray({
                ...options,
                items: inst.points,
                formatter: fmtPoint,
                prefix: "MultiPoint[",
                separator: ", ",
                suffix: "]",
            });
        });
        createCustomInspect(GeometryMultiLine, (inst, options) => {
            const depth = options.depth ?? 0;
            if (depth < 2) {
                return `MultiLine(${plural(inst.lines.length, "line")})`;
            }
            const fmtLine = (l: GeometryLine) => {
                if (depth === 2) return `Line(${plural(l.line.length, "point", "pts")})`;
                return inspect(l, { ...options, colors: false });
            };
            return formatArray({
                ...options,
                items: inst.lines,
                formatter: fmtLine,
                inline: 0,
                prefix: "MultiLine[",
                separator: ", ",
                suffix: "]",
            });
        });
        createCustomInspect(GeometryMultiPolygon, (inst, options) => {
            const depth = options.depth ?? 0;
            if (depth < 2) {
                return `MultiPolygon(${plural(inst.polygons.length, "polygon")})`;
            }
            const fmtPolygon = (p: GeometryPolygon) => {
                if (depth === 2) return `Polygon(${plural(p.polygon.length, "ring")})`;
                return inspect(p, { ...options, colors: false });
            };
            return formatArray({
                ...options,
                items: inst.polygons,
                formatter: fmtPolygon,
                inline: 0,
                prefix: "MultiPolygon[",
                separator: ", ",
                suffix: "]",
            });
        });
        createCustomInspect(GeometryCollection, (inst, options) => {
            const depth = options.depth ?? 0;
            if (depth < 2) {
                return `Collection(${plural(inst.collection.length, "geometry", "geometries")})`;
            }
            const fmtGeom = (g: Geometry) => {
                // if (depth === 2) return g.constructor.name.replace("Geometry", "");
                return inspect(g, { ...options, colors: false, depth: depth - 1 });
            };
            return formatArray({
                ...options,
                items: inst.collection,
                formatter: fmtGeom,
                inline: 0,
                prefix: "Collection[",
                separator: ", ",
                suffix: "]",
            });
        });
        createCustomInspect(Range, (inst) => inst.toString());
        createCustomInspect(RecordIdRange, (inst) => inst.toString());
        createCustomInspect(RecordId, (inst) => inst.toString());
        createCustomInspect(StringRecordId, (inst) => inst.toString());
        createCustomInspect(Table, (inst) => inst.toString());
        createCustomInspect(Uuid, (inst) => `u"${inst.toString()}"`);
        createCustomInspect(BoundQuery, (inst, options) => {
            const dim = options.colors ? colors.dim : "";
            const reset = options.colors ? colors.reset : "";
            const lines = [inst.query];
            const bindings = Object.entries(inst.bindings);

            if (bindings.length > 0) {
                lines.push(`${dim}--- Variables ---${reset}`);
            }

            for (const [key, value] of bindings) {
                const valueStr = inspect(value, { ...options }).replace(/\n/g, `\n${dim}-- `);
                lines.push(`${dim}-- $${key} = ${valueStr}${reset}`);
            }
            return lines.join("\n");
        });
    }

    // Geometry formatting helpers

    function plural(count: number, word: string, plural?: string) {
        return `${count} ${count === 1 ? word : (plural ?? `${word}s`)}`;
    }

    function fmtPoint(p: GeometryPoint) {
        return `(${p.point[0]}, ${p.point[1]})`;
    }

    function formatArray<T>(
        options: InspectOptions & {
            items: T[];
            formatter: (item: T) => string;
            chunking?: (
                acc: {
                    chunks: T[][];
                    chunk: T[];
                },
                item: T,
                breakLength: number,
            ) => typeof acc;
            prefix: string;
            separator: string;
            suffix: string;
            /**
             * If the array length is less than or equal to this value, the array will be
             * formatted on a single line.
             * @default 3 */
            inline?: number;
        },
    ): string {
        const items = options.items;
        const maxLen = options.maxArrayLength ?? 100;
        const breakLength = options.breakLength ?? 80;
        const prefix = options.prefix;
        const separator = options.separator ?? ", ";
        const suffix = options.suffix;
        const formatter = options.formatter;
        const inline = options.inline ?? 3;

        if (items.length === 0) return `${prefix}${suffix}`;

        const limited = maxLen >= 0 && items.length > maxLen;
        const visibleItems = limited ? items.slice(0, maxLen) : items;
        const remaining = items.length - visibleItems.length;
        let formatted = [];
        if (options.chunking) {
            const chunking = options.chunking;
            const chunks = visibleItems.reduce((acc, item) => chunking(acc, item, breakLength), {
                chunks: [] as T[][],
                chunk: [] as T[],
            });
            if (chunks.chunk.length > 0) {
                chunks.chunks.push(chunks.chunk);
            }
            formatted = chunks.chunks.map((chunk) => chunk.map(formatter).join(separator));
        } else {
            formatted = visibleItems.map(formatter);
        }

        // Single-line format
        if (items.length <= inline) {
            return `${prefix}${formatted.join(separator)}${
                limited ? `${separator}... ${remaining} more` : ""
            }${suffix}`;
        }

        // Multi-line format
        const indent = "  ";
        // Indent each line within multi-line items as well
        const lines = formatted.map((f) => indent + f.replace(/\n/g, `\n${indent}`));
        if (limited) lines.push(`${indent}... ${remaining} more`);
        return `${prefix}\n${lines.join(`${separator}\n`)}\n${suffix}`;
    }
}
