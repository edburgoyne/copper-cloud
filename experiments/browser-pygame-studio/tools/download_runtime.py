"""Download the pinned Pyodide core and pygame dependencies for local tests.

The experiment itself uses the CDN. This helper writes only to ignored build/.
"""
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[3]
DESTINATION = ROOT / "build" / "browser-studio-runtime-314.0.7"
BASE = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/"
CORE = ("pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json")


def download(name, expected_hash=None):
    if Path(name).name != name:
        raise ValueError(f"Unexpected runtime filename: {name!r}")
    destination = DESTINATION / name
    print(f"Downloading {name}", flush=True)
    with urllib.request.urlopen(BASE + name, timeout=60) as response:
        data = response.read()
    if expected_hash and hashlib.sha256(data).hexdigest() != expected_hash:
        raise ValueError(f"Hash mismatch for {name}")
    destination.write_bytes(data)


def main():
    DESTINATION.mkdir(parents=True, exist_ok=True)
    for name in CORE:
        download(name)
    lock = json.loads((DESTINATION / "pyodide-lock.json").read_text(encoding="utf-8"))
    packages = lock["packages"]
    pending, seen = ["pygame-ce"], set()
    while pending:
        name = pending.pop()
        if name in seen:
            continue
        seen.add(name)
        package = packages[name]
        pending.extend(package.get("depends", []))
        download(package["file_name"], package.get("sha256"))
    files = sorted(path for path in DESTINATION.iterdir() if path.is_file())
    for path in files:
        print(f"{path.name}: {path.stat().st_size:,} bytes")
    print(f"Total: {sum(path.stat().st_size for path in files):,} bytes")


if __name__ == "__main__":
    main()
