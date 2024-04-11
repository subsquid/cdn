import argparse

from scripts.archives import add_command, sort_command


if __name__ == "__main__":
    program = argparse.ArgumentParser(
        description="Processes actions for archives CDN",
    )
    subparser = program.add_subparsers()
    add_command.update_parser(subparser.add_parser("add"))
    sort_command.update_parser(subparser.add_parser("sort"))
    parsed_args = program.parse_args()
    parsed_args.func(parsed_args)
