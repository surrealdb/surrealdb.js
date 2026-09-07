import { Duration } from "@surrealdb/sqon";
import type { QueryStats } from "../types/surreal";

/**
 * The stats for a statement whose only reported measurement is its duration.
 *
 * No engine reports byte or record counts yet, and every path that builds a
 * chunk has to put something in those fields. `-1` is the placeholder they all
 * agree on, kept here so the buffered and streaming paths cannot drift into
 * reporting different shapes for the same missing measurement.
 *
 * @param time The statement's duration, in the wire's textual form.
 */
export function statsFromTime(time: string): QueryStats {
    return {
        bytesReceived: -1,
        bytesScanned: -1,
        recordsReceived: -1,
        recordsScanned: -1,
        duration: Duration.parseFloat(time),
    };
}
