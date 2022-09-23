TEST_SPACE=$1
WORKING_DIR=$(dirname "$0")
CONTAINER_NAME="surrealdb-js-e2e"
DATA_PATH="${PWD}/.test_data/$CONTAINER_NAME/$TEST_SPACE"

echo "
## re-/starting test container
"

echo "using 
  TEST_SPACE=$TEST_SPACE
  WORKING_DIR=$WORKING_DIR
  CONTAINER_NAME=$CONTAINER_NAME
  DATA_PATH=$DATA_PATH
"

if [ -d "$DATA_PATH" ]; then
  echo "previous test dump found - removing '$DATA_PATH'..."
  rm -rf "$DATA_PATH"
fi


echo "checking if docker deamon is running"

if (! docker stats --no-stream ); then
  echo "Please start the  docker daemon"
  exit 1
fi

echo "checking for current docker container"

if docker ps --filter "name=$CONTAINER_NAME" | grep $CONTAINER_NAME; then
    echo "container already running, stopping container..."
    docker stop $CONTAINER_NAME
fi

if docker container ls -a --filter "name=$CONTAINER_NAME" | grep $CONTAINER_NAME; then
    echo "container already exists, removing container..."
    docker rm $CONTAINER_NAME
fi

echo "starting container..."
docker run -d -v $DATA_PATH:/data --name $CONTAINER_NAME -p 8000:8000 surrealdb/surrealdb:latest start --user root --pass root -- "file://data"

echo "
## re-/started test container
"
