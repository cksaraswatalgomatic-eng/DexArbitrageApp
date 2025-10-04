#!/usr/bin/env python3
"""Simple model health monitor.

Reads the model registry, prints summary of the active model,
and optionally pings the ML service health endpoint to verify
availability and metadata consistency.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.error import URLError
from urllib.request import urlopen


def load_registry(path: Path) -> Dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Registry file not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def ping_service(base_url: str, endpoint: str = "/health") -> Optional[Dict[str, Any]]:
    try:
        with urlopen(base_url.rstrip("/") + endpoint, timeout=5) as resp:  # nosec B310
            if resp.status >= 400:
                raise URLError(f"HTTP {resp.status}")
            data = resp.read()
            return json.loads(data.decode("utf-8")) if data else {}
    except URLError as exc:  # pylint: disable=broad-except
        print(f"[warn] Failed to reach service at {base_url}{endpoint}: {exc}")
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Monitor active ML model")
    parser.add_argument("--registry", default="models/registry.json", help="Path to model registry JSON")
    parser.add_argument("--service-url", default="http://127.0.0.1:8000", help="Base URL of the ML service")
    args = parser.parse_args()

    registry = load_registry(Path(args.registry))
    active_id = registry.get("active")
    print(f"Active model: {active_id}")
    print(f"Registered models: {len(registry.get('models', []))}")

    if active_id:
        entry = next((m for m in registry.get("models", []) if m.get("id") == active_id), None)
        if entry:
            print(f" - Path: {entry.get('path')}")
            print(f" - Created: {entry.get('createdAt')}")
            metrics = entry.get("metrics", {})
            if metrics:
                print(f" - Metrics: {json.dumps(metrics)}")

    health = ping_service(args.service_url)
    if health is not None:
        print(f"Service health: {health}")
    metadata = ping_service(args.service_url, "/metadata")
    if metadata:
        config = metadata.get("config", {})
        print(f"Service model task: {config.get('task')}")


if __name__ == "__main__":
    main()
