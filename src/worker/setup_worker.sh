#!/bin/bash
set -euf -o pipefail

# Plain realpath doesn't work on MacOS with non-existing files
abspath() {
  if [ -d "$1" ]
  then
    realpath "$1"
  else
    echo "$(realpath "$(dirname -- "$1")")/$(basename -- "$1")"
  fi
}

check_deps() {
  if ! command -v docker &>/dev/null
  then
    echo "Docker is not installed. Please install it and try again."
    exit 1
  fi
  if ! command -v curl &>/dev/null
  then
    echo "Curl is not installed. Please install it and try again."
    exit 1
  fi
}

BOLD=$(tput bold)
NORMAL=$(tput sgr0)

declare -A RPC_URL
declare -A L1_RPC_URL
RPC_URL["tethys"]=https://sepolia-rollup.arbitrum.io/rpc
L1_RPC_URL["tethys"]=https://eth-sepolia.public.blastapi.io
RPC_URL["mainnet"]=https://arb1.arbitrum.io/rpc
L1_RPC_URL["mainnet"]=https://eth-mainnet.public.blastapi.io


if [ "$#" -ne 2 ]
then
  echo "Usage: $0 <DATA_DIR> <KEY_PATH>"
  exit 1
fi

check_deps

DATA_DIR=$(abspath "$1")
KEY_PATH=$(abspath "$2")
NETWORK=${NETWORK:-mainnet}

if [ -d "$DATA_DIR" ]
then
  echo "The provided data directory ($DATA_DIR) already exists. Any data inside of it may be lost."
fi
mkdir -pv "$DATA_DIR"

if [ -f "$KEY_PATH" ]
then
  echo "Using existing key file"
else
  echo "Generating a new key file in '${KEY_PATH}'."
  echo "${BOLD}Please make sure to back up the key file in a secure location.${NORMAL}"
fi
PEER_ID=$(docker run -q -u "$(id -u):$(id -g)" -v "$(dirname "${KEY_PATH}"):/host" subsquid/keygen:tethys "/host/$(basename "${KEY_PATH}")")

read -r -p "Provide the UDP port to listen on (default: 12345): " LISTEN_PORT
LISTEN_PORT=${LISTEN_PORT:-12345}
if ! [[ $LISTEN_PORT =~ ^[0-9]+$ ]] || [ "$LISTEN_PORT" -lt 1 ] || [ "$LISTEN_PORT" -gt 65535 ]
then
  echo "Invalid port number"
  exit 1
fi

read -r -p "Provide your public IP address (optional): " PUBLIC_IP
if [ -n "$PUBLIC_IP" ]
then
  PUBLIC_ADDR=/ip4/${PUBLIC_IP}/udp/${LISTEN_PORT}/quic-v1
fi

# Write the configuration parameters to a file
cat <<EOF > .env
DATA_DIR=${DATA_DIR}
KEY_PATH=${KEY_PATH}
# UDP port used for P2P connections
LISTEN_PORT=${LISTEN_PORT}
PROMETHEUS_PORT=9090
NETWORK=${NETWORK}
# RPC node of the Arbitrum network
RPC_URL=${RPC_URL[${NETWORK}]}
# RPC node of the Ethereum network
L1_RPC_URL=${L1_RPC_URL[${NETWORK}]}
# The number of chunks downloaded in paralel.
# You can increase this number if you have a good internet connection.
CONCURRENT_DOWNLOADS=3
# Timeout for downloading a single file.
# Increase it if you have the "operation timed out" errors in the logs.
S3_TIMEOUT=60
# Read timeout. The connection is dropped if no data has arrived for this time.
S3_READ_TIMEOUT=30
# You can set it to "info,sqd_worker=debug" to get debug logs
RUST_LOG=info

# You probably shouldn't change the values below
UID=$(id -u)
GID=$(id -g)
P2P_PUBLIC_ADDRS=${PUBLIC_ADDR:-}
EOF

echo "Config saved to '.env'"

echo "Downloading docker-compose.yaml"
curl -sSf -O "https://cdn.subsquid.io/worker/docker-compose.yaml"

echo "Your peer ID is: ${BOLD}${PEER_ID}${NORMAL}. Now you can register it on chain."
