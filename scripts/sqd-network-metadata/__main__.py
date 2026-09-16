import argparse

import add_command
import sort_command
import validate_command


if __name__ == "__main__":
    program = argparse.ArgumentParser(
        description="Process actions for sqd-network metadata",
    )
    subparser = program.add_subparsers()
    add_command.update_parser(subparser.add_parser("add"))
    sort_command.update_parser(subparser.add_parser("sort"))
    validate_command.update_parser(subparser.add_parser("validate"))
    parsed_args = program.parse_args()
    parsed_args.func(parsed_args)
