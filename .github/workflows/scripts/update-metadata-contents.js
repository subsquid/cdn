#!/usr/bin/env node
/**
 * Update EVM dataset schema in metadata.yml from portal.sqd.dev.
 *
 * Step 1: Fetch all dataset names from portal.sqd.dev.
 * Step 2: Verify all portal datasets have a matching key in metadata YAML.
 *         If any are missing, write to missing-networks.txt and exit 1.
 * Step 3: Detect EVM datasets among the portal datasets.
 * Step 4: Probe capabilities for each EVM dataset and update schema.
 *
 * By default only probes datasets whose schema is entirely empty (no keys).
 * Use --full-update to re-probe all datasets.
 *
 * Usage: node .github/workflows/scripts/update-metadata-contents.js [--full-update]
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const yaml = require('js-yaml');

const METADATA_YAML_PATH = path.join(process.cwd(), 'src/sqd-network/mainnet/metadata.yml');
const PORTAL_BASE = 'https://portal.sqd.dev/datasets';
const REQUEST_TIMEOUT_MS = 15_000;
const DATASET_BATCH_SIZE = Number(process.env.PORTAL_DATASET_BATCH_SIZE || 20);
const CAPABILITY_BATCH_SIZE = Number(process.env.PORTAL_CAPABILITY_BATCH_SIZE || 20);
const MAX_429_RETRIES = Number(process.env.PORTAL_MAX_429_RETRIES || 6);
const DEFAULT_429_DELAY_MS = Number(process.env.PORTAL_DEFAULT_429_DELAY_MS || 1_000);

// Everything that should be checked on top of EVM transactions
const EXTRA_CAPABILITIES = ['logs', 'traces', 'stateDiffs'];

const CAPABILITY_TO_SCHEMA = {
  transactions: 'transactions',
  logs: 'logs',
  traces: 'traces',
  stateDiffs: 'state_diffs',
  blocks: 'blocks',
};

// ---------------------------------------------------------------------------
// YAML I/O
// ---------------------------------------------------------------------------

function loadMetadata() {
  const raw = fs.readFileSync(METADATA_YAML_PATH, 'utf8');
  const parsed = yaml.load(raw);
  assert(parsed && typeof parsed === 'object', `${METADATA_YAML_PATH} must be a YAML object`);
  assert(parsed.datasets && typeof parsed.datasets === 'object', `${METADATA_YAML_PATH} must contain a "datasets" object`);
  return parsed;
}

function saveMetadata(metadata) {
  const output = yaml.dump(metadata, { noRefs: true, lineWidth: -1 });
  fs.writeFileSync(METADATA_YAML_PATH, output, 'utf8');
}

function getEvmDatasetIds(metadata) {
  return Object.entries(metadata.datasets)
    .filter(([, v]) => v && v.metadata && v.metadata.kind === 'evm')
    .map(([k]) => k);
}

// ---------------------------------------------------------------------------
// HTTP helpers  (mirrors update-evm-archives.js)
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterHeaderMs(value) {
  if (!value) return null;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) return asNumber * 1000;
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    const delay = dateMs - Date.now();
    return delay > 0 ? delay : 0;
  }
  return null;
}

async function fetchWith429Retry(url, options = {}) {
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...options,
    });
    if (res.status !== 429) return res;

    const bodyText = await res.text();
    if (attempt === MAX_429_RETRIES) {
      throw new Error(`HTTP 429 from ${url} after ${MAX_429_RETRIES + 1} attempts. Body: ${bodyText.slice(0, 500)}`);
    }

    let retryAfterMs = parseRetryAfterHeaderMs(res.headers.get('retry-after'));
    if (retryAfterMs < 1000) {
      console.warn(`Parsing header ${res.headers.get('retry-after')} yielded a delay of ${retryAfterMs}ms (below 1s)`);
    }
    const delayMs = Math.max(1000, retryAfterMs ?? DEFAULT_429_DELAY_MS * (attempt + 1));
    console.warn(`429 from ${url}; retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_429_RETRIES + 1})`);
    await sleep(delayMs);
  }
  throw new Error(`Unreachable retry path for ${url}`);
}

async function fetchJson(url, options = {}) {
  const res = await fetchWith429Retry(url, {
    headers: { Accept: 'application/json', ...options.headers },
    ...options,
  });
  if (res.status === 404) return null;
  const text = await res.text();
  if (!res.ok) return { _status: res.status, _body: text };
  if (!text || text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

async function mapInBatches(items, batchSize, mapper) {
  const out = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    out.push(...await Promise.all(batch.map(mapper)));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Portal probing
// ---------------------------------------------------------------------------

async function getHead(baseUrl) {
  const head = await fetchJson(`${baseUrl}/head`);
  if (!head || head._status) return null;
  return head;
}

function buildProbeBody(block, capability, probeType = 'evm') {
  const body = {
    type: probeType,
    fromBlock: block,
    toBlock: block,
  };
  body[capability] = [{}];
  return body;
}

async function probeCapability(baseUrl, capability, block, probeType = 'evm') {
  const body = buildProbeBody(block, capability, probeType);
  const res = await fetchWith429Retry(`${baseUrl}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  return res.status === 200 || res.status === 204;
}

// ---------------------------------------------------------------------------
// Step 1 – Fetch all portal dataset names
// ---------------------------------------------------------------------------

async function loadPortalDatasetNames() {
  const portalDatasets = await fetchJson(PORTAL_BASE);
  assert(Array.isArray(portalDatasets), `Unexpected response from ${PORTAL_BASE}: expected an array`);

  const names = portalDatasets
    .map((item) => (item && typeof item === 'object' ? item.dataset : null))
    .filter((name) => typeof name === 'string' && name.length > 0);

  console.log(`Found ${names.length} datasets on portal`);
  return names;
}

// ---------------------------------------------------------------------------
// Step 2 – Check missing (all datasets, not just EVM)
// ---------------------------------------------------------------------------

function checkMissing(portalNames, metadata) {
  const yamlSet = new Set(Object.keys(metadata.datasets));
  const missing = portalNames.filter((id) => !yamlSet.has(id));
  if (missing.length > 0) {
    const outPath = path.join(process.cwd(), 'missing-networks.txt');
    fs.writeFileSync(outPath, missing.join('\n') + '\n', 'utf8');
    console.error(`Missing datasets in ${METADATA_YAML_PATH}:`);
    missing.forEach((m) => console.error('  -', m));
    process.exit(1);
  }
  console.log('Step 2 OK: all portal datasets have a matching metadata entry');
}

// ---------------------------------------------------------------------------
// Step 3 – Detect EVM datasets on portal
// ---------------------------------------------------------------------------

async function detectEvmDatasets(portalNames) {
  const evmDatasets = new Map();
  const errors = [];

  const results = await mapInBatches(portalNames, DATASET_BATCH_SIZE, async (name) => {
    try {
      const baseUrl = `${PORTAL_BASE}/${encodeURIComponent(name)}`;
      const head = await getHead(baseUrl);
      const headBlock = head && Number.isFinite(Number(head.number)) ? Number(head.number) : null;
      if (headBlock === null) return { name, isEvm: false };

      const hasTx = await probeCapability(baseUrl, 'transactions', headBlock, 'evm');
      if (!hasTx) return { name, isEvm: false };

      const hasSolana = await probeCapability(baseUrl, 'instructions', headBlock, 'solana');
      if (hasSolana) return { name, isEvm: false };

      const hasStarknet = await probeCapability(baseUrl, 'events', headBlock, 'starknet');
      if (hasStarknet) return { name, isEvm: false };

      const hasFuel = await probeCapability(baseUrl, 'receipts', headBlock, 'fuel');
      if (hasFuel) return { name, isEvm: false };

      const hasTron = await probeCapability(baseUrl, 'internalTransactions', headBlock, 'tron');
      if (hasTron) return { name, isEvm: false };

      console.log(`${name} - evm, head: ${headBlock}`);
      return { name, isEvm: true, headBlock };
    } catch (error) {
      return { name, isEvm: false, error };
    }
  });

  for (const r of results) {
    if (r.error) errors.push(`${r.name}: ${r.error.message}`);
    else if (r.isEvm) evmDatasets.set(r.name, { headBlock: r.headBlock });
  }

  if (errors.length > 0) {
    throw new Error(`Failed to classify ${errors.length} dataset(s):\n${errors.slice(0, 10).join('\n')}`);
  }

  console.log(`Detected ${evmDatasets.size} EVM datasets on portal`);
  return evmDatasets;
}

// ---------------------------------------------------------------------------
// Step 4 – Probe capabilities & build schema
// ---------------------------------------------------------------------------

async function probeDatasetSchema(datasetName, headBlock) {
  const baseUrl = `${PORTAL_BASE}/${encodeURIComponent(datasetName)}`;

  const tables = {};
  tables[CAPABILITY_TO_SCHEMA.blocks] = {};
  tables[CAPABILITY_TO_SCHEMA.transactions] = {};

  for (const cap of EXTRA_CAPABILITIES) {
    if (await probeCapability(baseUrl, cap, headBlock)) {
      tables[CAPABILITY_TO_SCHEMA[cap]] = {};
    }
  }

  return { tables };
}

async function updateSchema(portalEvmDatasets, metadata, fullUpdate) {
  const evmIds = getEvmDatasetIds(metadata);
  const portalSet = new Set(portalEvmDatasets.keys());
  const onPortal = evmIds.filter((id) => portalSet.has(id));
  const toUpdate = fullUpdate
    ? onPortal
    : onPortal.filter((id) => !metadata.datasets[id].schema || !metadata.datasets[id].schema.tables);

  if (!fullUpdate) {
    const skipped = onPortal.length - toUpdate.length;
    if (skipped > 0) console.log(`Skipping ${skipped} dataset(s) that already have a schema (use --full-update to re-probe)`);
  }
  const errors = [];

  await mapInBatches(toUpdate, CAPABILITY_BATCH_SIZE, async (id) => {
    try {
      const info = portalEvmDatasets.get(id);
      const schema = await probeDatasetSchema(id, info.headBlock);
      metadata.datasets[id].schema = schema;
      console.log(`  ${id}: ${[...Object.keys(schema.tables)].join(', ')}`);
    } catch (error) {
      errors.push(`${id}: ${error.message}`);
    }
  });

  if (errors.length > 0) {
    throw new Error(`Failed to probe ${errors.length} dataset(s):\n${errors.slice(0, 10).join('\n')}`);
  }

  console.log(`Step 4 OK: updated schema for ${toUpdate.length} dataset(s)`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const USAGE = `Usage: node ${path.basename(__filename)} [--full-update]

Update EVM dataset schema in metadata.yml from portal.sqd.dev.
By default only probes datasets without a schema. Use --full-update to re-probe all.`;

async function main() {
  if (process.argv.includes('--help')) { console.log(USAGE); return; }
  const fullUpdate = process.argv.includes('--full-update');

  const portalNames = await loadPortalDatasetNames();
  const metadata = loadMetadata();

  checkMissing(portalNames, metadata);

  const portalEvmDatasets = await detectEvmDatasets(portalNames);
  await updateSchema(portalEvmDatasets, metadata, fullUpdate);

  saveMetadata(metadata);
  console.log(`${METADATA_YAML_PATH} updated.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
