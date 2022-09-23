TEST_SPACE=$1
WORKING_DIR=$(dirname "$0")
CONTAINER_NAME="surrealdb-js-e2e"
DATA_PATH="${PWD}/.test_data/$CONTAINER_NAME/$TEST_SPACE"

echo "
## stopping test container
"

echo "using 
  TEST_SPACE=$TEST_SPACE
  WORKING_DIR=$WORKING_DIR
  CONTAINER_NAME=$CONTAINER_NAME
  DATA_PATH=$DATA_PATH
"

echo "
exporting test container data
"
docker run --rm --net="host" -v $DATA_PATH:/data surrealdb/surrealdb:latest export -c http://127.0.0.1:8000 --user root --pass root --ns test --db test -- "/data/export.sql" &&
echo "
exported test container data
"

echo "
container teardown
" &&
echo "stopping container" &&
docker stop "$CONTAINER_NAME" &&
echo "removing container" &&
docker rm "$CONTAINER_NAME" &&

echo "
## stopped test container
"
