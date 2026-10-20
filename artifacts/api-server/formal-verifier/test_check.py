"""Independent mathematical and adversarial fixtures for the bounded checker."""
import copy
import json
import pathlib
import subprocess
import sys
import unittest

from check import MAX_INPUT, MAX_NODES, MAX_SYMBOLS, MAX_DEFINITIONS, MAX_CLAIMS, verify

HERE = pathlib.Path(__file__).resolve().parent
DIGEST = "a" * 64


def S(n): return {"op": "symbol", "name": n}
def I(n): return {"op": "integer", "value": n}
def A(*args): return {"op": "add", "args": list(args)}
def M(*args): return {"op": "mul", "args": list(args)}
def D(n, d): return {"op": "div", "numerator": n, "denominator": d}
def P(b, e): return {"op": "pow", "base": b, "exponent": e}
def DX(e, x="x"): return {"op": "diff", "expr": e, "variable": x}
def SUB(e, **values): return {"op": "substitute", "expr": e, "values": values}


def symbol(n, domain="real", dims=None):
    return {"name": n, "label": n, "domain": domain, "dimensions": dims or [0, 0, 0]}


def package(lhs, rhs, symbols=None, definitions=None):
    return {
        "schemaVersion": "formal-lab-v1", "title": "Independent fixture", "authors": "Fixture",
        "source": {"title": "Test", "url": "", "version": "1", "excerpt": ""},
        "selectedInputs": [], "mainClaim": "Fixture", "assumptions": [],
        "symbols": symbols or [symbol("x")], "definitions": definitions or [],
        "claims": [{"id": "claim", "title": "Test identity", "lhs": lhs, "rhs": rhs, "explanation": ""}],
        "consequences": [], "limitations": [],
    }


def run(pkg):
    return verify({"package": pkg, "packageDigest": DIGEST})


def thermal_fixture():
    # Independent fixture transcribed from the one-page thermal equations.
    symbols = [symbol("A", "positive", [0, 2, 0]), symbol("L", "positive", [0, 1, 0]),
               symbol("c", "positive", [0, 1, -1]), symbol("G", "positive", [-1, 3, -2]),
               symbol("pi", "positive"), symbol("hbar", "positive", [1, 2, -1, 0, 0, 0, 0]),
               symbol("kB", "positive", [1, 2, -2, 0, -1, 0, 0]),
               symbol("ell2", "positive", [0, 2, 0]), symbol("T", "positive", [0, 0, 0, 0, 1, 0, 0]),
               symbol("S", "positive", [1, 2, -2, 0, -1, 0, 0]),
               symbol("U", "positive", [1, 2, -2]), symbol("Pi", "positive", [1, 0, -2])]
    definitions = [
        {"symbol": "ell2", "expression": D(M(S("hbar"), S("G")), P(S("c"), 3))},
        {"symbol": "T", "expression": D(M(S("hbar"), S("c")), M(I(2), S("pi"), S("kB"), S("L")))},
        {"symbol": "S", "expression": D(M(S("kB"), S("A")), M(I(4), S("ell2")))},
        {"symbol": "U", "expression": D(M(P(S("c"), 4), S("A")), M(I(8), S("pi"), S("G"), S("L")))},
        {"symbol": "Pi", "expression": D(S("U"), S("A"))}]
    return package(M(S("T"), S("S")), S("U"), symbols, definitions)


class CheckerTests(unittest.TestCase):
    def assert_status(self, pkg, status):
        report = run(pkg)
        self.assertEqual(report["claims"][0]["status"], status, report)
        return report

    def example(self):
        return json.loads((HERE.parent / "src" / "formal" / "example.json").read_text())

    def test_actual_area_length_and_schwarzschild_example(self):
        report = run(self.example())
        self.assertEqual(len(report["claims"]), 10)
        self.assertEqual(report["status"], "checked", report)
        self.assertTrue(all(c["residual"] == "0" and c["dimensions"] == "consistent" for c in report["claims"]))
        self.assertTrue(report["checkedAt"].endswith("Z"))
        self.assertEqual(report["packageDigest"], DIGEST)
        self.assertEqual(report["engine"], "SymPy 1.14.0")

    def test_independent_sign_and_factor_mutations(self):
        for factor in (-1, 2):
            pkg = self.example()
            pkg["claims"][0]["rhs"] = M(I(factor), S("Pi"))
            report = run(pkg)
            self.assertEqual(report["status"], "partial", report)
            self.assertEqual(report["claims"][0]["status"], "contradicted")
            self.assertTrue(all(c["status"] == "checked" for c in report["claims"][1:]))
            self.assertIn("individual value", report["claims"][0]["message"])

    def test_dimensional_error_stays_local_to_claim(self):
        pkg = self.example()
        pkg["claims"][0]["rhs"] = S("R")
        report = run(pkg)
        self.assertEqual(report["status"], "partial", report)
        self.assertEqual(report["claims"][0]["dimensions"], "mismatch")
        self.assertEqual(report["claims"][0]["status"], "contradicted")
        self.assertTrue(all(c["status"] == "checked" for c in report["claims"][1:]))

    def test_exact_rational_derivative(self):
        pkg = package(DX(D(P(S("x"), 3), I(3))), P(S("x"), 2))
        self.assert_status(pkg, "checked")

    def test_unknown_pole_is_not_cancelled_away(self):
        report = self.assert_status(package(D(S("x"), S("x")), I(1)), "unsupported")
        self.assertIn("x != 0", " ".join(report["claims"][0]["domainRestrictions"]))

    def test_explicit_nonzero_and_positive_domains_allow_cancellation(self):
        for domain in ("nonzero", "positive"):
            self.assert_status(package(D(S("x"), S("x")), I(1), [symbol("x", domain)]), "checked")

    def test_zero_denominator_cannot_hide_in_zero_product(self):
        expr = M(I(0), D(I(1), A(S("x"), M(I(-1), S("x")))))
        self.assert_status(package(expr, I(0)), "unsupported")

    def test_hidden_pole_in_expression_that_reduces_to_zero(self):
        expr = A(D(S("x"), S("x")), I(-1))
        self.assert_status(package(expr, I(0)), "unsupported")

    def test_negative_power_requires_original_domain(self):
        self.assert_status(package(M(S("x"), P(S("x"), -1)), I(1)), "unsupported")

    def test_real_positive_sum_denominator_can_be_established(self):
        denominator = A(P(S("x"), 2), I(1))
        self.assert_status(package(D(denominator, denominator), I(1)), "checked")

    def test_substitution_applies_after_derivative(self):
        self.assert_status(package(SUB(DX(P(S("x"), 2)), x=I(3)), I(6)), "checked")
        self.assert_status(package(DX(SUB(P(S("x"), 2), x=I(3))), I(0)), "checked")

    def test_substitution_can_establish_original_pole_restriction(self):
        self.assert_status(package(SUB(D(S("x"), S("x")), x=I(3)), I(1)), "checked")
        self.assert_status(package(SUB(D(S("x"), S("x")), x=I(0)), I(1)), "unsupported")

    def test_substitution_cannot_violate_declared_domain(self):
        self.assert_status(package(SUB(P(S("x"), 2), x=I(-1)), I(1), [symbol("x", "positive")]), "unsupported")

    def test_substitution_is_simultaneous(self):
        pkg = package(SUB(A(S("x"), M(I(-1), S("y"))), x=S("y"), y=S("x")), A(S("y"), M(I(-1), S("x"))), [symbol("x"), symbol("y")])
        self.assert_status(pkg, "checked")

    def test_definitions_expand_before_independent_derivative(self):
        defs = [{"symbol": "f", "expression": P(S("x"), 2), "description": ""}]
        self.assert_status(package(DX(S("f")), M(I(2), S("x")), [symbol("x"), symbol("f")], defs), "checked")

    def test_cyclic_definitions_are_rejected(self):
        defs = [{"symbol": "x", "expression": S("y"), "description": ""}, {"symbol": "y", "expression": S("x"), "description": ""}]
        self.assert_status(package(S("x"), S("x"), [symbol("x"), symbol("y")], defs), "unsupported")

    def test_declared_positive_definition_must_actually_be_positive(self):
        defs = [{"symbol": "f", "expression": S("x"), "description": ""}]
        self.assert_status(package(S("f"), S("x"), [symbol("x"), symbol("f", "positive")], defs), "unsupported")

    def test_invalid_definition_dimensions_are_detected(self):
        defs = [{"symbol": "f", "expression": S("x"), "description": ""}]
        report = self.assert_status(package(S("f"), S("f"), [symbol("x", dims=[0, 1, 0]), symbol("f")], defs), "unsupported")
        self.assertEqual(report["claims"][0]["dimensions"], "mismatch")

    def test_zero_rhs_has_no_spurious_dimension(self):
        pkg = package(A(S("x"), M(I(-1), S("x"))), I(0), [symbol("x", dims=[0, 1, 0])])
        self.assert_status(pkg, "checked")

    def test_dimensionally_invalid_addition_is_rejected(self):
        pkg = package(A(S("x"), S("y")), I(0), [symbol("x", dims=[0, 1, 0]), symbol("y", dims=[0, 0, 1])])
        self.assert_status(pkg, "contradicted")

    def test_untrusted_code_and_unsupported_ast_never_execute(self):
        for ast in ({"op": "python", "code": "__import__('os').system('false')"},
                    {"op": "symbol", "name": "__import__('os')"},
                    {"op": "integer", "value": 1, "code": "print('bad')"},
                    {"op": "integer", "value": True},
                    {"op": "rational", "numerator": 1, "denominator": 0}):
            self.assert_status(package(ast, I(0)), "unsupported")

    def test_numeric_exponent_and_nesting_limits(self):
        for ast in (I(10**9 + 1), P(S("x"), 17), P(P(I(10**9), 16), 16)):
            self.assert_status(package(ast, I(0)), "unsupported")
        deep = S("x")
        for _ in range(40): deep = M(deep)
        self.assert_status(package(deep, I(0)), "unsupported")

    def test_expansion_limit_precedes_combinatorial_algebra(self):
        self.assert_status(package(P(A(S("x"), I(1)), 16), I(0)), "unsupported")

    def test_duplicate_symbols_claims_and_bad_digest(self):
        self.assert_status(package(S("x"), I(0), [symbol("x"), symbol("x")]), "unsupported")
        pkg = package(S("x"), I(0))
        pkg["claims"].append(copy.deepcopy(pkg["claims"][0]))
        report = run(pkg)
        self.assertEqual(report["status"], "failed")
        self.assertEqual(verify({"package": pkg, "packageDigest": "fake"})["status"], "failed")

    def test_nonzero_polynomial_is_not_claimed_pointwise_false(self):
        report = self.assert_status(package(P(S("x"), 2), I(1)), "contradicted")
        self.assertIn("not an identity", report["claims"][0]["message"])
        self.assertNotEqual(report["claims"][0]["residual"], "0")

    def test_full_si_units_and_legacy_units_normalize_together(self):
        pkg = package(S("q"), S("work"),
                      [symbol("q", dims=[1, 2, -2]), symbol("work", dims=[1, 2, -2, 0, 0, 0, 0])],
                      [{"symbol": "work", "expression": S("q")}])
        self.assert_status(pkg, "checked")
        pkg = package(S("T"), S("energy"),
                      [symbol("T", dims=[0, 0, 0, 0, 1, 0, 0]), symbol("energy", dims=[1, 2, -2])])
        report = self.assert_status(pkg, "contradicted")
        self.assertEqual(report["claims"][0]["dimensions"], "mismatch")
        self.assertIn("SI dimensions", report["claims"][0]["message"])

    def test_temperature_energy_conversion_and_thermal_product(self):
        pkg = thermal_fixture()
        self.assert_status(pkg, "checked")
        pkg["claims"][0]["lhs"] = M(S("T"), DX(S("S"), "A"))
        pkg["claims"][0]["rhs"] = S("Pi")
        report = self.assert_status(pkg, "checked")
        self.assertEqual(report["checker"], "formal-lab-sympy-v2")
        self.assertEqual(report["claims"][0]["derivationKind"], "identity")
        trace = " ".join(report["claims"][0]["steps"])
        for phrase in ("Expanded approved definitions", "exact derivatives", "SI dimensions", "residual = 0"):
            self.assertIn(phrase, trace)
        pkg["claims"][0]["rhs"] = M(I(2), S("Pi"))
        self.assert_status(pkg, "contradicted")

    def test_schwarzschild_mass_first_law_from_selected_family(self):
        pkg = thermal_fixture()
        pkg["symbols"].extend([symbol("R", "positive", [0, 1, 0]), symbol("Mass", "positive", [1, 0, 0])])
        pkg["definitions"].append({"symbol": "Mass", "expression": D(M(P(S("c"), 2), S("R")), M(I(2), S("G")))})
        family = {"A": M(I(4), S("pi"), P(S("R"), 2)), "L": M(I(2), S("R"))}
        pkg["claims"] = [
            {"id": "half-mass", "title": "Boundary potential is half Schwarzschild mass energy", "lhs": SUB(S("U"), **family), "rhs": D(M(S("Mass"), P(S("c"), 2)), I(2))},
            {"id": "first-law", "title": "Standard mass first law along the chosen family", "lhs": DX(M(S("Mass"), P(S("c"), 2)), "R"), "rhs": M(SUB(S("T"), **family), DX(SUB(S("S"), **family), "R"))},
            {"id": "split", "title": "Mass decomposition", "lhs": M(S("Mass"), P(S("c"), 2)), "rhs": M(I(2), SUB(M(S("T"), S("S")), **family))}]
        report = run(pkg)
        self.assertEqual(report["status"], "checked", report)
        self.assertEqual(len(report["claims"]), 3)
        self.assertIn("simultaneous substitutions", " ".join(report["claims"][1]["steps"]))

    def test_frw_scalar_consequences_under_explicit_equilibrium_inputs(self):
        pkg = thermal_fixture()
        pkg["symbols"] = [s for s in pkg["symbols"] if s["name"] not in ("A", "L")]
        pkg["symbols"].extend([symbol("R", "positive", [0, 1, 0]), symbol("A", "positive", [0, 2, 0]),
                               symbol("L", "positive", [0, 1, 0]), symbol("V", "positive", [0, 3, 0]),
                               symbol("rho", "positive", [1, -1, -2]), symbol("Pscreen", "positive", [1, -1, -2]),
                               symbol("pm", "real", [1, -1, -2]), symbol("H", "positive", [0, 0, -1]),
                               symbol("accel", "real", [0, 0, -2]), symbol("rhodot", "real", [1, -1, -3]),
                               symbol("Pdot", "real", [1, -1, -3])])
        pkg["definitions"].extend([
            {"symbol": "A", "expression": M(I(4), S("pi"), P(S("R"), 2))},
            {"symbol": "L", "expression": S("R")},
            {"symbol": "V", "expression": D(M(I(4), S("pi"), P(S("R"), 3)), I(3))},
            {"symbol": "rho", "expression": D(M(I(3), P(S("c"), 4)), M(I(8), S("pi"), S("G"), P(S("R"), 2)))},
            {"symbol": "Pscreen", "expression": D(P(S("c"), 4), M(I(8), S("pi"), S("G"), P(S("R"), 2)))},
            {"symbol": "H", "expression": D(S("c"), S("R"))},
            # These are supplied Einstein-FRW acceleration/conservation inputs,
            # not laws inferred from boundary thermodynamics by the checker.
            {"symbol": "accel", "expression": D(M(I(-4), S("pi"), S("G"), A(S("rho"), M(I(3), S("pm")))), M(I(3), P(S("c"), 2)))},
            {"symbol": "rhodot", "expression": M(I(-3), S("H"), A(S("rho"), S("pm")))},
            {"symbol": "Pdot", "expression": D(S("rhodot"), I(3))}])
        pkg["claims"] = [
            {"id": "energy", "lhs": S("U"), "rhs": M(S("rho"), S("V"))},
            {"id": "pressure", "lhs": S("Pscreen"), "rhs": D(S("rho"), I(3))},
            {"id": "friedmann", "lhs": P(S("H"), 2), "rhs": D(M(I(8), S("pi"), S("G"), S("Pscreen")), P(S("c"), 2))},
            {"id": "acceleration", "lhs": D(M(I(2), S("accel")), P(S("c"), 2)), "rhs": D(M(I(-8), S("pi"), S("G"), A(S("Pscreen"), S("pm"))), P(S("c"), 4))},
            {"id": "conservation", "lhs": A(S("Pdot"), M(S("H"), A(M(I(3), S("Pscreen")), S("pm")))), "rhs": I(0)},
            {"id": "firstlaw", "lhs": DX(S("U"), "R"), "rhs": A(M(S("T"), DX(S("S"), "R")), M(I(-1), S("Pscreen"), DX(S("V"), "R")))}]
        report = run(pkg)
        self.assertEqual(report["status"], "checked", report)
        pkg["claims"][1]["rhs"] = D(S("rho"), I(2))
        self.assertEqual(run(pkg)["claims"][1]["status"], "contradicted")

    def test_definition_restatement_is_labelled_and_still_audited(self):
        defs = [{"symbol": "f", "expression": P(S("x"), 2)}]
        pkg = package(S("f"), P(S("x"), 2), [symbol("x"), symbol("f")], defs)
        report = self.assert_status(pkg, "checked")
        self.assertEqual(report["claims"][0]["derivationKind"], "definition-restatement")
        self.assertIn("not an independent physical test", report["claims"][0]["message"])
        pkg["claims"][0]["rhs"] = S("f")
        self.assertEqual(run(pkg)["claims"][0]["derivationKind"], "definition-restatement")
        pkg["definitions"][0]["expression"] = D(S("x"), S("x"))
        self.assert_status(pkg, "unsupported")

    def test_all_seven_si_axes_remain_distinct(self):
        for index in range(7):
            dims = [0] * 7
            dims[index] = 1
            pkg = package(D(S("x"), S("x")), I(1), [symbol("x", "positive", dims)])
            self.assert_status(pkg, "checked")
            other = [0] * 7
            other[(index + 1) % 7] = 1
            pkg = package(S("x"), S("y"), [symbol("x", dims=dims), symbol("y", dims=other)])
            self.assert_status(pkg, "contradicted")

    def test_larger_packet_capacity_and_bounds(self):
        self.assertEqual((MAX_INPUT, MAX_NODES, MAX_SYMBOLS, MAX_DEFINITIONS, MAX_CLAIMS), (1024 * 1024, 16000, 120, 120, 120))
        pkg = package(S("x0"), S("x0"), [symbol(f"x{i}") for i in range(120)])
        pkg["claims"] = [{"id": f"claim-{i}", "lhs": S(f"x{i}"), "rhs": S(f"x{i}")} for i in range(120)]
        self.assertEqual(run(pkg)["status"], "checked")
        pkg["definitions"] = [{"symbol": f"x{i}", "expression": I(i)} for i in range(120)]
        self.assertEqual(run(pkg)["status"], "checked")
        pkg["definitions"].append({"symbol": "x0", "expression": I(0)})
        self.assertEqual(run(pkg)["status"], "failed")
        pkg["definitions"] = []
        pkg["symbols"].append(symbol("overflow"))
        self.assertEqual(run(pkg)["status"], "failed")
        wide = M(*(A(*(I(1) for _ in range(32))) for _ in range(32)))
        pkg = package(wide, wide)
        pkg["claims"] = [{"id": f"wide-{i}", "lhs": wide, "rhs": wide} for i in range(8)]
        report = run(pkg)
        self.assertEqual(report["status"], "failed")
        self.assertIn("node or nesting limits", report["claims"][0]["message"])
        self.assert_status(package(P(S("x"), 9), I(0)), "unsupported")
        self.assert_status(package(P(P(P(I(10**9), 8), 8), 8), I(0)), "unsupported")
        self.assert_status(package(P(P(A(S("x"), I(1)), 8), 8), I(0)), "unsupported")

    def test_cli_json_protocol_and_input_limits(self):
        payload = json.dumps({"package": package(DX(P(S("x"), 2)), M(I(2), S("x"))), "packageDigest": DIGEST})
        proc = subprocess.run([sys.executable, "-I", str(HERE / "check.py")], input=payload, text=True, capture_output=True, timeout=12)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(json.loads(proc.stdout)["status"], "checked")
        for raw in ('{"package":null,"package":null}', '{bad json', ' ' * (MAX_INPUT + 1)):
            proc = subprocess.run([sys.executable, "-I", str(HERE / "check.py")], input=raw, text=True, capture_output=True, timeout=12)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertEqual(json.loads(proc.stdout)["status"], "failed")


if __name__ == "__main__":
    unittest.main()
