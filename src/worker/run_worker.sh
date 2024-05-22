#!/usr/bin/env sh

docker compose --version >/dev/null || (echo "Docker compose not installed"; exit 1)

if [ ! -d "$1" ]
then
  echo "Provided data directory ($1) does not exist. Usage: $0 <DATA_DIR> <DOCKER_COMPOSE_ARGS>"
  exit 1
fi


# Get absolute path
DATA_DIR="$(cd "$(dirname -- "$1")" >/dev/null; pwd -P)/$(basename -- "$1")"
echo "Using data dir $DATA_DIR"
shift

export USER_ID=$(id -u)
export GROUP_ID=$(id -g)

cat <<EOF > docker-compose.yml
version: "3.8"

services:
  worker:
    image: subsquid/p2p-worker:1.0.0-rc2
    restart: unless-stopped
    command: p2p
    environment:
      DATA_DIR: /app/data
      CONCURRENT_DOWNLOADS: 3
      S3_TIMEOUT: 60
      RPC_URL: ${RPC_URL:-https://sepolia-rollup.arbitrum.io/rpc}
      L1_RPC_URL: https://rpc.sepolia.org
      SCHEDULER_ID: 12D3KooWQER7HEpwsvqSzqzaiV36d3Bn6DZrnwEunnzS76pgZkMU
      LOGS_COLLECTOR_ID: 12D3KooWC3GvQVqnvPwWz23sTW8G8HVokMnox62A7mnL9wwaSujk
      P2P_LISTEN_ADDRS: /ip4/0.0.0.0/udp/${LISTEN_PORT:-12345}/quic-v1
      BOOT_NODES: >
        12D3KooWSRvKpvNbsrGbLXGFZV7GYdcrYNh4W2nipwHHMYikzV58 /dns4/testnet.subsquid.io/udp/22445/quic-v1,
        12D3KooWQC9tPzj2ShLn39RFHS5SGbvbP2pEd7bJ61kSW2LwxGSB /dns4/testnet.subsquid.io/udp/22446/quic-v1
      NETWORK: tethys
      KEY_PATH: /app/configs/key
      RUST_LOG: "info"
      SENTRY_DSN: https://f97ffef7e96eb533d4c527ce62e4cfbf@o1149243.ingest.us.sentry.io/4507056936779776
    volumes:
      - ${DATA_DIR}:/app/data
      - .:/app/configs
    ports:
      - "${PROMETHEUS_PORT:-9090}:8000"
      - "${LISTEN_PORT:-12345}:${LISTEN_PORT:-12345}/udp"
    user: "${USER_ID}:${GROUP_ID}"
    deploy:
      resources:
        limits:
          memory: 16G
EOF

exec docker compose "$@"

