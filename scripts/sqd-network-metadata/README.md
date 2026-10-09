# SQD Network Metadata CLI

CLI to process actions on `src/sqd-network/mainnet/metadata.yml`.

## Requirements

```shell
pip install pyyaml rich
```

## Usage

```shell
python scripts/sqd-network-metadata/__main__.py -h
python scripts/sqd-network-metadata/__main__.py add
python scripts/sqd-network-metadata/__main__.py sort
python scripts/sqd-network-metadata/__main__.py validate
```

## Metadata fields

Each record in `metadata.yml` describes one dataset. A network (one chain,
such as Ethereum Sepolia) can have several datasets: Hyperliquid Mainnet has
`hyperliquid-mainnet`, `hyperliquid-fills` and `hyperliquid-replica-cmds`.
`ecosystem` groups datasets by the organization or brand behind them, across
all of its networks. Ecosystem-level fields (`website`, `docs` and `tier`)
are repeated on every dataset in the ecosystem so consumers do not need
another lookup.

`dataset-exceptions.json` lists where the metadata differs from
`datasets.yml`: `metadata_only` names datasets that have metadata but are not
declared there, and `declared_but_unlisted` names declared datasets that are
left out.

| Field | Level | Meaning |
| --- | --- | --- |
| `display_name` | dataset | Human-readable dataset name, such as "Hyperliquid Replica Commands". |
| `ecosystem` | dataset | Organization or brand grouping that spans networks (Arbitrum One, Nova, Sepolia) and their datasets. |
| `kind` | dataset | Data model or VM, such as `evm`, `substrate`, `solana`, or `bitcoin`. |
| `type` | network | Network class: `mainnet`, `testnet`, or `devnet`. |
| `logo_url` | dataset | Network or ecosystem logo. |
| `website` | ecosystem | Official ecosystem website. Same on every dataset in the ecosystem. |
| `docs` | ecosystem | Official developer documentation. Same on every dataset in the ecosystem. |
| `explorer` | dataset | Block explorer for this dataset's data. Datasets of one network usually share it, but need not: Hyperliquid Mainnet's EVM dataset uses an EVM explorer, its fills and replica commands the Hyperliquid explorer. Omitted where none was confirmed. |
| `tier` | ecosystem | Ecosystem tier: `core`, `partner`, or `frontier`. Same on every dataset in the ecosystem. |
| `private` | dataset | `true` while access requires a private or commercial arrangement. Change it on the record alone when a dataset becomes public. |

Run `validate` before opening a PR. It checks that `metadata.yml` has a record
for exactly the datasets in `datasets.yml` adjusted by
`dataset-exceptions.json`, required fields on every record, and that datasets
in one ecosystem agree on the ecosystem-level fields.
