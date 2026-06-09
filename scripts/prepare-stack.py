#!/usr/bin/env python3
import re
import sys
from pathlib import Path


def parse_env(env_path: Path) -> dict[str, str]:
    env_vars: dict[str, str] = {}

    for raw_line in env_path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue

        match = re.match(r"^([^=]+)=(.*)$", line)
        if not match:
            continue

        key = match.group(1).strip()
        value = match.group(2).strip()
        if (value.startswith('"') and value.endswith('"')) or (
            value.startswith("'") and value.endswith("'")
        ):
            value = value[1:-1]

        env_vars[key] = value

    return env_vars


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: prepare-stack.py <stack-file> <env-file>", file=sys.stderr)
        return 1

    stack_path = Path(sys.argv[1])
    env_path = Path(sys.argv[2])

    env_vars = parse_env(env_path)
    stack_content = stack_path.read_text(encoding="utf-8-sig")

    env_block = ["    environment:"]
    for key, value in env_vars.items():
        escaped_value = value.replace("\\", "\\\\").replace('"', '\\"')
        env_block.append(f'      {key}: "{escaped_value}"')

    env_file_regex = re.compile(r"^[ \t]*env_file:([ \t]*.*(\r?\n[ \t]*-.*)*)$", re.MULTILINE)
    if not env_file_regex.search(stack_content):
        print("Error: env_file directive not found in stack file", file=sys.stderr)
        return 1

    rendered_stack = env_file_regex.sub("\n".join(env_block), stack_content)
    sys.stdout.buffer.write(rendered_stack.encode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
