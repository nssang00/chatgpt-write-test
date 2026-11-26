"""Small, deliberately strict subset of OMG IDL. No runtime parser."""
import hashlib
import json
import pathlib
import re
import sys

source = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
source = re.sub(r"/\*.*?\*/|//[^\n]*", "", source, flags=re.S)
tokens = re.findall(r"[A-Za-z_]\w*|\d+|[^\s]", source)
pos = 0
types = {"long": "std::int32_t", "short": "std::int16_t", "double": "double",
         "float": "float", "boolean": "bool", "string": "std::string",
         "octet": "std::uint8_t", "unsigned long": "std::uint32_t",
         "long long": "std::int64_t", "unsigned long long": "std::uint64_t"}
definitions = {}
out = ['#pragma once', '#include <intraflow.hpp>', '#include <vector>']
def take(expected=None):
    global pos
    if pos >= len(tokens):
        raise ValueError("unexpected end of IDL")
    t = tokens[pos]
    pos += 1
    if expected is not None and t != expected:
        raise ValueError("expected %s, found %s" % (expected, t))
    return t
def ident():
    t = take()
    if not re.fullmatch(r"[A-Za-z_]\w*", t):
        raise ValueError("expected identifier")
    return t
def parse_type():
    t = take()
    if t == "sequence":
        take("<")
        inner, schema = parse_type()
        take(">")
        return "std::vector<" + inner + ">", ["sequence", schema]
    if t == "unsigned":
        t += " " + take("long")
    if t in ("long", "unsigned long") and pos < len(tokens) and tokens[pos] == "long":
        take("long")
        t += " long"
    if t in types:
        return types[t], t
    if t in definitions:
        return t, definitions[t]
    raise ValueError("unsupported type: " + t)
while pos < len(tokens):
    take("struct")
    name = ident()
    if name in definitions:
        raise ValueError("duplicate struct")
    take("{")
    fields = []
    while tokens[pos] != "}":
        cpp, schema = parse_type()
        field = ident()
        take(";")
        if field in [f[1] for f in fields]:
            raise ValueError("duplicate field")
        fields.append((cpp, field, schema))
    take("}")
    take(";")
    if not fields:
        raise ValueError("empty struct unsupported")
    definition = {"name": name, "fields": [[f[1], f[2]] for f in fields]}
    definitions[name] = definition
    canonical = json.dumps(definition, separators=(",", ":"), sort_keys=True)
    digest = hashlib.sha256(canonical.encode()).hexdigest()
    out += ["struct " + name + " {"] + ["    " + f[0] + " " + f[1] + "{};" for f in fields] + ["};"]
    out.append("NLOHMANN_DEFINE_TYPE_NON_INTRUSIVE(" + ", ".join([name]+[f[1] for f in fields]) + ")")
    out += ["namespace intraflow { template<> struct Traits<"+name+"> {",
            'static const char* name() { return "'+name+'"; }',
            'static const char* hash() { return "'+digest+'"; }',
            'static const char* schema() { return R"IDL('+canonical+')IDL"; }',
            "}; }"]
pathlib.Path(sys.argv[2]).write_text("\n".join(out)+"\n", encoding="utf-8")
