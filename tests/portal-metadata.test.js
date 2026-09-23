const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const yaml = require('js-yaml');
const { updateSchema } = require('../.github/workflows/scripts/update-metadata-contents.js');

const readYaml = (file) => yaml.load(readFileSync(join(__dirname, '..', file), 'utf8'));

test('Portal declarations and metadata agree on dataset kinds', () => {
  const declarations = readYaml('src/sqd-network/datasets.yml')['sqd-network-datasets'];
  const metadata = readYaml('src/sqd-network/mainnet/metadata.yml').datasets;
  for (const row of declarations) {
    assert.ok(metadata[row.name], `${row.name} needs metadata`);
    assert.equal(row.kind, metadata[row.name].metadata.kind, `${row.name} has conflicting kinds`);
  }
  assert.equal(declarations.find((row) => row.name === 'celo-mainnet').kind, 'evm');
  assert.equal(metadata['binance-testnet'].metadata.display_name, 'BNB Smart Chain Testnet');
  assert.equal(metadata['binance-testnet'].metadata.evm.chain_id, 97);
  assert.ok(Object.hasOwn(metadata['ethereum-sepolia'].schema.tables, 'state_diffs'));
});

test('a full metadata refresh retains supported state diffs and does not erase them on HTTP errors', async (t) => {
  const source = readYaml('src/sqd-network/mainnet/metadata.yml').datasets['ethereum-sepolia'];
  const portalDatasets = new Map([['ethereum-sepolia', { headBlock: 8000000 }]]);
  let stateDiffStatus = 200;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://portal.sqd.dev/datasets/ethereum-sepolia/stream');
    const body = JSON.parse(options.body);
    assert.equal(body.type, 'evm');
    assert.equal(body.fromBlock, 8000000);
    assert.equal(body.toBlock, 8000000);
    return new Response(null, { status: body.stateDiffs ? stateDiffStatus : 200 });
  });
  const fixture = () => ({ datasets: { 'ethereum-sepolia': structuredClone(source) } });
  for (stateDiffStatus of [200, 204]) {
    const metadata = fixture();
    await updateSchema(portalDatasets, metadata, true);
    assert.ok(Object.hasOwn(metadata.datasets['ethereum-sepolia'].schema.tables, 'state_diffs'));
  }
  for (stateDiffStatus of [403, 404, 500, 529]) {
    const metadata = fixture();
    await assert.rejects(updateSchema(portalDatasets, metadata, true), new RegExp(`HTTP ${stateDiffStatus}`));
    assert.deepEqual(metadata, fixture(), 'an inconclusive probe must preserve the last known schema');
  }
  stateDiffStatus = 400;
  const unsupported = fixture();
  await updateSchema(portalDatasets, unsupported, true);
  assert.equal(Object.hasOwn(unsupported.datasets['ethereum-sepolia'].schema.tables, 'state_diffs'), false);
});
