import argparse
from collections import defaultdict
import json
from pathlib import Path

import yaml
from rich.console import Console


ROOT = Path(__file__).resolve().parent.parent.parent
METADATA_PATH = ROOT / "src/sqd-network/mainnet/metadata.yml"
DATASETS_PATH = ROOT / "src/sqd-network/datasets.yml"
CATALOG_PATH = Path(__file__).resolve().parent / "catalog.json"
REQUIRED_FIELDS = ("kind", "display_name", "ecosystem", "logo_url", "website", "docs", "tier", "private")
TIER_CHOICES = {"core", "partner", "frontier"}
TYPE_CHOICES = {"mainnet", "testnet", "devnet"}
LOGO_BG_CHOICES = {"white"}


def update_parser(parser: argparse.ArgumentParser):
    parser.description = "Validate dataset metadata"
    parser.set_defaults(func=_run)


def _load_yaml(path: Path):
    with open(path, "r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def _run(parsed_args):
    del parsed_args
    console = Console()
    metadata = _load_yaml(METADATA_PATH)["datasets"]
    declarations = _load_yaml(DATASETS_PATH)["sqd-network-datasets"]
    declared = {entry["name"] for entry in declarations}
    with open(CATALOG_PATH, "r", encoding="utf-8") as handle:
        catalog = json.load(handle)
    expected_public = (
        declared
        - set(catalog["declared_but_unlisted"])
        | set(catalog["public_metadata_only"])
    )
    expected_private = set(catalog["private"])
    errors = []
    ecosystems = defaultdict(lambda: defaultdict(set))

    for dataset, record in metadata.items():
        fields = record.get("metadata") or {}
        for field in REQUIRED_FIELDS:
            if field not in fields or fields[field] in (None, ""):
                errors.append(f"{dataset}: missing metadata.{field}")
        if fields.get("tier") not in TIER_CHOICES:
            errors.append(f"{dataset}: invalid metadata.tier {fields.get('tier')!r}")
        if "type" in fields and fields["type"] not in TYPE_CHOICES:
            errors.append(f"{dataset}: invalid metadata.type {fields['type']!r}")
        if not isinstance(fields.get("private"), bool):
            errors.append(f"{dataset}: metadata.private must be a boolean")
        if "logo_bg" in fields and fields["logo_bg"] not in LOGO_BG_CHOICES:
            errors.append(f"{dataset}: invalid metadata.logo_bg {fields['logo_bg']!r}")
        for field in ("website", "docs", "explorer", "logo_url"):
            if field in fields and not str(fields[field]).startswith(("https://", "http://")):
                errors.append(f"{dataset}: metadata.{field} must be an HTTP(S) URL")
        ecosystem = fields.get("ecosystem")
        if ecosystem:
            for field in ("website", "docs", "tier", "private"):
                if field in fields:
                    ecosystems[ecosystem][field].add(fields[field])

    actual_private = {
        dataset
        for dataset, record in metadata.items()
        if (record.get("metadata") or {}).get("private") is True
    }
    actual_public = set(metadata) - actual_private
    for label, actual, expected in (
        ("public", actual_public, expected_public),
        ("private", actual_private, expected_private),
    ):
        missing = sorted(expected - actual)
        unexpected = sorted(actual - expected)
        if missing:
            errors.append(f"{label} catalog is missing: {', '.join(missing)}")
        if unexpected:
            errors.append(f"{label} catalog has unexpected datasets: {', '.join(unexpected)}")

    for ecosystem, fields in ecosystems.items():
        for field, values in fields.items():
            if len(values) > 1:
                errors.append(f"{ecosystem}: networks disagree on metadata.{field}: {sorted(values)!r}")

    if errors:
        console.print("Metadata validation failed:", style="bold red")
        for error in errors:
            console.print(f"- {error}")
        raise SystemExit(1)

    console.print(
        f"Validated {len(actual_public)} public and {len(actual_private)} private metadata records.",
        style="bold green",
    )
