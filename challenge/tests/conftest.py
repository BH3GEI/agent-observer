import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
# The participant agent is a flat set of modules (shipped as a folder to participants).
for extra in (HERE.parent / "participant_agent", HERE.parent):
    if str(extra) not in sys.path:
        sys.path.insert(0, str(extra))
