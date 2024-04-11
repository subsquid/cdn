import argparse
import json
import os
from pathlib import Path

from rich.console import Console
from rich.syntax import Syntax
from rich.prompt import Prompt, Confirm


def update_parser(parser: argparse.ArgumentParser):
    parser.description = "Add new archive to the CDN"
    parser.add_argument("variant", help="archive variant", choices=["evm", "substrate"])
    parser.set_defaults(func=_run)


def _run(parsed_args):
    console = Console()
    registry_name = Prompt.ask("Registry name")
    hr_name = Prompt.ask("Human readable name")
    data_source_id = Prompt.ask("Data source identifier")
    entry = {}
    match parsed_args.variant:
        case "evm":
            chain_id = Prompt.ask("Chain ID", default="null")
            entry = {
                "network": registry_name,
                "chainId": int(chain_id) if chain_id.isdecimal() else None,
                "chainName": hr_name,
                "providers": [
                    {
                        "provider": "subsquid",
                        "dataSourceUrl": f"https://v2.archive.subsquid.io/network/{data_source_id}",
                        "release": "ArrowSquid",
                    }
                ],
            }
        case "substrate":
            chain_ss58_prefix = Prompt.ask("Chain SS58 Prefix", default="null")
            genesis_hash = Prompt.ask("Genesis hash", default="")
            entry = {
                "network": registry_name,
                "chainSS58Prefix": (
                    int(chain_ss58_prefix) if chain_ss58_prefix.isdecimal() else None
                ),
                "chainName": hr_name,
                "genesis_hash": genesis_hash,
                "providers": [
                    {
                        "provider": "subsquid",
                        "dataSourceUrl": f"https://v2.archive.subsquid.io/network/{data_source_id}",
                        "release": "ArrowSquid",
                    }
                ],
            }
    syntax = Syntax(
        json.dumps(entry, indent=2), "json", theme="monokai", line_numbers=True
    )
    console.print(
        f"\nFollowing entry will be added to 'src/archives/{parsed_args.variant}.json':"
    )
    console.print(syntax)
    confirm = Confirm.ask("Ok?", default="y")
    if confirm:
        root_p = Path(os.path.realpath(__file__)).parent.parent.parent
        with open(root_p / f"src/archives/{parsed_args.variant}.json") as f:
            archives = json.load(f)
        archives["archives"].append(entry)
        archives["archives"] = sorted(archives["archives"], key=lambda x: x["network"])
        with open(root_p / f"src/archives/{parsed_args.variant}.json", "w") as f:
            json.dump(archives, f, indent=2)
        console.print("Done!")
    else:
        console.print("Abort!")
