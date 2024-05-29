#!/bin/bash
set -euf -o pipefail

BOLD=$(tput bold)
NORMAL=$(tput sgr0)

if [ "$#" -ne 2 ]
then
  echo "Usage: $0 <DATA_DIR> <KEY_PATH>"
  exit 1
fi

# Plain realpath doesn't work on MacOS with non-existing files
abspath() {
  if [ -d "$1" ]
  then
    realpath "$1"
  else
    echo "$(realpath "$(dirname -- "$1")")/$(basename -- "$1")"
  fi
}

DATA_DIR=$(abspath "$1")
KEY_PATH=$(abspath "$2")

if [ -d "$DATA_DIR" ]
then
  echo "Provided data directory ($DATA_DIR) already exists, please use a new one"
  exit 1
fi
mkdir -pv "$DATA_DIR"

if [ -f "$KEY_PATH" ]
then
  echo "Using existing key file"
else
  echo "Generating a new key file in '${KEY_PATH}'."
  echo "${BOLD}Please make sure to back up the key file in a secure location.${NORMAL}"
fi
PEER_ID=$(docker run -u "$(id -u):$(id -g)" -v "$(dirname "${KEY_PATH}"):/host" subsquid/keygen:tethys "/host/$(basename "${KEY_PATH}")")

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
LISTEN_PORT=${LISTEN_PORT}
PROMETHEUS_PORT=
PUBLIC_ADDR=${PUBLIC_ADDR:-}
RPC_URL=
L1_RPC_URL=
UID=$(id -u)
GID=$(id -g)
EOF


echo "Config saved to '.env'"
echo "Your peer ID is: ${BOLD}${PEER_ID}${NORMAL}. Now you can register it on chain."