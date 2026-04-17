#!/usr/bin/env python3
"""
Remove legacy "plain" room IDs (no `gameType#` in DynamoDB `roomId`) and/or the
orphaned API Gateway resource `/rooms/{roomId}` left over before `/rooms/by-code/...`.

Uses only **AWS CLI** (`aws`) + stdlib — no boto3 / pip (avoids PEP 668 Homebrew Python issues).

Requires: AWS CLI v2 configured (`aws sts get-caller-identity`). Region: ``AWS_REGION`` (default us-west-2).

Usage:
  python3 scripts/cleanup_legacy_room_ids.py dynamodb
  python3 scripts/cleanup_legacy_room_ids.py dynamodb --execute
  python3 scripts/cleanup_legacy_room_ids.py apigw --rest-api-id "$(terraform output -raw rest_api_id)"
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys


def _region() -> str:
    return os.environ.get("AWS_REGION", "us-west-2")


def _ensure_aws_cli() -> None:
    if not shutil.which("aws"):
        print(
            "AWS CLI not found in PATH. Install v2:\n"
            "  https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html\n",
            file=sys.stderr,
        )
        sys.exit(1)


def _aws_json(cli_args: list[str]) -> dict:
    """Run: aws --region R --output json <cli_args...>"""
    cmd = ["aws", "--region", _region(), "--output", "json", *cli_args]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        msg = (proc.stderr or proc.stdout or "").strip() or f"command failed: {' '.join(cmd)}"
        raise RuntimeError(msg)
    out = proc.stdout.strip()
    if not out:
        return {}
    return json.loads(out)


def _aws_run(cli_args: list[str]) -> None:
    cmd = ["aws", "--region", _region(), *cli_args]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        msg = (proc.stderr or proc.stdout or "").strip() or f"command failed: {' '.join(cmd)}"
        raise RuntimeError(msg)


def _is_legacy_room_id(room_id: str) -> bool:
    return isinstance(room_id, str) and room_id and "#" not in room_id


def _post_order_subtree(items: list[dict], root_id: str) -> list[str]:
    by_parent: dict[str, list[str]] = {}
    for it in items:
        pid = it.get("parentId")
        if not pid:
            continue
        by_parent.setdefault(pid, []).append(it["id"])

    out: list[str] = []

    def walk(rid: str) -> None:
        for cid in by_parent.get(rid, []):
            walk(cid)
        out.append(rid)

    walk(root_id)
    return out


def cmd_apigw(rest_api_id: str) -> None:
    _ensure_aws_cli()

    items: list[dict] = []
    position: str | None = None
    while True:
        args = ["apigateway", "get-resources", "--rest-api-id", rest_api_id, "--limit", "500"]
        if position:
            args.extend(["--position", position])
        data = _aws_json(args)
        items.extend(data.get("items", []))
        position = data.get("position")
        if not position:
            break

    legacy = [i for i in items if i.get("path") == "/rooms/{roomId}"]
    if not legacy:
        print("No API resource with path /rooms/{roomId} found (already removed).")
        return

    root_id = legacy[0]["id"]
    order = _post_order_subtree(items, root_id)
    print(f"Deleting API Gateway subtree under /rooms/{{roomId}} ({len(order)} resources): {order}")

    for rid in order:
        try:
            r = _aws_json(["apigateway", "get-resource", "--rest-api-id", rest_api_id, "--resource-id", rid])
        except RuntimeError as exc:
            if "NotFoundException" in str(exc):
                continue
            raise
        methods = list((r.get("resourceMethods") or {}).keys())
        for http in methods:
            print(f"  delete-method {rid} {http}")
            _aws_run(
                [
                    "apigateway",
                    "delete-method",
                    "--rest-api-id",
                    rest_api_id,
                    "--resource-id",
                    rid,
                    "--http-method",
                    http,
                ]
            )
        print(f"  delete-resource {rid}")
        _aws_run(["apigateway", "delete-resource", "--rest-api-id", rest_api_id, "--resource-id", rid])

    print("Done. Run `terraform apply` so API deployments / stage stay consistent.")


def _scan_delete_plain_room_ids(table: str, execute: bool, pk_field: str) -> int:
    fe = "attribute_exists(roomId) AND NOT contains(roomId, :h)"
    eav = {":h": {"S": "#"}}
    proj = pk_field if pk_field == "roomId" else f"{pk_field}, roomId"
    deleted = 0
    start_key: dict | None = None

    while True:
        args = [
            "dynamodb",
            "scan",
            "--table-name",
            table,
            "--filter-expression",
            fe,
            "--expression-attribute-values",
            json.dumps(eav),
            "--projection-expression",
            proj,
        ]
        if start_key:
            args.extend(["--exclusive-start-key", json.dumps(start_key)])
        page = _aws_json(args)

        for it in page.get("Items", []):
            room_val = it.get("roomId", {}).get("S")
            if not room_val or not _is_legacy_room_id(room_val):
                continue
            pk_val = it.get(pk_field, {}).get("S")
            if not pk_val:
                continue
            print(
                f"  {'DELETE' if execute else 'would delete'} {table!r} "
                f"{pk_field}={pk_val!r} roomId={room_val!r}"
            )
            if execute:
                key = json.dumps({pk_field: {"S": pk_val}})
                _aws_run(["dynamodb", "delete-item", "--table-name", table, "--key", key])
            deleted += 1

        start_key = page.get("LastEvaluatedKey")
        if not start_key:
            break
    return deleted


def cmd_dynamodb(project: str, execute: bool) -> None:
    _ensure_aws_cli()

    tables: list[tuple[str, str]] = [
        (f"{project}-rooms", "roomId"),
        (f"{project}-connections", "connectionId"),
        (f"{project}-battleship-games", "roomId"),
        (f"{project}-chess-games", "roomId"),
        (f"{project}-gomoku-games", "roomId"),
        (f"{project}-uno-games", "roomId"),
    ]

    total = 0
    for t, pk in tables:
        print(f"Scan {t} …")
        try:
            n = _scan_delete_plain_room_ids(t, execute, pk_field=pk)
        except Exception as exc:  # noqa: BLE001
            print(f"  skip ({exc})")
            continue
        print(f"  matched legacy rows: {n}")
        total += n

    if not execute and total:
        print(f"\nDry-run only. Re-run with --execute to delete {total} item(s).")
    elif execute:
        print(f"\nDeleted {total} item(s) (keys without '#').")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    pa = sub.add_parser("apigw", help="Remove /rooms/{roomId} from API Gateway REST API")
    pa.add_argument("--rest-api-id", required=True, help="REST API id (same as Terraform aws_api_gateway_rest_api.rest)")

    pd = sub.add_parser("dynamodb", help="Remove DynamoDB items whose roomId has no '#' (old scheme)")
    pd.add_argument("--project", default=os.environ.get("TF_VAR_project", "game-platform"), help="Table name prefix")
    pd.add_argument("--execute", action="store_true", help="Actually delete (default is dry-run)")

    args = p.parse_args()
    if args.cmd == "apigw":
        cmd_apigw(args.rest_api_id)
    else:
        cmd_dynamodb(args.project, args.execute)


if __name__ == "__main__":
    main()
