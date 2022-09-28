//#region "DotPath" Type Helper

//#region @source: https://stackoverflow.com/a/58436959/4295410

type Prev = [
  never,
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  16,
  17,
  18,
  19,
  20,
  ...0[]
];

type Join<K, P> = K extends string | number
  ? P extends string | number
    ? `${K}${"" extends P ? "" : "."}${P}`
    : never
  : never;

type Paths<T, D extends number = 10> = [D] extends [never]
  ? never
  : T extends object
  ? {
      [K in keyof T]-?: K extends string | number
        ? `${K}` | Join<K, Paths<T[K], Prev[D]>>
        : never;
    }[keyof T]
  : "";

type Leaves<T, D extends number = 10> = [D] extends [never]
  ? never
  : T extends object
  ? { [K in keyof T]-?: Join<K, Leaves<T[K], Prev[D]>> }[keyof T]
  : "";

// #endregion

export type AtPath<TPath extends string, TIn> = TPath extends keyof TIn
  ? TIn[TPath]
  : TPath extends `${infer THead}.${infer TTail}`
  ? THead extends keyof TIn
    ? AtPath<TTail, TIn[THead]>
    : never
  : never;

// #endregion

//#region SurrealDB Model Types

export type SDBNull = null;
export type SDBBoolean = boolean;
export type SDBString = string;
export type SDBNumber = number;

export type SDBUuidChar = number | string; // TODO
export type SDBUuidChar4 =
  `${SDBUuidChar}${SDBUuidChar}${SDBUuidChar}${SDBUuidChar}`;
export type SDBUuidChar8 = `${SDBUuidChar4}${SDBUuidChar4}`;
export type SDBUuidChar12 = `${SDBUuidChar8}${SDBUuidChar4}`;
export type SDBUuid =
  `${SDBUuidChar8}-${SDBUuidChar4}-${SDBUuidChar4}-${SDBUuidChar4}-${SDBUuidChar12}`;

export type SDBDate = `${number}-${number}${number}-${number}${number}`; // TODO
export type SDBTime = string; // TODO
export type SDBGeometrie = any; // TODO

export type SDBRecordLink<TRecord> = any; // TODO

// TODO Futures
// TODO Casting

export type SDBPrimitive =
  | SDBNull
  | SDBBoolean
  | SDBString
  | SDBNumber
  | SDBUuid
  | SDBDate
  | SDBTime
  | SDBGeometrie
  | SDBRecordLink<unknown>;

export type SDBArray = SDBValue[];
export type SDBObject = {
  [field: string | number]: SDBValue;
};
export type SDBValue = SDBPrimitive | SDBObject | SDBArray;

export type SDBRecord = SDBValue;

export type SDBTable = SDBRecord[];

export type SDBDatabase = {
  [table: string | number]: SDBTable;
};

export type SDBNamespace = {
  [database: string | number]: SDBDatabase;
};

export type SDBModel<
  T extends {
    [namespaces: string | number]: SDBNamespace;
  }
> = T;

// #endregion

//#region SurrealDB Model Reflections

type NamespaceFor<TModel extends SDBModel<any>> = keyof TModel;

type DatabaseFor<
  TModel extends SDBModel<any>,
  TNamespace extends NamespaceFor<TModel>
> = keyof TModel[TNamespace];

type TableFor<
  TModel extends SDBModel<any>,
  TNamespace extends NamespaceFor<TModel>,
  TDatabase extends DatabaseFor<TModel, TNamespace>
> = keyof TModel[TNamespace][TDatabase];

type Target<
  TModel,
  TNamespace extends NamespaceFor<TModel>,
  TDatabase extends DatabaseFor<TModel, TNamespace>
> = TableFor<TModel, TNamespace, TDatabase>;

type Projection<
  TModel,
  TNamespace extends NamespaceFor<TModel>,
  TDatabase extends DatabaseFor<TModel, TNamespace>,
  TTargets extends Target<TModel, TNamespace, TDatabase>[]
> = TTargets extends (infer T)[]
  ? T extends keyof TModel[TNamespace][TDatabase]
    ? Paths<
        TModel[TNamespace][TDatabase][T][keyof TModel[TNamespace][TDatabase][T]]
      >
    : never
  : never;

type ResultFor<
  TModel,
  TNamespace extends NamespaceFor<TModel>,
  TDatabase extends DatabaseFor<TModel, TNamespace>,
  TTargets extends Target<TModel, TNamespace, TDatabase>[],
  TProjections extends Projection<TModel, TNamespace, TDatabase, TTargets>[]
> = TProjections extends (infer T extends string)[]
  ? {
      [TKey in T]: AtPath<
        TKey,
        TModel[TNamespace][TDatabase][TTargets[number]][any]
      >;
    }[]
  : never;

// #endregion

/**
 * A first start to generate SurrealQL SELECT statements for a SurrealDB Model
 */
class QueryBuilder<TModel extends SDBModel<any>> {
  FROM<
    TNamespace extends NamespaceFor<TModel>,
    TDatabase extends DatabaseFor<TModel, TNamespace>,
    TTargets extends Target<TModel, TNamespace, TDatabase>[],
    TProjections extends Projection<TModel, TNamespace, TDatabase, TTargets>[]
  >(...targets: TTargets) {
    const targetsString: string = targets.map((e) => e.toString()).join(", ");

    return {
      SELECT: <T extends TProjections>(...projections: T) => {
        const projectionsString =
          // cast to stop TS compiler from excessively deep parsing
          (projections as unknown as { toString: () => string }[])
            .map((e) => e.toString())
            .join(", ");

        return {
          execute: (): ResultFor<
            TModel,
            TNamespace,
            TDatabase,
            TTargets,
            T
          > => {
            // TODO
            return null as any;
          },
          toString: () => {
            return `SELECT ${projectionsString} FROM ${targetsString};`;
          },
        };
      },
    };
  }
}

//#region Example usage

type ExampleModel = SDBModel<{
  exampleNamespace: {
    exampleDatabase: {
      exampleTable: {
        exampleField: SDBString;
        exampleField2: SDBUuid;
      }[];
      exampleTable2: {
        exampleField: {
          exampleDeepProp: SDBString;
          exampleDeepProp2: SDBString;
        };
        exampleFieldX: SDBUuid;
      }[];
      exampleTable3: {
        anotherField: 123;
      }[];
    };
  };
}>;

const exampleReverse = new QueryBuilder<ExampleModel>()
  .FROM("exampleTable2")
  .SELECT("exampleField.exampleDeepProp", "exampleFieldX")
  .execute();

// #endregion
