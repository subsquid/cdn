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

Each dataset has its own record. Chain-level fields are repeated on every
network in the same `ecosystem` so consumers do not need another lookup.

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
| `tier` | SQD support tier: `core`, `partner`, or `frontier`. This is consistent across an ecosystem. |
| `private` | `true` when access requires a private or commercial arrangement. |

Run `validate` before opening a PR. It checks required fields on every metadata
record, confirms every declared dataset has metadata, and verifies that
chain-level fields agree within an ecosystem.
