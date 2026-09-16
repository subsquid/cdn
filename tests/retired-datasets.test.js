const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const yaml = require('js-yaml');
const retired = require('../scripts/retired-datasets.json');
const cliExclusions = require('./fixtures/pipes-cli-exclusions.json');
const { classifyAllPortalDatasets } = require('../.github/workflows/scripts/classify-datasets.js');
const { loadPortalDatasetNames } = require('../.github/workflows/scripts/update-metadata-contents.js');
const { transferArchive } = require('../.github/workflows/scripts/transfer-evm-metadata.js');

const read = (file) => readFileSync(join(__dirname, '..', file), 'utf8');

test('Pipes CLI network choices exclude retired and unavailable datasets', () => {
  const schema = JSON.parse(read('src/schemas/pipes_cli_config.json'));
  const networks = schema.oneOf.flatMap((variant) => variant.properties.defaultNetwork?.enum ?? []);
  // These exclusions apply only to CLI network choices.
  const excluded = [...retired, ...cliExclusions.retired, ...cliExclusions.unavailable];
  for (const slug of excluded) assert.equal(networks.includes(slug), false, `${slug} is still offered by Pipes CLI`);
  assert.ok(networks.includes('ethereum-mainnet'), 'active EVM networks remain selectable');
  assert.ok(networks.includes('solana-mainnet'), 'active SVM networks remain selectable');
});

test('Portal registries exclude retired datasets and keep Pendulum storage available', () => {
  const declarations = yaml.load(read('src/sqd-network/datasets.yml'))['sqd-network-datasets'];
  const metadata = yaml.load(read('src/sqd-network/mainnet/metadata.yml')).datasets;
  const archives = JSON.parse(read('src/archives/substrate.json')).archives;
  const networks = JSON.parse(read('src/archives/networks.json')).networks;
  const catalogs = [
    declarations.map((row) => row.name), Object.keys(metadata),
    archives.map((row) => row.id), networks.map((row) => row.name),
  ];
  for (const names of catalogs) {
    for (const slug of retired) assert.equal(names.includes(slug), false, `${slug} was reintroduced`);
    assert.ok(names.includes('polkadot'), 'active Substrate datasets remain listed');
  }
  assert.equal(retired.includes('pendulum'), false);
  assert.ok(catalogs[0].includes('pendulum'), 'Pendulum remains declared');
  assert.equal(catalogs[1].includes('pendulum'), false, 'Pendulum is omitted from expanded metadata');
  assert.ok(catalogs[2].includes('pendulum'), 'Pendulum archive remains available');
});

test('legacy EVM metadata imports cannot restore retired Portal datasets', () => {
  const archives = JSON.parse(read('src/archives/evm.json')).archives;
  const stale = retired.map((id) => ({ id, chainName: 'Retired dataset' }));
  for (const overwrite of [false, true]) {
    const datasets = {};
    for (const archive of [...archives, ...stale]) transferArchive(archive, datasets, overwrite);
    for (const slug of retired) assert.equal(Object.hasOwn(datasets, slug), false, `${slug} was imported`);
    assert.ok(datasets['ethereum-mainnet'], 'active EVM metadata is still imported');
  }
});

test('metadata updates ignore retired names in a stale Portal catalog', async (t) => {
  const reads = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const path = new URL(url).pathname;
    reads.push(path);
    if (path === '/datasets') {
      return Response.json(['polkadot', ...retired].map((dataset) => ({ dataset })));
    }
    if (path === '/datasets/polkadot/head') return Response.json({ number: 100 });
    if (path === '/datasets/polkadot/stream') {
      const body = JSON.parse(options.body);
      const supported = body.type === 'substrate' && (body.events || body.calls);
      return new Response('', { status: supported ? 200 : 400 });
    }
    assert.fail(`Unexpected request: ${path}`);
  });
  assert.deepEqual(await loadPortalDatasetNames(), ['polkadot']);
  assert.deepEqual([...(await classifyAllPortalDatasets())], [['polkadot', 'substrate']]);
  for (const slug of retired) assert.equal(reads.some((path) => path.startsWith(`/datasets/${slug}/`)), false);
});
