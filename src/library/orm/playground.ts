import { Surreal } from "../../surreal.ts";
import { ORM } from "./orm.ts";
import * as schema from "./schema.ts";
import * as t from "./types.ts";
import { or, fy, eq } from "./filters.ts";
import { containsAny } from "./filters.ts";
import * as graph from "./graph.ts";
import { idiom } from "./idiom.ts";
import { RecordId } from "../data/recordid.ts";
import { z } from "./types.ts";
import { inferZodTypes } from "./schema.ts";

const post = schema.table("post", {
	title: t.string(),
	content: t.string(),
	tags: t.tuple([z.string(), z.number()])
});

const person = schema.table("person", {
	name: t.string(),
});

const friends_with = schema.table("friends_with", {
	in: t.recordId('person'),
	out: t.recordId('person'),
});

const authored = schema.table("authored", {
	in: t.recordId('person'),
	out: t.recordId('post'),
});

const surreal = new Surreal();
const db = new ORM(surreal, {
	post,
	person,
	friends_with,
	authored,
});

const { fy, eq, to, from } = db.utils();

fy

type a = inferZodTypes<typeof post>
const b = {} as {
	[F in keyof a]: a[F];
};

const c = z.object(b).parse({});

const d = c.id;


const _test1 = db.select('person').validator().parse({});
const _test2 = await db.select('person').where(eq(person.name, 'something'))

function getAuthorAndPosts(
	author: RecordId<'person'>,
	{
		title,
		content,
		tags,
	}: Partial<Pick<schema.infer<typeof post>, "title" | "content" | "tags">> = {}
) {
	return db
		.select('person')
		.where(({ eq }) => eq('id', ...))
		.sideEffect(
			'posts',
			idiom(
				graph.to(post),
				graph.to(authored),
				graph.to(post),
				or(
					title && fy(post.title, title),
					content && fy(post.content, content),
					tags && containsAny(post.tags, tags)
				)
			)
		);
}

const _posts = getAuthorAndPosts(
	new RecordId('person', 'john'),
	{
		content: 'bla'
	}
)

type posts = (typeof _posts)['infer'];

const _z = schema.getTableZodType(post).parse({});
const _z2 = _posts.validator().parse({});
const _z3 = await _posts;
const _z4 = await _posts.execute();


// const rid = db.recordId('person', 'john');

// const _sicko = {
// 	awaited: await rid,
// 	tb: rid.tb,
// 	id: rid.id,
// }


const a = t.recordId('test');
console.log(JSON.stringify(a));
