import { build, emptyDir } from "https://deno.land/x/dnt/mod.ts";
import { version } from "./project.json" assert { type: "json" };

await emptyDir("./npm");

// Add isomorphic-ws
const socketCode = Deno.readTextFileSync('./src/classes/socket.ts')
Deno.writeTextFileSync('./src/classes/socket.ts', 'import WebSocket from "isomorphic-ws"\n' + socketCode)

let err;

try {
  await build({
    entryPoints: ["./src/index.ts"],
    outDir: "./npm",
    shims: {
      // see JS docs for overview and more options
      deno: false,
      webSocket: false
    },
    package: {
      // package.json properties
      name: "surrealdb.js",
      version: version,
      description: "Javascript driver for SurrealDB",
      license: "Apache 2.0",
      repository: {
        type: "git",
        url: "https://github.com/surrealdb/surrealdb.js.git"
      },
      author: {
        name: "Tobie Morgan Hitchcock",
        url: "https://surrealdb.com"
      },
      dependencies: {
        "isomorphic-ws": "^5.0.0",
        "ws": "^8.8.1"
      },
      devDependencies: {
        "@types/ws": "8.5.3"
      }
    },
  });  

  // post build steps
  Deno.copyFileSync("LICENSE", "npm/LICENSE");
  Deno.copyFileSync("README.md", "npm/README.md");
} catch (ex) {
  err = ex
}

// remove isomorphic-ws
Deno.writeTextFileSync('./src/classes/socket.ts', socketCode)

if(err) throw err;