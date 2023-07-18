WORKING_DIR=$(dirname "$0")

echo " "
echo "-----------------------------------------"
echo "Starting surrealdb.js E2E tests"
date
echo "-----------------------------------------"
echo " "

echo "Building"
echo "-----------------------------------------"
deno task build

sh $WORKING_DIR/docker-restart.sh
if [ $? -eq 1 ]; then
	exit 1;
fi

echo " "
echo "Running deno tests"
echo "-----------------------------------------"
deno test -A --trace-ops ./test/e2e/deno.js

echo " "
echo "Running node.js tests"
echo "-----------------------------------------"
node ./test/e2e/node.js

echo " "
echo "Running bun tests"
echo "-----------------------------------------"
bun run ./test/e2e/bun.js

sh $WORKING_DIR/docker-stop.sh

echo " "
echo "-----------------------------------------"
echo "Finished surrealdb.js E2E tests"
date
echo "-----------------------------------------"
echo " "
