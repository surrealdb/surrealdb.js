type BasePatch<T = string> = {
    path: T;
};

export type AddPatch<T = string, U = unknown> = BasePatch<T> & {
    op: "add";
    value: U;
};

export type RemovePatch<T = string> = BasePatch<T> & {
    op: "remove";
};

export type ReplacePatch<T = string, U = unknown> = BasePatch<T> & {
    op: "replace";
    value: U;
};

export type ChangePatch<T = string, U = string> = BasePatch<T> & {
    op: "change";
    value: U;
};

export type CopyPatch<T = string, U = string> = BasePatch<T> & {
    op: "copy";
    from: U;
};

export type MovePatch<T = string, U = string> = BasePatch<T> & {
    op: "move";
    from: U;
};

export type TestPatch<T = string, U = unknown> = BasePatch<T> & {
    op: "test";
    value: U;
};

export type Patch =
    | AddPatch
    | RemovePatch
    | ReplacePatch
    | ChangePatch
    | CopyPatch
    | MovePatch
    | TestPatch;
