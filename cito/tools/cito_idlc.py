#!/usr/bin/env python3
from __future__ import annotations
import argparse, dataclasses, pathlib, re, sys
from typing import Optional

class IdlError(Exception): pass
@dataclasses.dataclass(frozen=True)
class TypeRef:
    kind:str; name:str=""; bound:int=0; extent:int=0; element:Optional['TypeRef']=None
@dataclasses.dataclass
class Field: field_id:int; name:str; type_ref:TypeRef; optional:bool=False
@dataclasses.dataclass
class StructDef:
    name:str; modules:tuple[str,...]; fields:list[Field]
    @property
    def canonical_name(self): return ".".join((*self.modules,self.name))
    @property
    def cpp_name(self): return "::".join((*self.modules,self.name))
@dataclasses.dataclass
class EnumValue: name:str; value:int
@dataclasses.dataclass
class EnumDef:
    name:str; modules:tuple[str,...]; values:list[EnumValue]
    @property
    def canonical_name(self): return ".".join((*self.modules,self.name))
    @property
    def cpp_name(self): return "::".join((*self.modules,self.name))
@dataclasses.dataclass
class Schema: structs:list[StructDef]; enums:list[EnumDef]
@dataclasses.dataclass(frozen=True)
class Token: text:str; pos:int

TOKEN=re.compile(r'(?P<W>\s+)|(?P<L>//[^\n]*)|(?P<B>/\*.*?\*/)|(?P<N>-?\d+)|(?P<S>::)|(?P<I>[A-Za-z_]\w*)|(?P<P>[@{}();,<>=\[\]])',re.S)
def tokenize(text):
    out=[]; p=0
    while p<len(text):
        m=TOKEN.match(text,p)
        if not m: raise IdlError(f"line {text.count(chr(10),0,p)+1}: unsupported token {text[p:p+20]!r}")
        if m.lastgroup not in {'W','L','B'}: out.append(Token(m.group(),p))
        p=m.end()
    return out+[Token('<eof>',len(text))]

class Parser:
    def __init__(self,text): self.text=text; self.t=tokenize(text); self.i=0; self.structs=[]; self.enums=[]; self.names={}
    def err(self,msg,t=None):
        t=t or self.t[self.i]; return IdlError(f"line {self.text.count(chr(10),0,t.pos)+1}: {msg} (got {t.text!r})")
    def at(self,x): return self.t[self.i].text==x
    def pop(self): x=self.t[self.i]; self.i+=1; return x
    def need(self,x):
        if not self.at(x): raise self.err(f"expected {x!r}")
        return self.pop()
    def ident(self):
        x=self.t[self.i]
        if not re.fullmatch(r'[A-Za-z_]\w*',x.text): raise self.err('expected identifier',x)
        self.i+=1; return x.text
    def positive(self,what):
        x=self.pop()
        if not re.fullmatch(r'\d+',x.text) or int(x.text)<=0: raise self.err(f'{what} must be a positive integer',x)
        return int(x.text)
    def parse(self): self.defs(()); self.need('<eof>'); self.resolve(); return Schema(self.structs,self.enums)
    def defs(self,mods,stop=False):
        while not self.at('<eof>') and not(stop and self.at('}')):
            if self.at('module'): self.module(mods)
            elif self.at('struct'): self.struct(mods)
            elif self.at('enum'): self.enum(mods)
            else: raise self.err('expected module, struct, or enum')
    def module(self,mods):
        self.need('module'); n=self.ident(); self.need('{'); self.defs((*mods,n),True); self.need('}'); self.need(';')
    def register(self,mods,n,k):
        q='.'.join((*mods,n))
        if q in self.names: raise self.err(f'duplicate type declaration {q}')
        self.names[q]=k
    def enum(self,mods):
        self.need('enum'); n=self.ident(); self.register(mods,n,'enum'); self.need('{'); vals=[]; names=set(); nums=set(); cur=0
        while not self.at('}'):
            vn=self.ident()
            if vn in names: raise self.err(f'duplicate enum value name {vn}')
            if self.at('='):
                self.pop(); x=self.pop()
                if not re.fullmatch(r'-?\d+',x.text): raise self.err('expected enum integer value',x)
                cur=int(x.text)
            if cur in nums: raise self.err(f'duplicate enum numeric value {cur}')
            vals.append(EnumValue(vn,cur)); names.add(vn); nums.add(cur); cur+=1
            if self.at(','): self.pop()
            else: break
        self.need('}'); self.need(';'); self.enums.append(EnumDef(n,mods,vals))
    def struct(self,mods):
        self.need('struct'); n=self.ident(); self.register(mods,n,'struct'); self.need('{'); fs=[]; ids=set(); names=set()
        while not self.at('}'):
            fid=None; opt=False
            while self.at('@'):
                self.pop(); a=self.ident()
                if a=='id':
                    if fid is not None: raise self.err('duplicate @id annotation')
                    self.need('('); fid=self.positive('field id'); self.need(')')
                elif a=='optional':
                    if opt: raise self.err('duplicate @optional annotation')
                    if self.at('('): self.pop(); self.need(')')
                    opt=True
                else: raise self.err(f'unsupported Cito IDL annotation @{a}')
            if fid is None: raise self.err('every Cito struct member requires explicit @id(N)')
            typ=self.type(mods); fn=self.ident(); dims=[]
            while self.at('['): self.pop(); dims.append(self.positive('array extent')); self.need(']')
            for d in reversed(dims): typ=TypeRef('array',extent=d,element=typ)
            self.need(';')
            if fid in ids: raise self.err(f'duplicate field id {fid}')
            if fn in names: raise self.err(f'duplicate field name {fn}')
            ids.add(fid); names.add(fn); fs.append(Field(fid,fn,typ,opt))
        self.need('}'); self.need(';'); self.structs.append(StructDef(n,mods,fs))
    def type(self,mods):
        if self.at('boolean'): self.pop(); return TypeRef('bool')
        if self.at('float'): self.pop(); return TypeRef('float32')
        if self.at('double'): self.pop(); return TypeRef('float64')
        if self.at('long'):
            self.pop()
            if self.at('long'): self.pop(); return TypeRef('int64')
            return TypeRef('int32')
        if self.at('unsigned'):
            self.pop(); self.need('long')
            if self.at('long'): self.pop(); return TypeRef('uint64')
            return TypeRef('uint32')
        if self.at('string'):
            self.pop(); b=0
            if self.at('<'): self.pop(); b=self.positive('string bound'); self.need('>')
            return TypeRef('string',bound=b)
        if self.at('sequence'):
            self.pop(); self.need('<'); e=self.type(mods); b=0
            if self.at(','): self.pop(); b=self.positive('sequence bound')
            self.need('>'); return TypeRef('sequence',bound=b,element=e)
        parts=[self.ident()]
        while self.at('::'): self.pop(); parts.append(self.ident())
        raw='.'.join(parts); return TypeRef('named',name=raw if len(parts)>1 else '.'.join((*mods,raw)))
    def resolve(self):
        def one(r,mods):
            if r.kind in {'array','sequence'}: one(r.element,mods); return
            if r.kind!='named' or r.name in self.names: return
            leaf=r.name.rsplit('.',1)[-1]
            for d in range(len(mods),-1,-1):
                q='.'.join((*mods[:d],leaf)) if d else leaf
                if q in self.names: object.__setattr__(r,'name',q); return
            raise IdlError(f'unknown referenced type {r.name}')
        for s in self.structs:
            for f in s.fields: one(f.type_ref,s.modules)

CPP={'bool':'bool','int32':'std::int32_t','uint32':'std::uint32_t','int64':'std::int64_t','uint64':'std::uint64_t','float32':'float','float64':'double','string':'std::string'}
SPEC={'bool':'cito::types::scalar<bool>()','int32':'cito::types::scalar<std::int32_t>()','uint32':'cito::types::scalar<std::uint32_t>()','int64':'cito::types::scalar<std::int64_t>()','uint64':'cito::types::scalar<std::uint64_t>()','float32':'cito::types::scalar<float>()','float64':'cito::types::scalar<double>()'}
def qcpp(n): return '::'.join(n.split('.'))
def cpp_type(r):
    if r.kind in CPP:return CPP[r.kind]
    if r.kind=='named':return qcpp(r.name)
    if r.kind=='array':return f'std::array<{cpp_type(r.element)}, {r.extent}>'
    if r.kind=='sequence':return f'std::vector<{cpp_type(r.element)}>'
    raise IdlError(f'cannot map C++ type {r.kind}')
def spec_expr(r,kinds):
    if r.kind in SPEC:return SPEC[r.kind]
    if r.kind=='string':return f'cito::types::string({r.bound})' if r.bound else 'cito::types::string()'
    if r.kind=='array':return f'cito::types::array({spec_expr(r.element,kinds)}, {r.extent})'
    if r.kind=='sequence':return f'cito::types::sequence({spec_expr(r.element,kinds)}, {r.bound})' if r.bound else f'cito::types::sequence({spec_expr(r.element,kinds)})'
    if r.kind=='named':
        c=qcpp(r.name); return f'cito::types::structure(cito::StaticType<{c}>::type())' if kinds[r.name]=='struct' else f'cito::types::enumeration(cito::StaticEnum<{c}>::type())'
    raise IdlError(f'cannot map type spec {r.kind}')
def dyn_ok(r,kinds): return r.kind in CPP or (r.kind=='named' and kinds.get(r.name)=='enum')
def namespaces(mods,open_=True): return [f'namespace {m} {{' for m in mods] if open_ else [f'}} // namespace {m}' for m in reversed(mods)]
def generate_cpp(schema,source_name='schema.idl'):
    kinds={e.canonical_name:'enum' for e in schema.enums}|{s.canonical_name:'struct' for s in schema.structs}
    def deps(r):
        if r.kind in {'array','sequence'}: return deps(r.element)
        return {r.name} if r.kind=='named' and kinds.get(r.name)=='struct' else set()
    pending=list(schema.structs); ordered=[]; done=set()
    while pending:
        moved=False
        for s in list(pending):
            d=set().union(*(deps(f.type_ref) for f in s.fields)); d.discard(s.canonical_name)
            if d<=done: ordered.append(s); done.add(s.canonical_name); pending.remove(s); moved=True
        if not moved: raise IdlError('cyclic or unresolved struct dependency: '+', '.join(s.canonical_name for s in pending))
    out=['#pragma once',f'// Generated by cito_idlc.py from {source_name}. Do not edit.','#include <array>','#include <cstdint>','#include <optional>','#include <string>','#include <vector>','#include <cito/static.hpp>','']
    for d in [*schema.enums,*ordered]:
        out+=namespaces(d.modules)
        if isinstance(d,EnumDef): out += [f'enum class {d.name} : std::int32_t {{',*[f'    {v.name} = {v.value},' for v in d.values],'};']
        else:
            out.append(f'struct {d.name} {{')
            for f in d.fields:
                t=cpp_type(f.type_ref); t=f'std::optional<{t}>' if f.optional else t; out.append(f'    {t} {f.name}{{}};')
            out.append('};')
        out+=namespaces(d.modules,False)+['']
    out+=['namespace cito {']
    for e in schema.enums:
        out += [f'template <> struct StaticEnum<{e.cpp_name}> {{','    static EnumType type() {',f'        auto b = EnumBuilder("{e.canonical_name}");',*[f'        b.value({v.value}, "{v.name}");' for v in e.values],'        return b.build();','    }','};','']
    for s in ordered:
        out += [
            f'template <> struct StaticType<{s.cpp_name}> {{',
            '    static Type type() {',
            f'        auto b = TypeBuilder("{s.canonical_name}");'
        ]
        for f in s.fields:
            out.append(
                f'        b.member({f.field_id}, "{f.name}", {spec_expr(f.type_ref,kinds)});')
            if f.optional:
                out.append('        b.optional();')
        out += [
            '        return b.build();',
            '    }',
            f'    static DynamicData to_dynamic(const {s.cpp_name}& value) {{',
            '        DynamicData data(type());'
        ]
        for f in s.fields:
            if f.optional:
                out.append(
                    f'        if (value.{f.name}) data.set_value("{f.name}", '
                    f'cito::to_dynamic_value(*value.{f.name}));')
            else:
                out.append(
                    f'        data.set_value("{f.name}", '
                    f'cito::to_dynamic_value(value.{f.name}));')
        out += [
            '        return data;',
            '    }',
            f'    static {s.cpp_name} from_dynamic(const DynamicData& data) {{',
            f'        {s.cpp_name} value{{}};'
        ]
        for f in s.fields:
            cpp = cpp_type(f.type_ref)
            if f.optional:
                out.append(
                    f'        if (data.has("{f.name}")) value.{f.name} = '
                    f'cito::from_dynamic_value<{cpp}>(data.value("{f.name}"));')
            else:
                out.append(
                    f'        value.{f.name} = '
                    f'cito::from_dynamic_value<{cpp}>(data.value("{f.name}"));')
        out += [
            '        return value;',
            '    }',
            '};',
            ''
        ]
    return '\n'.join(out+['} // namespace cito',''])

def main(argv=None):
    ap=argparse.ArgumentParser(description='Cito OMG-IDL subset compiler'); ap.add_argument('input',type=pathlib.Path); ap.add_argument('-o','--output',type=pathlib.Path,required=True); a=ap.parse_args(argv)
    try: schema=Parser(a.input.read_text(encoding='utf-8')).parse(); a.output.parent.mkdir(parents=True,exist_ok=True); a.output.write_text(generate_cpp(schema,a.input.name),encoding='utf-8')
    except (OSError,IdlError) as e: print(f'cito-idlc: {e}',file=sys.stderr); return 2
    return 0
if __name__=='__main__': raise SystemExit(main())
