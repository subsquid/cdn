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
        table.add_column("Chain ID", justify="left", no_wrap=True)
    elif parsed_args.variant == "substrate":
        table.add_column("SS58 Prefix", justify="left", no_wrap=True)
    table.add_column("Release", justify="left", no_wrap=True)
    table.add_column("Data source URL", justify="left")

    for archive in [
        a
        for a in archives["archives"]
        if parsed_args.search is None or
        parsed_args.search.lower() in a["network"] or
        parsed_args.search.lower() in a["chainName"].lower()
    ]:
        for provider in archive["providers"]:
            row = [
                archive["network"],
                archive["chainName"],
                provider["release"],
                provider["dataSourceUrl"],
            ]
            if parsed_args.variant == "evm":
                row.insert(
                    2, "" if archive["chainId"] is None else str(archive["chainId"])
                )
            elif parsed_args.variant == "substrate":
                row.insert(
                    2,
                    (
                        ""
                        if archive["chainSS58Prefix"] is None
                        else str(archive["chainSS58Prefix"])
                    ),
                )
            table.add_row(*row)

    console.print(table)
