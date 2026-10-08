import importlib.util
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("cito_idlc", ROOT / "tools" / "cito_idlc.py")
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)


class IdlcTests(unittest.TestCase):
    def test_complex_subset_maps_to_ast_and_codegen(self):
        text = r'''
        module acme {
          enum Mode { Idle = 0, Active = 2 };
          struct Pose {
            @id(1) double x;
            @id(2) double y;
          };
          struct Telemetry {
            @id(1) Pose pose;
            @id(2) Mode mode;
            @id(3) float coefficients[4];
            @id(4) sequence<string<64>, 20> tags;
            @id(5) @optional unsigned long long timestamp;
          };
        };
        '''
        schema = mod.Parser(text).parse()
        self.assertEqual([e.canonical_name for e in schema.enums], ["acme.Mode"])
        self.assertEqual([s.canonical_name for s in schema.structs], ["acme.Pose", "acme.Telemetry"])
        telemetry = schema.structs[1]
        self.assertEqual(telemetry.fields[2].type_ref.kind, "array")
        self.assertEqual(telemetry.fields[2].type_ref.extent, 4)
        self.assertEqual(telemetry.fields[3].type_ref.kind, "sequence")
        self.assertEqual(telemetry.fields[3].type_ref.bound, 20)
        self.assertEqual(telemetry.fields[3].type_ref.element.kind, "string")
        self.assertEqual(telemetry.fields[3].type_ref.element.bound, 64)
        self.assertTrue(telemetry.fields[4].optional)
        cpp = mod.generate_cpp(schema, "telemetry.idl")
        self.assertIn('TypeBuilder("acme.Telemetry")', cpp)
        self.assertIn('cito::types::array(cito::types::scalar<float>(), 4)', cpp)
        self.assertIn('cito::types::sequence(cito::types::string(64), 20)', cpp)
        self.assertIn('template <> struct StaticCodec<acme::Telemetry>', cpp)
        self.assertIn('static constexpr bool direct = true;', cpp)
        self.assertIn('static_detail::encode_field(', cpp)
        self.assertIn('static_detail::read_field(bytes, pos)', cpp)

    def test_requires_explicit_field_id(self):
        with self.assertRaisesRegex(mod.IdlError, "requires explicit @id"):
            mod.Parser("struct P { double x; };").parse()

    def test_rejects_duplicate_field_id(self):
        with self.assertRaisesRegex(mod.IdlError, "duplicate field id"):
            mod.Parser("struct P { @id(1) double x; @id(1) double y; };").parse()

    def test_rejects_unknown_type(self):
        with self.assertRaisesRegex(mod.IdlError, "unknown referenced type"):
            mod.Parser("struct P { @id(1) Missing x; };").parse()

    def test_comments_and_nested_modules(self):
        schema = mod.Parser('''
        // comment
        module a { module b {
          /* block */ struct P { @id(1) long x; };
        }; };
        ''').parse()
        self.assertEqual(schema.structs[0].canonical_name, "a.b.P")

    def test_reorders_structs_by_dependency_for_cpp(self):
        schema = mod.Parser("""
        module a {
          struct Zed { @id(1) double x; };
          struct Alpha { @id(1) Zed z; };
        };
        """).parse()
        cpp = mod.generate_cpp(schema, "deps.idl")
        self.assertLess(cpp.index("struct Zed"), cpp.index("struct Alpha"))

    def test_rejects_duplicate_id_annotation(self):
        with self.assertRaisesRegex(mod.IdlError, "duplicate @id"):
            mod.Parser("struct P { @id(1) @id(2) double x; };").parse()


if __name__ == "__main__":
    unittest.main()
