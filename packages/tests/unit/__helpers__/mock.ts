import {
    BoundExcluded,
    BoundIncluded,
    Decimal,
    Duration,
    FileRef,
    GeometryCollection,
    GeometryLine,
    GeometryMultiPolygon,
    GeometryPoint,
    GeometryPolygon,
    Range,
    RecordId,
    RecordIdRange,
    StringRecordId,
    Table,
    Uuid,
} from "surrealdb";

export function createMockValue(): object {
    return {
        rid: new RecordId("some:thing", "under_score"),
        id_looks_like_number: new RecordId("some:thing", "123"),
        id_almost_a_number: new RecordId("some:thing", "1e23"),
        id_is_a_number: new RecordId("some:thing", 123),
        str_rid: new StringRecordId("⟨some:thing⟩:under_score"),
        rng_rid: new RecordIdRange("bla", new BoundIncluded("a"), new BoundExcluded("z")),
        range: new Range(new BoundIncluded(new RecordId("bla", "a")), new BoundExcluded("z")),
        range_unbounded: new Range(undefined, new BoundExcluded("z")),
        dec: new Decimal("3.333333"),
        dur: new Duration("1d2h"),
        geo: new GeometryCollection([
            new GeometryPoint([1, 2]),
            new GeometryMultiPolygon([
                new GeometryPolygon([
                    new GeometryLine([new GeometryPoint([1, 2]), new GeometryPoint([3, 4])]),
                    new GeometryLine([new GeometryPoint([5, 6]), new GeometryPoint([7, 8])]),
                ]),
            ]),
            new GeometryPolygon([
                new GeometryLine([new GeometryPoint([1, 2]), new GeometryPoint([3, 4])]),
                new GeometryLine([new GeometryPoint([5, 6]), new GeometryPoint([7, 8])]),
            ]),
        ]),

        tb: new Table("some super _ cool table"),
        uuid: new Uuid("92b84bde-39c8-4b4b-92f7-626096d6c4d9"),
        date: new Date("2024-05-06T17:44:57.085Z"),
        file: new FileRef("my bucket", "file/name"),
        undef: undefined,
        null: null,
        num: 123,
        float: 123.456,
        true: true,
        false: false,
        string: "I am a string",
    };
}
