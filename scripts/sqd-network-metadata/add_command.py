import argparse
from pathlib import Path

import yaml
from rich.console import Console
from rich.prompt import Confirm, Prompt
from rich.syntax import Syntax


METADATA_PATH = Path(__file__).resolve().parent.parent.parent / "src/sqd-network/mainnet/metadata.yml"
TYPE_CHOICES = ["testnet", "mainnet", "devnet"]
TIER_CHOICES = ["core", "partner", "frontier"]


def update_parser(parser: argparse.ArgumentParser):
    parser.description = "Add new dataset entry to metadata.yml"
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


def _optional_value(value: str):
    return None if value == "null" else value


def _build_entry(
    kind: str,
    display_name: str,
    ecosystem: str,
    logo_url: str,
    chain_type: str,
    chain_id_raw: str,
    website: str,
    docs: str,
    explorer_raw: str,
    tier: str,
    private: bool,
    logo_bg_raw: str,
):
    chain_id = _parse_chain_id(chain_id_raw)

    meta = {
        "kind": kind,
        "display_name": display_name,
        "ecosystem": ecosystem,
        "type": chain_type,
        "logo_url": logo_url,
        "website": website,
        "docs": docs,
        "tier": tier,
        "private": private,
    }

    explorer = _optional_value(explorer_raw)
    if explorer is not None:
        meta["explorer"] = explorer

    logo_bg = _optional_value(logo_bg_raw)
    if logo_bg is not None:
        meta["logo_bg"] = logo_bg

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

    ecosystem = Prompt.ask("ecosystem", default=dataset_key).strip()
    assert ecosystem, "ecosystem must not be empty"

    logo_url = Prompt.ask("logo_url").strip()
    assert logo_url, "logo_url must not be empty"

    chain_type = Prompt.ask("type", default="mainnet", choices=TYPE_CHOICES).strip()
    chain_id_raw = Prompt.ask("chain_id", default="null").strip()
    website = Prompt.ask("website").strip()
    assert website, "website must not be empty"
    docs = Prompt.ask("docs").strip()
    assert docs, "docs must not be empty"
    explorer_raw = Prompt.ask("explorer", default="null").strip()
    tier = Prompt.ask("tier", default="frontier", choices=TIER_CHOICES).strip()
    private = Confirm.ask("private", default=False)
    logo_bg_raw = Prompt.ask("logo_bg", default="null", choices=["null", "white"]).strip()

    entry = _build_entry(
        kind,
        display_name,
        ecosystem,
        logo_url,
        chain_type,
        chain_id_raw,
        website,
        docs,
        explorer_raw,
        tier,
        private,
        logo_bg_raw,
    )
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
