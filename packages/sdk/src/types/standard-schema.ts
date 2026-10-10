/**
 * The [Standard Schema](https://standardschema.dev) interface, implemented by Zod, Valibot, ArkType
 * and other validation libraries. It is declared here as types only, so the SDK takes no
 * dependency on any of them: pass a schema from the library you already use.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
    readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

export declare namespace StandardSchemaV1 {
    export interface Props<Input = unknown, Output = Input> {
        readonly version: 1;
        readonly vendor: string;
        readonly validate: (value: unknown) => Result<Output> | Promise<Result<Output>>;
        readonly types?: Types<Input, Output> | undefined;
    }

    export type Result<Output> = SuccessResult<Output> | FailureResult;

    export interface SuccessResult<Output> {
        readonly value: Output;
        readonly issues?: undefined;
    }

    export interface FailureResult {
        readonly issues: ReadonlyArray<Issue>;
    }

    export interface Issue {
        readonly message: string;
        readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
    }

    export interface PathSegment {
        readonly key: PropertyKey;
    }

    export interface Types<Input = unknown, Output = Input> {
        readonly input: Input;
        readonly output: Output;
    }

    export type InferInput<S extends StandardSchemaV1> = NonNullable<
        S["~standard"]["types"]
    >["input"];

    export type InferOutput<S extends StandardSchemaV1> = NonNullable<
        S["~standard"]["types"]
    >["output"];
}
