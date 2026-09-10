"""Filesystem defaults for the vendored challenge environment (example3 contract).

`EXAMPLE3_ROOT` points at the bundled public reference scenario; platform code always passes an explicit
scenario root instead of relying on these defaults. In the participant starter kit the reference scenario
lives in `scenarios/dev-reference/` next to this package, so that location is used when `challenge/reference/`
is absent.
"""

from pathlib import Path


_HERE = Path(__file__).resolve().parent
_CANDIDATES = (_HERE / "reference", _HERE.parent / "scenarios" / "dev-reference")
EXAMPLE3_ROOT = next((path for path in _CANDIDATES if path.exists()), _CANDIDATES[0])
CONFIG_DIR = EXAMPLE3_ROOT / "config"
REFERENCE_OUTPUT_DIR = EXAMPLE3_ROOT / "outputs" / "reference"
