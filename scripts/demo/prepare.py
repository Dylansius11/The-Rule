#!/usr/bin/env python3
"""Prepare a fresh, separate Demo Mode testnet deployment with the shared planner."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/deploy'))
import rehearsal


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('usage: python3 scripts/demo/prepare.py CONFIG.json')
        config = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
        if not isinstance(config, dict) or config.get('deployment_kind') != 'demo':
            raise ValueError('deployment_kind must be demo')
        rehearsal.main()
    except (ValueError, OSError) as error:
        print(f'demo: {error}', file=sys.stderr)
        sys.exit(1)
