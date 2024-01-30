import { Surreal } from "../../surreal.ts";
import { ORM } from "./builder/builder.ts";
import * as schema from "./schema.ts";
import * as t from "./types.ts";
import { or, fy } from "./filters.ts";
import { containsAny } from "./filters.ts";
import * as graph from "./graph.ts";
import { idiom } from "./idiom.ts";
import { RecordId } from "../data/recordid.ts";
import { z } from "./types.ts";

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

function getPostsFromAuthor(
	author: RecordId<'person'>,
	{
		title,
		content,
		tags,
	}: Partial<Pick<schema.infer<typeof post>, "title" | "content" | "tags">> = {}
) {
	return db
		.select('person', author.id)
		.sideEffect(
			'posts',
			idiom(
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

const _posts = await getPostsFromAuthor(
	new RecordId('person', 'john'),
	{
		content: 'bla'
	}
)
