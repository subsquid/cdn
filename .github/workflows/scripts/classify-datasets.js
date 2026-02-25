#!/usr/bin/env node
/**
 * Classify all portal datasets by VM kind and update metadata.tentative.yml.
 *
 * Fetches every dataset from portal.sqd.dev, determines its VM kind by
 * probing capabilities, then updates the YAML.
 *
 * Default:       add missing datasets with correct kind; fill in missing kind
 *                fields for existing datasets. Fails if any dataset in the
 *                YAML cannot be classified.
 * --full-update: overwrite kind for all portal datasets + add missing ones.
 *
 * Usage: node .github/workflows/scripts/classify-datasets.js [--full-update]
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const yaml = require('js-yaml');

const METADATA_YAML_PATH = path.join(process.cwd(), 'src/sqd-network/mainnet/metadata.tentative.yml');
const PORTAL_BASE = 'https://portal.sqd.dev/datasets';
const REQUEST_TIMEOUT_MS = 15_000;
const CLASSIFY_BATCH_SIZE = Number(process.env.PORTAL_CLASSIFY_BATCH_SIZE || 10);
const MAX_429_RETRIES = Number(process.env.PORTAL_MAX_429_RETRIES || 6);
const DEFAULT_429_DELAY_MS = Number(process.env.PORTAL_DEFAULT_429_DELAY_MS || 1_000);

// ---------------------------------------------------------------------------
// YAML I/O
// ---------------------------------------------------------------------------

function loadMetadata() {
  const raw = fs.readFileSync(METADATA_YAML_PATH, 'utf8');
  const parsed = yaml.load(raw);
  assert(parsed && typeof parsed === 'object', `${METADATA_YAML_PATH} must be a YAML object`);
  if (!parsed.datasets) parsed.datasets = {};
  assert(typeof parsed.datasets === 'object' && !Array.isArray(parsed.datasets), `${METADATA_YAML_PATH}: "datasets" must be an object`);
  return parsed;
}

function saveMetadata(metadata) {
  const output = yaml.dump(metadata, { noRefs: true, lineWidth: -1 });
  fs.writeFileSync(METADATA_YAML_PATH, output, 'utf8');
}

function sortDatasets(datasets) {
  const sorted = {};
  const keys = Object.keys(datasets).sort((a, b) => {
    const kindA = ((datasets[a].metadata || {}).kind || '');
    const kindB = ((datasets[b].metadata || {}).kind || '');
    if (kindA !== kindB) return kindA < kindB ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  for (const key of keys) sorted[key] = datasets[key];
  return sorted;
}

// ---------------------------------------------------------------------------
// HTTP helpers (same as update-metadata-contents.js)
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

function buildProbeBody(block, capability, probeType) {
  const body = { type: probeType, fromBlock: block, toBlock: block };
  body[capability] = [{}];
  return body;
}

async function probeCapability(baseUrl, capability, block, probeType) {
  const body = buildProbeBody(block, capability, probeType);
  const res = await fetchWith429Retry(`${baseUrl}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  return res.status === 200 || res.status === 204;
}

// ---------------------------------------------------------------------------
// Classification rules
// ---------------------------------------------------------------------------

async function classifyDataset(baseUrl, headBlock) {
  const cache = new Map();
  async function probe(capability, type) {
    const key = `${capability}:${type}`;
    if (!cache.has(key)) {
      cache.set(key, await probeCapability(baseUrl, capability, headBlock, type));
    }
    return cache.get(key);
  }

  // evm: transactions(evm) && !instructions(solana) && !events(starknet) && !receipts(fuel) && !internalTransactions(tron)
  if (await probe('transactions', 'evm')) {
    if (!(await probe('instructions', 'solana'))
      && !(await probe('events', 'starknet'))
      && !(await probe('receipts', 'fuel'))
      && !(await probe('internalTransactions', 'tron'))) {
      return 'evm';
    }
  }

  // solana: instructions(solana) && tokenBalances(solana)
  if (await probe('instructions', 'solana') && await probe('tokenBalances', 'solana')) {
    return 'solana';
  }

  // substrate: events(substrate) && calls(substrate)
  if (await probe('events', 'substrate') && await probe('calls', 'substrate')) {
    return 'substrate';
  }

  // fuel: receipts(fuel) && inputs(fuel)
  if (await probe('receipts', 'fuel') && await probe('inputs', 'fuel')) {
    return 'fuel';
  }

  // tron: transactions(tron) && internalTransactions(tron)
  if (await probe('transactions', 'tron') && await probe('internalTransactions', 'tron')) {
    return 'tron';
  }

  // hyperliquidFills: fills(hyperliquidFills)
  if (await probe('fills', 'hyperliquidFills')) {
    return 'hyperliquidFills';
  }

  // hyperliquidReplicaCmds: orderActions(hyperliquidReplicaCmds)
  if (await probe('orderActions', 'hyperliquidReplicaCmds')) {
    return 'hyperliquidReplicaCmds';
  }

  // bitcoin: inputs(bitcoin) && !receipts(fuel)
  if (await probe('inputs', 'bitcoin') && !(await probe('receipts', 'fuel'))) {
    return 'bitcoin';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Step 1 – Fetch & classify all portal datasets
// ---------------------------------------------------------------------------

async function classifyAllPortalDatasets() {
  const portalDatasets = await fetchJson(PORTAL_BASE);
  assert(Array.isArray(portalDatasets), `Unexpected response from ${PORTAL_BASE}: expected an array`);

  const datasetNames = portalDatasets
    .map((item) => (item && typeof item === 'object' ? item.dataset : null))
    .filter((name) => typeof name === 'string' && name.length > 0);

  console.log(`Found ${datasetNames.length} datasets on portal`);

  const classifications = new Map();
  const unclassified = [];
  const errors = [];

  const results = await mapInBatches(datasetNames, CLASSIFY_BATCH_SIZE, async (name) => {
    try {
      const baseUrl = `${PORTAL_BASE}/${encodeURIComponent(name)}`;
      const head = await getHead(baseUrl);
      const headBlock = head && Number.isFinite(Number(head.number)) ? Number(head.number) : null;
      if (headBlock === null) {
        console.log(`  ${name}: no head block, skipping`);
        return { name, kind: null, skipped: true };
      }

      const kind = await classifyDataset(baseUrl, headBlock);
      console.log(`  ${name}: ${kind || 'UNCLASSIFIED'}`);
      return { name, kind };
    } catch (error) {
      return { name, kind: null, error };
    }
  });

  for (const r of results) {
    if (r.error) {
      errors.push(`${r.name}: ${r.error.message}`);
    } else if (r.skipped) {
      continue;
    } else if (r.kind) {
      classifications.set(r.name, r.kind);
    } else {
      unclassified.push(r.name);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Failed to probe ${errors.length} dataset(s):\n${errors.join('\n')}`);
  }

  if (unclassified.length > 0) {
    throw new Error(`Cannot classify ${unclassified.length} dataset(s):\n${unclassified.join('\n')}`);
  }

  console.log(`Classified ${classifications.size} datasets`);
  return classifications;
}

// ---------------------------------------------------------------------------
// Step 2 – Apply classifications to YAML
// ---------------------------------------------------------------------------

function applyClassifications(classifications, metadata, fullUpdate) {
  const datasets = metadata.datasets;

  // Add missing datasets
  let added = 0;
  for (const [name, kind] of classifications) {
    if (!datasets[name]) {
      datasets[name] = { metadata: { kind }, schema: {} };
      added++;
    }
  }
  if (added > 0) console.log(`Added ${added} missing dataset(s)`);

  if (fullUpdate) {
    // Overwrite kind for all portal datasets
    let updated = 0;
    for (const [name, kind] of classifications) {
      if (!datasets[name].metadata) datasets[name].metadata = {};
      if (datasets[name].metadata.kind !== kind) {
        console.log(`  ${name}: ${datasets[name].metadata.kind || '(none)'} -> ${kind}`);
        updated++;
      }
      datasets[name].metadata.kind = kind;
    }
    console.log(`Updated kind for ${updated} dataset(s)`);
  } else {
    // Only fill in missing kind fields
    const missing = [];
    for (const [name, entry] of Object.entries(datasets)) {
      if (entry.metadata && entry.metadata.kind) continue;
      const kind = classifications.get(name);
      if (!kind) {
        missing.push(name);
        continue;
      }
      if (!entry.metadata) entry.metadata = {};
      entry.metadata.kind = kind;
      console.log(`  ${name}: set kind to ${kind}`);
    }
    if (missing.length > 0) {
      throw new Error(
        `Cannot classify ${missing.length} dataset(s) already in the YAML (not found on portal):\n${missing.join('\n')}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const fullUpdate = process.argv.includes('--full-update');

  const classifications = await classifyAllPortalDatasets();
  const metadata = loadMetadata();

  applyClassifications(classifications, metadata, fullUpdate);
  metadata.datasets = sortDatasets(metadata.datasets);
  saveMetadata(metadata);

  console.log(`${METADATA_YAML_PATH} updated.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
