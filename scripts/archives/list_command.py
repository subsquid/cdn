import argparse
import json
import os
from pathlib import Path

from rich.console import Console
from rich.table import Table


def update_parser(parser: argparse.ArgumentParser):
    parser.description = "List archives from JSON-files"
    parser.add_argument(
        "variant",
        help="archive variant",
        choices=["evm", "substrate"],
    )
    parser.add_argument("-s", "--search", type=str, help="search by name")
    parser.set_defaults(func=_run)


def _run(parsed_args):
    console = Console()
    root_p = Path(os.path.realpath(__file__)).parent.parent.parent
    with open(root_p / f"src/archives/{parsed_args.variant}.json") as f:
        archives = json.load(f)

    match parsed_args.variant:
        case "evm":
            table = Table(title="EVM Archives")
        case "substrate":
            table = Table(title="Substrate Archives")
        case _:
            raise ValueError("Invalid archive variant")

    table.add_column("ID", justify="left", no_wrap=True)
    table.add_column("Name", justify="left", no_wrap=True)
    if parsed_args.variant == "evm":
        table.add_column("Chain Kind", justify="left", no_wrap=True)
        table.add_column("Chain ID", justify="left", no_wrap=True)
        table.add_column("R/T/S", justify="left", no_wrap=True)
    elif parsed_args.variant == "substrate":
        table.add_column("SS58 Prefix", justify="left", no_wrap=True)
    table.add_column("Data source URL", justify="left")

    for archive in [
        a
        for a in archives["archives"]
        if parsed_args.search is None
        or parsed_args.search.lower() in a["network"]
        or parsed_args.search.lower() in a["chainName"].lower()
    ]:
        for provider in archive["providers"]:
            row = [
                archive["network"],
                archive["chainName"],
                provider["dataSourceUrl"],
            ]
            if parsed_args.variant == "evm":
                data = provider.get("dataSourceData", [])
                has_receipts = "+" if "receipts" in data else "-"
                has_traces = "+" if "traces" in data else "-"
                has_statediffs = "+" if "statediffs" in data else "-"
                chain_id = "-"
                if archive["chainId"]:
                    chain_id = str(archive["chainId"])
                row.insert(2, f"{has_receipts}/{has_traces}/{has_statediffs}")
                row.insert(2, chain_id)
                row.insert(2, archive["chainKind"].title())
            elif parsed_args.variant == "substrate":
                chain_ss58_prefix = "-"
                if archive["chainSS58Prefix"]:
                    chain_ss58_prefix = str(archive["chainSS58Prefix"])
                row.insert(2, chain_ss58_prefix)
            table.add_row(*row)

    console.print(table)
