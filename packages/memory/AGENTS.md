# Agent Memory instructions

## Regenerating API types

`spec/openapi.json` is a vendored copy of `doc/spec/enduser.swagger.json` on
`main` in [surrealdb/spectron](https://github.com/surrealdb/spectron). To sync
it, replace the file, run `bunx biome format --write spec/openapi.json` to match
the repo's formatting, then `bun run generate` in this package, then
`bun run build`.

Two things the copy does not take verbatim:

- Upstream writes some `context_id` parameter descriptions as "Spectron context
  id". The vendored copy says "Agent Memory context id", which is what upstream
  itself uses on most routes.
- `X-Spectron-On-Behalf-Of` stays as written. It is a wire constant, not
  branding: the service matches the header name exactly and its CORS allowlist
  carries only that spelling.
