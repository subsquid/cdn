import argparse
import json
import os
from pathlib import Path

from rich.console import Console


def update_parser(parser: argparse.ArgumentParser):
    parser.description = "Sort archives JSON-file"
    parser.add_argument(
        "variant",
        help="archive variant",
        choices=["evm", "substrate"],
    )
    parser.set_defaults(func=_run)


def _run(parsed_args):
    console = Console()
    root_p = Path(os.path.realpath(__file__)).parent.parent.parent
    with open(root_p / f"src/archives/{parsed_args.variant}.json") as f:
        archives = json.load(f)
    archives["archives"] = sorted(archives["archives"], key=lambda x: x["network"])
    with open(root_p / f"src/archives/{parsed_args.variant}.json", "w") as f:
        json.dump(archives, f, indent=2, sort_keys=True)
    console.print("Done!")
