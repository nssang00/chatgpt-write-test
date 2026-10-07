#!/usr/bin/env python3
import json, pathlib, sys
style_path = pathlib.Path(sys.argv[1] if len(sys.argv)>1 else "artifacts/maptiler-live/style.json")
out_path = pathlib.Path(sys.argv[2] if len(sys.argv)>2 else "artifacts/maptiler-live/style-capabilities.json")
style=json.loads(style_path.read_text())

ops=set(); paint=set(); layout=set(); sources=set(); types={}; source_layers=set()
def walk(v):
    if isinstance(v,list):
        if v and isinstance(v[0],str): ops.add(v[0])
        for x in v: walk(x)
    elif isinstance(v,dict):
        for x in v.values(): walk(x)

for layer in style.get("layers",[]):
    t=layer.get("type","<missing>"); types[t]=types.get(t,0)+1
    if layer.get("source"): sources.add(str(layer["source"]))
    if layer.get("source-layer"): source_layers.add(str(layer["source-layer"]))
    for k,v in (layer.get("paint") or {}).items(): paint.add(k); walk(v)
    for k,v in (layer.get("layout") or {}).items(): layout.add(k); walk(v)
    walk(layer.get("filter"))

report={
 "style_name":style.get("name"),
 "layer_count":len(style.get("layers",[])),
 "layer_types":dict(sorted(types.items())),
 "sources":sorted(sources),
 "source_layers":sorted(source_layers),
 "paint_properties":sorted(paint),
 "layout_properties":sorted(layout),
 "expression_operators":sorted(ops),
}
out_path.write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n")
print(json.dumps(report,indent=2,ensure_ascii=False))
