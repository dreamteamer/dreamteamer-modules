import sys
from pathlib import Path

# The skill's scripts live in the module's skills/ folder; these tests live in the module's test/
# folder so they never ship inside the skill or get copied into a harness.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'skills' / 'transcribing-recordings'))
