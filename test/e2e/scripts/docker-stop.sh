WORKING_DIR=$(dirname "$0")
CONTAINER_NAME="surrealdb-js-e2e"
DATA_PATH="${PWD}/.test_data/$CONTAINER_NAME"

echo " "
echo "Stopping SurrealDB container"
echo "-----------------------------------------"
echo "WORKING_DIR=$WORKING_DIR"
echo "CONTAINER_NAME=$CONTAINER_NAME"
echo "DATA_PATH=$DATA_PATH"
echo "-----------------------------------------"
echo " "

docker stop "$CONTAINER_NAME"
echo "Removing container"
docker rm "$CONTAINER_NAME"

echo " "
echo "Container is down!"
