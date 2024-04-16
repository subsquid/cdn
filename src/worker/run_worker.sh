#!/usr/bin/env sh

docker compose --version >/dev/null || (echo "Docker compose not installed"; exit 1)

if [ ! -d "$1" ]
then
  echo "Provided data directory ($1) does not exist. Usage: $0 <DATA_DIR> <DOCKER_COMPOSE_ARGS>"
  exit 1
fi

if [ -n "$PUBLIC_IP" ]
then
  PUBLIC_ADDR=/ip4/${PUBLIC_IP}/udp/${LISTEN_PORT:-12345}/quic-v1
fi

if [ -z "$PUBLIC_ADDR" ]
then
  echo "Warning: public address not provided (use PUBLIC_IP=x.x.x.x or PUBLIC_ADDR=/ip4/x.x.x.x/udp/xxxx/quic-v1)"
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
    image: subsquid/p2p-worker:0.3.2
    restart: unless-stopped
    command: p2p
    environment:
      DATA_DIR: /app/data
      AWS_ACCESS_KEY_ID: 66dfc7705583f6fd9520947ac10d7e9f
      AWS_SECRET_ACCESS_KEY: a68fdd7253232e30720a4c125f35a81bd495664a154b1643b5f5d4a4a5280a4f
      AWS_S3_ENDPOINT: https://7a28e49ec5f4a60c66f216392792ac38.r2.cloudflarestorage.com
      CONCURRENT_DOWNLOADS: 3
      S3_TIMEOUT: 120
      RPC_URL: ${RPC_URL:-https://sepolia-rollup.arbitrum.io/rpc}
      L1_RPC_URL: https://rpc.sepolia.org
      SCHEDULER_ID: 12D3KooWQER7HEpwsvqSzqzaiV36d3Bn6DZrnwEunnzS76pgZkMU
      LOGS_COLLECTOR_ID: 12D3KooWC3GvQVqnvPwWz23sTW8G8HVokMnox62A7mnL9wwaSujk
      P2P_LISTEN_ADDRS: /ip4/0.0.0.0/udp/${LISTEN_PORT:-12345}/quic-v1
      P2P_PUBLIC_ADDRS: ${PUBLIC_ADDR}
      BOOT_NODES: >
        12D3KooWSRvKpvNbsrGbLXGFZV7GYdcrYNh4W2nipwHHMYikzV58 /dns4/testnet.subsquid.io/udp/22445/quic-v1,
        12D3KooWQC9tPzj2ShLn39RFHS5SGbvbP2pEd7bJ61kSW2LwxGSB /dns4/testnet.subsquid.io/udp/22446/quic-v1
      GATEWAY_REGISTRY_CONTRACT_ADDR: 0xC52D401Cf4101e6b20F6F7D51c67f5B1dF9559af
      WORKER_REGISTRATION_CONTRACT_ADDR: 0xCD8e983F8c4202B0085825Cf21833927D1e2b6Dc
      NETWORK_CONTROLLER_CONTRACT_ADDR: 0x68Fc7E375945d8C8dFb0050c337Ff09E962D976D
      ALLOCATIONS_VIEWER_CONTRACT_ADDR: 0xEf55fB580dc7CA408a725b53F270277E81C1442f
      KEY_PATH: /app/configs/key
      RUST_LOG: "info"
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

