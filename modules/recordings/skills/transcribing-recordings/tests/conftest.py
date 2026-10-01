import sys
from pathlib import Path

# Add parent directory to path so tests can import from the skill root
sys.path.insert(0, str(Path(__file__).parent.parent))
