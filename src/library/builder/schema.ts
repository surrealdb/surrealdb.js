import { z } from "npm:zod@^3.22.4";

class SurrealQLString {
	constructor(v: unknown) {
		return z.string().parse(v);
	}
}

class SurrealQLNumber {
	constructor(v: unknown) {
		return z.string().parse(v);
	}
}

const mapped = {
	string: SurrealQLString,
	number: SurrealQLNumber,
}

type TFields = {
	[K: string]: (typeof mapped)[keyof typeof mapped]
}

class Table<Name extends string, Fields extends TFields> {
	name: Name;
	fields: TFields = {};

	constructor(name: Name) {
		this.name = name;
	}

	addField<FieldName extends string, FieldType extends keyof typeof mapped>(name: FieldName, type: FieldType) {
		this.fields[name] = mapped[type];
		type New = Fields & {
			[K in Name]: (typeof mapped)[FieldType];
		};

		return this as unknown as Table<Name, {
			[K in keyof New]: New[K]
		}>
	}
}

const n = 'test' as const;

const user = new Table(n)
	.addField('name', 'string')
	.addField('age', 'number');


class Schema {

}
