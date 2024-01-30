# Fetching sideeffects
When adding sideeffects to a select statement such as retrieving graph edges, we don't want this to influence fetching the document itself, as the document needs to align with schema, as to not introduce inconsistencies into cache.

An easy way to do this is to fetch the document and sideeffects separated from eachother, both in the same iteration.

```sql
SELECT VALUE {
	document: $this,
	side_effects: {
		friends: ->friends_with->person
	}
} FROM test
  WHERE ...
```
