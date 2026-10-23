#!/usr/bin/env python3
"""Deterministic v0.14 fix: Inspector property metadata fallback must not reference unbound p."""
from pathlib import Path
import sys
path=Path(sys.argv[1])
source=path.read_text(encoding="utf-8")
before="provider={node.props?.[key]||literal(p.defaultValue)}"
after="provider={node.props?.[key]||literal(meta.properties[key]?.defaultValue)}"
if source.count(before)!=1:
    raise SystemExit(f"Expected exactly one v0.14 Inspector fallback, found {source.count(before)}")
path.write_text(source.replace(before,after),encoding="utf-8")
print(f"Patched Inspector fallback in {path}")
