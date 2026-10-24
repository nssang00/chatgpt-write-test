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
source=source.replace(before,after)
# Keep visual selectors keyboard-searchable; this avoids virtual-menu clicks offscreen.
for before in (
    '<Select aria-label="표시 조건"',
    '<Select aria-label="목록 반복"',
    '<Select aria-label="변경할 데이터"',
    '<Select aria-label="동작 입력 값"',
):
    if source.count(before)!=1:
        raise SystemExit(f"Expected exactly one visual Select: {before}, got {source.count(before)}")
    source=source.replace(before,before.replace('<Select ', '<Select showSearch optionFilterProp="label" '))
path.write_text(source,encoding="utf-8")
print(f"Patched Inspector fallback in {path}")
