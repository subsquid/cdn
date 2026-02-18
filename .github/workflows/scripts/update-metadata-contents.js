#!/usr/bin/env node
/**
 * Update EVM dataset contents in metadata.tentative.yml from portal.sqd.dev.
 *
 * Step 1: Detect EVM datasets on portal.sqd.dev.
 * Step 2: Verify all detected EVM datasets have a matching key in metadata YAML.
 *         If any are missing, write to missing-networks.txt and exit 1.
 * Step 3: Fetch start block (/metadata) and probe capabilities for each matched dataset.
 * Step 4: Update metadata YAML with contents.
 *
 * By default only probes datasets that lack a "contents" field.
 * Use --full-update to re-probe all datasets.
 *
 * Usage: node .github/workflows/scripts/update-metadata-contents.js [--full-update]
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const yaml = require('js-yaml');

const METADATA_YAML_PATH = path.join(process.cwd(), 'src/sqd-network/mainnet/metadata.tentative.yml');
const PORTAL_BASE = 'https://portal.sqd.dev/datasets';
const REQUEST_TIMEOUT_MS = 15_000;
const DATASET_BATCH_SIZE = Number(process.env.PORTAL_DATASET_BATCH_SIZE || 20);
const CAPABILITY_BATCH_SIZE = Number(process.env.PORTAL_CAPABILITY_BATCH_SIZE || 20);
const MAX_429_RETRIES = Number(process.env.PORTAL_MAX_429_RETRIES || 6);
const DEFAULT_429_DELAY_MS = Number(process.env.PORTAL_DEFAULT_429_DELAY_MS || 1_000);

// Everything that should be checked on top of EVM transactions
const EXTRA_CAPABILITIES = ['logs', 'traces', 'stateDiffs'];

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
    .filter(([, v]) => v && v.kind === 'evm')
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

    const retryAfterMs = parseRetryAfterHeaderMs(res.headers.get('retry-after'));
    console.log(`Retry-after header parsing: raw header "${res.headers.get('retry-after')}", value ${retryAfterMs}`)
    const delayMs = Math.max(0, retryAfterMs ?? DEFAULT_429_DELAY_MS * (attempt + 1));
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
// Step 1 – Detect EVM datasets on portal
// ---------------------------------------------------------------------------

async function loadPortalEvmDatasets() {
  const portalDatasets = await fetchJson(PORTAL_BASE);
  assert(Array.isArray(portalDatasets), `Unexpected response from ${PORTAL_BASE}: expected an array`);

  const datasetNames = portalDatasets
    .map((item) => (item && typeof item === 'object' ? item.dataset : null))
    .filter((name) => typeof name === 'string' && name.length > 0);

  const evmDatasets = new Map();
  const errors = [];

  const results = await mapInBatches(datasetNames, DATASET_BATCH_SIZE, async (name) => {
    try {
      const baseUrl = `${PORTAL_BASE}/${encodeURIComponent(name)}`;
      const head = await getHead(baseUrl);
      const headBlock = head && Number.isFinite(Number(head.number)) ? Number(head.number) : null;
      if (headBlock === null) return { name, isEvm: false };

      const hasTx = await probeCapability(baseUrl, 'transactions', headBlock);
      if (!hasTx) return { name, isEvm: false };

      const hasSolana = await probeCapability(baseUrl, 'instructions', headBlock, 'solana');
      console.log(`${name} - transactions: ${hasTx}, instructions: ${hasSolana}, head: ${headBlock}`);
      if (hasSolana) return { name, isEvm: false };

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
// Step 2 – Check missing
// ---------------------------------------------------------------------------

function checkMissing(portalEvmDatasets, yamlEvmIds) {
  const yamlSet = new Set(yamlEvmIds);
  const missing = [...portalEvmDatasets.keys()].filter((id) => !yamlSet.has(id));
  if (missing.length > 0) {
    const outPath = path.join(process.cwd(), 'missing-networks.txt');
    fs.writeFileSync(outPath, missing.join('\n') + '\n', 'utf8');
    console.error(`Missing datasets in ${METADATA_YAML_PATH} for EVM datasets from ${PORTAL_BASE}:`);
    missing.forEach((m) => console.error('  -', m));
    process.exit(1);
  }
  console.log('Step 2 OK: all portal EVM datasets have a matching metadata entry');
}

// ---------------------------------------------------------------------------
// Step 3 – Probe capabilities & build contents
// ---------------------------------------------------------------------------

async function probeDatasetContents(datasetName, headBlock) {
  const baseUrl = `${PORTAL_BASE}/${encodeURIComponent(datasetName)}`;

  const meta = await fetchJson(`${baseUrl}/metadata`);
  const startBlock = meta.start_block;
  assert(
    startBlock != null,
    `Cannot extract start block from ${datasetName}/metadata: ${JSON.stringify(meta).slice(0, 300)}`,
  );

  const entities = ['blocks', 'transactions'];
  for (const cap of EXTRA_CAPABILITIES) {
    if (await probeCapability(baseUrl, cap, headBlock)) {
      entities.push(cap);
    }
  }

  return [{ range: { from: startBlock, entities } }];
}

async function updateContents(portalEvmDatasets, metadata, fullUpdate) {
  const evmIds = getEvmDatasetIds(metadata);
  const portalSet = new Set(portalEvmDatasets.keys());
  const onPortal = evmIds.filter((id) => portalSet.has(id));
  const toUpdate = fullUpdate
    ? onPortal
    : onPortal.filter((id) => !metadata.datasets[id].contents);

  if (!fullUpdate) {
    const skipped = onPortal.length - toUpdate.length;
    if (skipped > 0) console.log(`Skipping ${skipped} dataset(s) that already have contents (use --full-update to re-probe)`);
  }
  const errors = [];

  await mapInBatches(toUpdate, CAPABILITY_BATCH_SIZE, async (id) => {
    try {
      const info = portalEvmDatasets.get(id);
      const contents = await probeDatasetContents(id, info.headBlock);
      metadata.datasets[id].contents = contents;
      console.log(`  ${id}: ${contents[0].range.entities.join(', ')} (from block ${contents[0].range.from})`);
    } catch (error) {
      errors.push(`${id}: ${error.message}`);
    }
  });

  if (errors.length > 0) {
    throw new Error(`Failed to probe ${errors.length} dataset(s):\n${errors.slice(0, 10).join('\n')}`);
  }

  console.log(`Step 3 OK: updated contents for ${toUpdate.length} dataset(s)`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const fullUpdate = process.argv.includes('--full-update');

  const portalEvmDatasets = await loadPortalEvmDatasets();
  const metadata = loadMetadata();
  const yamlEvmIds = getEvmDatasetIds(metadata);

  checkMissing(portalEvmDatasets, yamlEvmIds);
  await updateContents(portalEvmDatasets, metadata, fullUpdate);

  saveMetadata(metadata);
  console.log(`${METADATA_YAML_PATH} updated.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
