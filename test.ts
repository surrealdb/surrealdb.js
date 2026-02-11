import { satisfies } from "semver";

const is3x = satisfies("3.0.0-beta", ">=3.0.0-alpha.1");
console.log(is3x);