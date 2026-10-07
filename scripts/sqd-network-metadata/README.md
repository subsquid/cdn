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

Each dataset (network) has its own record and belongs to one chain, named by
`ecosystem`. Chain-level fields, including `category`, are repeated on every
network of the same chain so consumers do not need another lookup.
`catalog.json` records how the metadata differs from `datasets.yml`:
`metadata_only` lists datasets that have metadata but are not declared there,
and `declared_but_unlisted` lists declared datasets that are left out.

| Field | Meaning |
| --- | --- |
| `display_name` | Human-readable network name. |
| `ecosystem` | Canonical chain grouping. Mainnets and testnets for one chain use the same value. |
| `kind` | Data model or VM, such as `evm`, `substrate`, `solana`, or `bitcoin`. |
| `type` | Network class: `mainnet`, `testnet`, or `devnet`. |
| `logo_url` | Network or chain logo. |
| `logo_bg` | Optional rendering hint. `white` adds a white background behind a dark logo. |
| `website` | Official chain website. |
| `docs` | Official developer documentation. |
| `explorer` | Official or primary block explorer when reviewed. |
| `category` | Chain category: `core`, `partner`, or `frontier`. Every network of a chain has the same value. |
| `private` | `true` while access requires a private or commercial arrangement. Change it on the record alone when a dataset becomes public. |

Run `validate` before opening a PR. It checks that the metadata covers exactly
the catalog, required fields on every metadata record, and consistency of
chain-level fields within a chain.
