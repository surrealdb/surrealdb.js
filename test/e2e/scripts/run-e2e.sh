WORKING_DIR=$(dirname "$0")

echo "
####### ####### ####### ############## ####### ####### #######
                     starting e2e tests
####### ####### ####### ############## ####### ####### #######
" &&
date &&

echo "
####### ####### ####### #######
build
####### ####### ####### #######
" &&
npm run build &&

echo "
####### ####### ####### #######
Deno
####### ####### ####### #######
" &&
echo "Start surrealdb" &&
sh $WORKING_DIR/docker-restart.sh deno &&
echo "Run Deno" &&
deno run -A ./test/e2e/deno.js &&
echo "Get DB Dump" &&
sh $WORKING_DIR/docker-stop.sh deno &&
echo "Check DENO-Dump" &&
deno run -A $WORKING_DIR/compare-dump.js &&
echo "
####### ####### ####### #######
Node
####### ####### ####### #######
"
echo "Start surrealdb" &&
sh $WORKING_DIR/docker-restart.sh node &&
echo "Run Node" &&
node ./test/e2e/node.js &&
echo "Get DB Dump" &&
sh $WORKING_DIR/docker-stop.sh node &&
echo "Check Node-Dump" &&
deno run -A $WORKING_DIR/compare-dump.js &&
# echo "
# ####### ####### #######
# Bun
# ####### ####### #######
#"
# TODO
# echo "Start surrealdb" &&
# sh $WORKING_DIR/docker-restart.sh bun &&
# echo "Run Bun" &&
# bun run ./test/e2e/bun.js &&
# echo "Get DB Dump" &&
# sh $WORKING_DIR/docker-stop.sh bun &&
# echo "Check Bun-Dump" &&
# deno run -A $WORKING_DIR/compare-dump.js &&
echo "" &&
date &&
echo "
####### ####### ####### ############## ####### ####### #######
                      finished e2e tests
####### ####### ####### ############## ####### ####### #######
"
