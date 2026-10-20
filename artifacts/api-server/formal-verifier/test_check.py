"""Independent mathematical and adversarial fixtures for the bounded checker."""
import copy
import json
import pathlib
import subprocess
import sys
import unittest

from check import MAX_INPUT, verify

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
