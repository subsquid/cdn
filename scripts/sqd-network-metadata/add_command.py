import argparse
from pathlib import Path

import yaml
from rich.console import Console
from rich.prompt import Confirm, Prompt
from rich.syntax import Syntax


METADATA_PATH = Path(__file__).resolve().parent.parent.parent / "src/sqd-network/mainnet/metadata.tentative.yml"
TYPE_CHOICES = ["testnet", "mainnet", "devnet"]


def update_parser(parser: argparse.ArgumentParser):
    parser.description = "Add new dataset entry to metadata.tentative.yml"
    parser.set_defaults(func=_run)


def _load_metadata():
    with open(METADATA_PATH, "r", encoding="utf-8") as handle:
        metadata = yaml.safe_load(handle)
    assert isinstance(metadata, dict), f"Expected YAML object in {METADATA_PATH}"
    assert "datasets" in metadata and isinstance(metadata["datasets"], dict), f'Expected "datasets" object in {METADATA_PATH}'
    return metadata


def _parse_chain_id(chain_id_raw: str):
    if chain_id_raw == "null":
        return None
    assert chain_id_raw.isdecimal(), "Chain ID must be a decimal integer or 'null'"
    return int(chain_id_raw)


def _build_entry(kind: str, display_name: str, logo_url_raw: str, chain_type: str, chain_id_raw: str):
    chain_id = _parse_chain_id(chain_id_raw)

    meta = {
        "kind": kind,
        "display_name": display_name,
        "type": chain_type,
    }

    if logo_url_raw != "null":
        meta["logo_url"] = logo_url_raw

    if chain_id is not None:
        meta["evm"] = {"chain_id": chain_id}

    schema = {}

    return {"metadata": meta, "schema": schema}


def _run(parsed_args):
    del parsed_args
    console = Console()

    metadata = _load_metadata()
    datasets = metadata["datasets"]

    dataset_key = Prompt.ask("Dataset key (datasets.<key>)").strip()
    assert dataset_key, "Dataset key must not be empty"
    assert dataset_key not in datasets, f"Dataset '{dataset_key}' already exists"

    kind = Prompt.ask("kind", default="evm").strip()
    assert kind, "kind must not be empty"

    display_name = Prompt.ask("display_name").strip()
    assert display_name, "display_name must not be empty"

    logo_url_raw = Prompt.ask("logo_url", default="null").strip()
    assert logo_url_raw, "logo_url must not be empty (use 'null' for missing value)"

    chain_type = Prompt.ask("type", default="mainnet", choices=TYPE_CHOICES).strip()
    chain_id_raw = Prompt.ask("chain_id", default="null").strip()

    entry = _build_entry(kind, display_name, logo_url_raw, chain_type, chain_id_raw)
    syntax = Syntax(yaml.safe_dump(entry, sort_keys=False), "yaml", theme="monokai", line_numbers=True)
    console.print(f"\nFollowing entry will be added as datasets.{dataset_key}:")
    console.print(syntax)

    if not Confirm.ask("Ok?", default=True):
        console.print("Abort!")
        return

    datasets[dataset_key] = entry
    with open(METADATA_PATH, "w", encoding="utf-8") as handle:
        yaml.safe_dump(metadata, handle, sort_keys=False, allow_unicode=False, width=10_000)
    console.print("Done!")
