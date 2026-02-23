import argparse
from pathlib import Path

import yaml
from rich.console import Console


METADATA_PATH = Path(__file__).resolve().parent.parent.parent / "src/sqd-network/mainnet/metadata.tentative.yml"


def update_parser(parser: argparse.ArgumentParser):
    parser.description = "Sort metadata datasets by kind, then key"
    parser.set_defaults(func=_run)


def _run(parsed_args):
    del parsed_args
    console = Console()

    with open(METADATA_PATH, "r", encoding="utf-8") as handle:
        metadata = yaml.safe_load(handle)

    assert isinstance(metadata, dict), f"Expected YAML object in {METADATA_PATH}"
    assert "datasets" in metadata and isinstance(metadata["datasets"], dict), f'Expected "datasets" object in {METADATA_PATH}'

    datasets_items = list(metadata["datasets"].items())
    for key, entry in datasets_items:
        assert isinstance(entry, dict), f"datasets.{key} must be an object"
        assert "metadata" in entry and isinstance(entry["metadata"], dict), f"datasets.{key} must have a metadata object"
        meta = entry["metadata"]
        assert "kind" in meta and isinstance(meta["kind"], str) and meta["kind"], f"datasets.{key}.metadata.kind must be a non-empty string"

    sorted_datasets = {}
    for key, entry in sorted(datasets_items, key=lambda item: (item[1]["metadata"]["kind"], item[0])):
        sorted_datasets[key] = entry

    metadata["datasets"] = sorted_datasets

    with open(METADATA_PATH, "w", encoding="utf-8") as handle:
        yaml.safe_dump(metadata, handle, sort_keys=False, allow_unicode=False, width=10_000)

    console.print("Done!")
