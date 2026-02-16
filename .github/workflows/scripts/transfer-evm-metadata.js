#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const yaml = require('js-yaml');

const OVERWRITE_FLAG = '--overwrite';

const EVM_JSON_PATH = path.join(process.cwd(), 'src/archives/evm.json');
const METADATA_YAML_PATH = path.join(process.cwd(), 'src/sqd-network/mainnet/metadata.tentative.yml');

function shouldSet(value, overwrite) {
  return overwrite || value === undefined || value === null;
}

function loadEvmArchives() {
  const raw = fs.readFileSync(EVM_JSON_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  assert(Array.isArray(parsed.archives), `${EVM_JSON_PATH} must contain an "archives" array`);
  return parsed.archives;
}

function loadMetadata() {
  const raw = fs.readFileSync(METADATA_YAML_PATH, 'utf8');
  const parsed = yaml.load(raw);
  assert(parsed && typeof parsed === 'object', `${METADATA_YAML_PATH} must be a YAML object`);
  assert(parsed.datasets && typeof parsed.datasets === 'object' && !Array.isArray(parsed.datasets), `${METADATA_YAML_PATH} must contain a "datasets" object`);
  return parsed;
}

function transferArchive(archive, datasets, overwrite) {
  assert(archive && typeof archive === 'object', 'archive entry must be an object');
  assert(typeof archive.id === 'string' && archive.id.length > 0, 'archive.id must be a non-empty string');

  const id = archive.id;
  const dataset = datasets[id] || {};
  const evm = (dataset.evm && typeof dataset.evm === 'object') ? dataset.evm : {};

  if (shouldSet(dataset.display_name, overwrite)) {
    dataset.display_name = archive.chainName;
  }

  if (shouldSet(dataset.logo_url, overwrite)) {
    dataset.logo_url = archive.logoUrl;
  }

  if (shouldSet(dataset.type, overwrite)) {
    dataset.type = archive.isTestnet === false ? 'mainnet' : 'testnet';
  }

  if (shouldSet(evm.chain_id, overwrite)) {
    evm.chain_id = archive.chainId;
  }

  dataset.kind = 'evm';
  dataset.evm = evm;
  datasets[id] = dataset;
}

function saveMetadata(metadata) {
  const output = yaml.dump(metadata, {
    noRefs: true,
    lineWidth: -1,
  });
  fs.writeFileSync(METADATA_YAML_PATH, output, 'utf8');
}

function main() {
  const args = process.argv.slice(2);
  const overwrite = args.includes(OVERWRITE_FLAG);
  const unknownArgs = args.filter((arg) => arg !== OVERWRITE_FLAG);
  assert(unknownArgs.length === 0, `Unknown arguments: ${unknownArgs.join(', ')}. Supported flag: ${OVERWRITE_FLAG}`);

  const archives = loadEvmArchives();
  const metadata = loadMetadata();

  for (const archive of archives) {
    transferArchive(archive, metadata.datasets, overwrite);
  }

  saveMetadata(metadata);
}

main();
