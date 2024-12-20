import argparse
import json
import os
from pathlib import Path

from rich.console import Console
from rich.syntax import Syntax
from rich.prompt import Prompt, Confirm


def update_parser(parser: argparse.ArgumentParser):
    parser.description = "Add new archive to the CDN"
    parser.add_argument(
        "variant",
        help="archive variant",
        choices=[
            "evm",
            "substrate",
            "solana",
            "tron",
            "fuel",
            "starknet",
        ],
    )
    parser.set_defaults(func=_run)


def _run(parsed_args):
    console = Console()
    hr_name = Prompt.ask("Human readable name")
    data_source_id = Prompt.ask("Data source identifier")
    registry_name = Prompt.ask("Registry name", default=data_source_id)
    chain_testnet = Confirm.ask("Is chain testnet?", default=False)
    support_tier = int(Prompt.ask("Support tier", default="2", choices=["1", "2", "3"]))
    entry = {}
    match parsed_args.variant:
        case "solana" | "tron" | "fuel" | "starknet":
            match parsed_args.variant:
                case "fuel":
                    datasource_data = [
                        "blocks",
                        "tx",
                        "receipts",
                        "inputs",
                        "outputs",
                    ]
                case "solana":
                    start_block = Prompt.ask("First supported block", default="null")
                    datasource_data = [
                        "blocks",
                        "logs",
                        "tx",
                        "instructions",
                        "balances",
                        "token_balances",
                        "rewards",
                    ]
                    if start_block != "null":
                        datasource_data = [
                            {
                                "name": v,
                                "ranges": [[start_block, None]]
                            } for v in datasource_data
                        ]
                case "starknet":
                    datasource_data = [
                        "blocks",
                        "tx",
                        "events",
                    ]
                case "tron":
                    datasource_data = [
                        "blocks",
                        "tx",
                        "logs",
                        "internal_tx",
                    ]
            entry = {
                "id": data_source_id,
                "chainName": hr_name,
                "isTestnet": chain_testnet,
                "network": registry_name,
                "providers": [
                    {
                        "data": datasource_data,
                        "dataSourceUrl": f"https://v2.archive.subsquid.io/network/{data_source_id}",
                        "provider": "subsquid",
                        "release": "ArrowSquid",
                        "supportTier": support_tier,
                    }
                ],
            }
        case "evm":
            chain_id = Prompt.ask("Chain ID", default="null")
            datasource_data = ["blocks", "tx"]
            if Confirm.ask("Datasource supports logs?", default=True):
                datasource_data.append("logs")
            if Confirm.ask("Datasource supports traces?", default=False):
                datasource_data.append("traces")
            if Confirm.ask("Datasource supports statediffs?", default=False):
                datasource_data.append("stateDiffs")
            logo_url = Prompt.ask("Logo url (only name if in /img/networks)", default="null")
            if logo_url == "null":
                logo_url = None
            elif not logo_url.startswith("http://") and not logo_url.startswith("https://"):
                logo_url = "https://cdn.subsquid.io/img/networks/" + logo_url
            entry = {
                "id": data_source_id,
                "chainId": int(chain_id) if chain_id.isdecimal() else None,
                "chainName": hr_name,
                "isTestnet": chain_testnet,
                "network": registry_name,
                "logoUrl": logo_url,
                "providers": [
                    {
                        "data": datasource_data,
                        "dataSourceUrl": f"https://v2.archive.subsquid.io/network/{data_source_id}",
                        "provider": "subsquid",
                        "release": "ArrowSquid",
                        "supportTier": support_tier,
                    }
                ],
            }
        case "substrate":
            chain_ss58_prefix = Prompt.ask("Chain SS58 Prefix", default="null")
            genesis_hash = Prompt.ask("Genesis hash", default="")
            datasource_data = ["blocks", "calls", "events", "extrinsics"]
            entry = {
                "id": data_source_id,
                "chainName": hr_name,
                "chainSS58Prefix": (
                    int(chain_ss58_prefix) if chain_ss58_prefix.isdecimal() else None
                ),
                "genesis_hash": genesis_hash,
                "isTestnet": chain_testnet,
                "network": registry_name,
                "providers": [
                    {
                        "data": datasource_data,
                        "dataSourceUrl": f"https://v2.archive.subsquid.io/network/{data_source_id}",
                        "provider": "subsquid",
                        "release": "ArrowSquid",
                        "supportTier": support_tier,
                    }
                ],
            }
        case _:
            raise ValueError("Archive variant is not supported")
    syntax = Syntax(
        json.dumps(entry, indent=2), "json", theme="monokai", line_numbers=True
    )
    console.print(
        f"\nFollowing entry will be added to 'src/archives/{parsed_args.variant}.json':"
    )
    console.print(syntax)
    confirm = Confirm.ask("Ok?", default=True)
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
