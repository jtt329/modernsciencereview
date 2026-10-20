#!/usr/bin/env python3
"""Bounded exact scalar checker. Submission data is a JSON AST, never Python code.

stdin: {"package": FormalPackage, "packageDigest": "<sha256>"}
stdout: VerificationReport. No network, source execution, or credentials are used.
"""
from __future__ import annotations

import datetime
import json
import re
import sys
from dataclasses import dataclass
from typing import Any

MAX_INPUT = 1024 * 1024
MAX_NODES = 16000
MAX_DEPTH = 32
MAX_SYMBOLS = 120
MAX_DEFINITIONS = 120
MAX_CLAIMS = 120
MAX_ARGS = 32
MAX_NUMBER = 10**9
MAX_EXPONENT = 8
MAX_EXPANDED_TERMS = 4096
MAX_INTEGER_BITS = 4096
NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,39}$")
DIGEST = re.compile(r"^[0-9a-f]{64}$")


def resource_limits() -> None:
    """Additional Linux worker limits; the caller must also enforce wall time."""
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_CPU, (10, 12))
        # RLIMIT_AS is reliable on Linux; imposing it on macOS can break Python.
        if sys.platform.startswith("linux"):
            resource.setrlimit(resource.RLIMIT_AS, (512 * 1024**2, 512 * 1024**2))
        resource.setrlimit(resource.RLIMIT_FSIZE, (1024**2, 1024**2))
    except (ImportError, OSError, ValueError):
        pass


if __name__ == "__main__":
    resource_limits()

import sympy as sp  # noqa: E402 -- limits precede importing the algebra engine


class Unsupported(ValueError):
    pass


class DimensionMismatch(Unsupported):
    pass


@dataclass(frozen=True)
class Obligation:
    expression: Any
    kind: str
    reason: str


@dataclass(frozen=True)
class Value:
    expression: Any
    dimensions: tuple[int, ...] | None
    obligations: tuple[Obligation, ...] = ()


def integer(value: Any, label: str, bound: int = MAX_NUMBER) -> int:
    if type(value) is not int or abs(value) > bound:
        raise Unsupported(f"{label} must be an integer with magnitude at most {bound}.")
    return value


def name(value: Any) -> str:
    if not isinstance(value, str) or not NAME.fullmatch(value):
        raise Unsupported("Symbol names must be short ASCII identifiers.")
    return value


def dimensions(value: Any) -> tuple[int, ...]:
    if not isinstance(value, list) or len(value) not in (3, 7):
        raise Unsupported("Dimensions require 3 legacy or 7 SI integer exponents [mass, length, time, current, temperature, amount, luminous intensity].")
    result = tuple(integer(n, "Dimension exponent", 12) for n in value)
    return result + (0,) * (7 - len(result))


DIMENSIONLESS = (0,) * 7


def dim_add(a, b):
    if a is None or b is None:
        return None  # zero is compatible with any dimension
    return tuple(x + y for x, y in zip(a, b))


def budget(expression) -> None:
    """Conservatively bound expansion before calling together/cancel/diff.

    Track numerator/denominator term upper bounds. This deliberately rejects
    some tractable expressions rather than allowing combinatorial expansion.
    """
    count = 0

    def cap(n):
        if n > MAX_EXPANDED_TERMS:
            raise Unsupported("Expression exceeds the bounded algebra expansion limit.")
        return n

    def visit(e):
        nonlocal count
        count += 1
        if count > MAX_NODES * 4:
            raise Unsupported("Expanded expression has too many nodes.")
        if isinstance(e, sp.Rational):
            if abs(int(e.p)).bit_length() + int(e.q).bit_length() > MAX_INTEGER_BITS:
                raise Unsupported("Exact integer exceeds the arithmetic size limit.")
            return (1, 1)
        if isinstance(e, sp.Symbol):
            return (1, 1)
        if isinstance(e, sp.Add):
            n, d = 0, 1
            for arg in e.args:
                an, ad = visit(arg)
                n, d = cap(n * ad + an * d), cap(d * ad)
            return n, d
        if isinstance(e, sp.Mul):
            n, d = 1, 1
            for arg in e.args:
                an, ad = visit(arg)
                n, d = cap(n * an), cap(d * ad)
            return n, d
        if isinstance(e, sp.Pow) and e.exp.is_Integer:
            exponent = int(e.exp)
            if abs(exponent) > 64:
                raise Unsupported("Combined power exceeds the arithmetic size limit.")
            n, d = visit(e.base)
            n, d = cap(n ** abs(exponent)), cap(d ** abs(exponent))
            return (n, d) if exponent >= 0 else (d, n)
        # nan/zoo can arise from a pole and are rejected by its obligation.
        if e in (sp.nan, sp.zoo, sp.oo, -sp.oo):
            return 1, 1
        raise Unsupported("Expression is outside exact scalar rational algebra.")

    visit(expression)


class Compiler:
    def __init__(self, package):
        if not isinstance(package, dict) or package.get("schemaVersion") != "formal-lab-v1":
            raise Unsupported("Unsupported or missing package schema version.")
        symbol_list = package.get("symbols")
        definition_list = package.get("definitions")
        claims = package.get("claims")
        if not isinstance(symbol_list, list) or not 1 <= len(symbol_list) <= MAX_SYMBOLS:
            raise Unsupported(f"Provide between 1 and {MAX_SYMBOLS} symbols.")
        if not isinstance(definition_list, list) or len(definition_list) > MAX_DEFINITIONS:
            raise Unsupported("Too many definitions or invalid definitions list.")
        if not isinstance(claims, list) or not 1 <= len(claims) <= MAX_CLAIMS:
            raise Unsupported(f"Provide between 1 and {MAX_CLAIMS} claims.")
        self.symbols = {}
        self.metadata = {}
        self.definitions = {}
        self.cache = {}
        self.active = set()
        self.nodes = 0
        for item in symbol_list:
            if not isinstance(item, dict):
                raise Unsupported("Invalid symbol declaration.")
            symbol_name = name(item.get("name"))
            if symbol_name in self.symbols:
                raise Unsupported(f"Duplicate symbol: {symbol_name}.")
            domain = item.get("domain")
            if domain not in ("real", "nonzero", "positive"):
                raise Unsupported(f"Unsupported domain for {symbol_name}.")
            assumptions = {"real": True}
            if domain != "real":
                assumptions[domain] = True
            self.symbols[symbol_name] = sp.Symbol(symbol_name, **assumptions)
            self.metadata[symbol_name] = (domain, dimensions(item.get("dimensions")))
        for item in definition_list:
            if not isinstance(item, dict):
                raise Unsupported("Invalid definition.")
            symbol_name = name(item.get("symbol"))
            if symbol_name not in self.symbols or symbol_name in self.definitions:
                raise Unsupported("Every definition needs a unique declared symbol.")
            self.definitions[symbol_name] = item.get("expression")
        ids = set()
        for claim in claims:
            if not isinstance(claim, dict) or not isinstance(claim.get("id"), str):
                raise Unsupported("Each claim needs a string id.")
            if claim["id"] in ids or len(claim["id"]) > 100:
                raise Unsupported("Claim ids must be unique and short.")
            ids.add(claim["id"])
        # Validate all ASTs, including unused definitions, before any computation.
        for expression in self.definitions.values():
            self.validate_ast(expression)
        for claim in claims:
            self.validate_ast(claim.get("lhs"))
            self.validate_ast(claim.get("rhs"))
        # A package is an authored model, so audit every definition, not only
        # the subset a convenient claim happens to reference.
        self.global_obligations = []
        for symbol_name in self.definitions:
            self.global_obligations.extend(self.resolve(symbol_name).obligations)

    def validate_ast(self, ast, depth=0):
        self.nodes += 1
        if self.nodes > MAX_NODES or depth > MAX_DEPTH:
            raise Unsupported("Expression exceeds node or nesting limits.")
        if not isinstance(ast, dict) or not isinstance(ast.get("op"), str):
            raise Unsupported("Expression must be a declarative AST object.")
        op = ast["op"]
        fields = {
            "symbol": {"op", "name"}, "integer": {"op", "value"},
            "rational": {"op", "numerator", "denominator"},
            "add": {"op", "args"}, "mul": {"op", "args"},
            "div": {"op", "numerator", "denominator"},
            "pow": {"op", "base", "exponent"},
            "diff": {"op", "expr", "variable"},
            "substitute": {"op", "expr", "values"},
        }
        if op not in fields or set(ast) != fields[op]:
            raise Unsupported(f"Unsupported operation or fields: {op}.")
        children = []
        if op == "symbol":
            if name(ast["name"]) not in self.symbols:
                raise Unsupported("Undeclared symbol.")
        elif op == "integer":
            integer(ast["value"], "Literal")
        elif op == "rational":
            integer(ast["numerator"], "Numerator")
            integer(ast["denominator"], "Denominator")
            if ast["denominator"] == 0:
                raise Unsupported("A rational literal cannot have a zero denominator.")
        elif op in ("add", "mul"):
            if not isinstance(ast["args"], list) or not 1 <= len(ast["args"]) <= MAX_ARGS:
                raise Unsupported("An addition/product must have a bounded nonempty argument list.")
            children = ast["args"]
        elif op == "div":
            children = [ast["numerator"], ast["denominator"]]
        elif op == "pow":
            integer(ast["exponent"], "Power", MAX_EXPONENT)
            children = [ast["base"]]
        elif op == "diff":
            variable = name(ast["variable"])
            if variable not in self.symbols or variable in self.definitions:
                raise Unsupported("Differentiate only with respect to declared independent symbols.")
            children = [ast["expr"]]
        elif op == "substitute":
            if not isinstance(ast["values"], dict) or len(ast["values"]) > MAX_SYMBOLS:
                raise Unsupported("Invalid substitution map.")
            for variable in ast["values"]:
                if name(variable) not in self.symbols or variable in self.definitions:
                    raise Unsupported("Substitute only declared independent symbols.")
            children = [ast["expr"], *ast["values"].values()]
        for child in children:
            self.validate_ast(child, depth + 1)

    def resolve(self, symbol_name):
        if symbol_name not in self.definitions:
            return Value(self.symbols[symbol_name], self.metadata[symbol_name][1])
        if symbol_name in self.cache:
            return self.cache[symbol_name]
        if symbol_name in self.active:
            raise Unsupported(f"Cyclic definitions at {symbol_name}.")
        self.active.add(symbol_name)
        try:
            value = self.evaluate(self.definitions[symbol_name])
            domain, expected_dimension = self.metadata[symbol_name]
            if value.dimensions is not None and value.dimensions != expected_dimension:
                raise DimensionMismatch(f"Definition {symbol_name} does not match its declared dimensions.")
            obligations = list(value.obligations)
            if domain != "real":
                obligations.append(Obligation(value.expression, domain,
                                              f"declared {domain} definition {symbol_name}"))
            result = Value(value.expression, value.dimensions, tuple(obligations))
            self.cache[symbol_name] = result
            return result
        finally:
            self.active.remove(symbol_name)

    def evaluate(self, ast, expand_definitions=True):
        op = ast["op"]
        if op == "symbol":
            return self.resolve(ast["name"]) if expand_definitions else Value(self.symbols[ast["name"]], self.metadata[ast["name"]][1])
        if op in ("integer", "rational"):
            expr = sp.Integer(ast["value"]) if op == "integer" else sp.Rational(ast["numerator"], ast["denominator"])
            return Value(expr, None if expr == 0 else DIMENSIONLESS)
        if op in ("add", "mul"):
            values = [self.evaluate(arg, expand_definitions) for arg in ast["args"]]
            obligations = tuple(o for v in values for o in v.obligations)
            if op == "add":
                dims = {v.dimensions for v in values if v.dimensions is not None}
                if len(dims) > 1:
                    raise DimensionMismatch("Addition combines quantities with different dimensions.")
                dimension = next(iter(dims), None)
                expr = sp.Add(*(v.expression for v in values))
            else:
                dimension = DIMENSIONLESS
                for value in values:
                    dimension = dim_add(dimension, value.dimensions)
                expr = sp.Mul(*(v.expression for v in values))
        elif op == "div":
            a, b = self.evaluate(ast["numerator"], expand_definitions), self.evaluate(ast["denominator"], expand_definitions)
            obligations = a.obligations + b.obligations + (Obligation(b.expression, "nonzero", "original division denominator"),)
            dimension = None if a.dimensions is None or b.dimensions is None else tuple(x - y for x, y in zip(a.dimensions, b.dimensions))
            expr = a.expression / b.expression
        elif op == "pow":
            value = self.evaluate(ast["base"], expand_definitions)
            exponent = ast["exponent"]
            if isinstance(value.expression, sp.Rational):
                bits = abs(int(value.expression.p)).bit_length() + int(value.expression.q).bit_length()
                if bits * abs(exponent) > MAX_INTEGER_BITS:
                    raise Unsupported("Power exceeds the arithmetic size limit.")
            obligations = value.obligations
            if exponent < 0:
                obligations += (Obligation(value.expression, "nonzero", "original negative power base"),)
            expr = sp.Pow(value.expression, exponent)
            dimension = DIMENSIONLESS if exponent == 0 else (tuple(n * exponent for n in value.dimensions) if value.dimensions is not None else None)
        elif op == "diff":
            value = self.evaluate(ast["expr"], expand_definitions)
            budget(value.expression)
            expr = sp.diff(value.expression, self.symbols[ast["variable"]])
            obligations = value.obligations
            variable_dims = self.metadata[ast["variable"]][1]
            dimension = tuple(x - y for x, y in zip(value.dimensions, variable_dims)) if value.dimensions is not None else None
        elif op == "substitute":
            # AST ordering is explicit: evaluate/differentiate the inner expression
            # before applying this node's simultaneous replacements.
            value = self.evaluate(ast["expr"], expand_definitions)
            replacements = {key: self.evaluate(expr, expand_definitions) for key, expr in ast["values"].items()}
            mapping = {}
            obligations = []
            for key, replacement in replacements.items():
                domain, expected_dim = self.metadata[key]
                if replacement.dimensions is not None and replacement.dimensions != expected_dim:
                    raise DimensionMismatch(f"Substitution for {key} changes its dimensions.")
                mapping[self.symbols[key]] = replacement.expression
                obligations.extend(replacement.obligations)
                obligations.append(Obligation(replacement.expression, domain, f"substitution domain of {key}"))
            expr = value.expression.subs(mapping, simultaneous=True)
            obligations.extend(Obligation(o.expression.subs(mapping, simultaneous=True), o.kind, o.reason) for o in value.obligations)
            obligations = tuple(obligations)
            dimension = value.dimensions
        else:
            raise Unsupported("Unsupported operation.")
        budget(expr)
        if expr == 0:
            dimension = None
        return Value(expr, dimension, obligations)

    def derivation_kind(self, claim):
        """Identify direct restatements without expanding the model globally.

        This is a display classification, never a shortcut for a successful
        check. Domains, dimensions and residuals are still audited normally.
        It deliberately recognises only scalar algebraic restatements; a
        definition inside a derivative/substitution is a genuine computation.
        """
        def purely_algebraic(ast):
            if ast["op"] in ("diff", "substitute"):
                return False
            if ast["op"] in ("symbol", "integer", "rational"):
                return True
            if ast["op"] in ("add", "mul"):
                return all(purely_algebraic(arg) for arg in ast["args"])
            if ast["op"] == "div":
                return purely_algebraic(ast["numerator"]) and purely_algebraic(ast["denominator"])
            return purely_algebraic(ast["base"])

        lhs_ast, rhs_ast = claim["lhs"], claim["rhs"]
        if not purely_algebraic(lhs_ast) or not purely_algebraic(rhs_ast):
            return "identity"
        try:
            lhs = self.evaluate(lhs_ast, False).expression
            rhs = self.evaluate(rhs_ast, False).expression
            residual = lhs - rhs
            budget(residual)
            if sp.cancel(sp.together(residual)) == 0:
                return "definition-restatement"
            # A direct definition is still merely an approved input even if
            # its two written sides need elementary algebra to match.
            for direct, other in ((lhs_ast, rhs), (rhs_ast, lhs)):
                if direct["op"] == "symbol" and direct["name"] in self.definitions:
                    expression = self.definitions[direct["name"]]
                    if purely_algebraic(expression):
                        residual = self.evaluate(expression, False).expression - other
                        budget(residual)
                        if sp.cancel(sp.together(residual)) == 0:
                            return "definition-restatement"
        except (Unsupported, KeyError, TypeError, ValueError, RecursionError, MemoryError):
            pass
        return "identity"

    def operation_steps(self, claim):
        """A deterministic operations log, not a generated reasoning narrative."""
        referenced, derivatives, substitutions = set(), set(), set()

        def visit(ast):
            op = ast["op"]
            if op == "symbol":
                symbol_name = ast["name"]
                if symbol_name in self.definitions and symbol_name not in referenced:
                    referenced.add(symbol_name)
                    visit(self.definitions[symbol_name])
            elif op in ("add", "mul"):
                for arg in ast["args"]:
                    visit(arg)
            elif op == "div":
                visit(ast["numerator"])
                visit(ast["denominator"])
            elif op == "pow":
                visit(ast["base"])
            elif op == "diff":
                visit(ast["expr"])
                derivatives.add(ast["variable"])
            elif op == "substitute":
                visit(ast["expr"])
                substitutions.update(ast["values"])
                for replacement in ast["values"].values():
                    visit(replacement)

        visit(claim["lhs"])
        visit(claim["rhs"])
        steps = ["Read both sides as bounded exact scalar ASTs; no source code or expression strings were executed."]
        if referenced:
            steps.append("Expanded approved definitions: " + ", ".join(sorted(referenced)) + ".")
        if derivatives:
            steps.append("AST specifies exact derivatives with respect to independent symbols: " + ", ".join(sorted(derivatives)) + "; each operation follows its AST ordering.")
        if substitutions:
            steps.append("AST specifies simultaneous substitutions for: " + ", ".join(sorted(substitutions)) + "; inner operations were evaluated first.")
        return steps

    def domain_audit(self, obligations):
        restrictions = []
        missing = []
        seen = set()
        for obligation in obligations:
            expr, kind = obligation.expression, obligation.kind
            key = (sp.srepr(expr), kind)
            if key in seen:
                continue
            seen.add(key)
            budget(expr)
            if kind == "nonzero":
                passed = expr.is_zero is False and expr.is_finite is not False
                label = f"{expr} != 0"
            elif kind == "positive":
                passed = expr.is_positive is True
                label = f"{expr} > 0"
            else:
                passed = expr.is_real is True
                label = f"{expr} is real"
            restrictions.append(f"{label} ({'established' if passed else 'not established'}; {obligation.reason})")
            if not passed:
                missing.append(label)
        return restrictions, missing


BASE_LIMITATIONS = [
    "This checks exact scalar mathematical identities and dimensions under the listed definitions and symbol domains; it is not a Lean proof or experimental validation.",
    "Prose assumptions, source citations, novelty, explanatory importance, tensor equations, and general physical interpretations are not verified automatically.",
    "A nonzero residual means the equality is not an identity on the declared domain; it may hold at particular values.",
    "Only bounded rational/polynomial expressions and integer powers are supported. Unsupported or timed-out work is not evidence that a claim is false.",
]


def new_report(digest):
    return {
        "checker": "formal-lab-sympy-v2", "engine": f"SymPy {sp.__version__}",
        "checkedAt": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
        "packageDigest": digest if isinstance(digest, str) else "",
        "status": "failed", "claims": [], "limitations": list(BASE_LIMITATIONS),
    }


def claim_result(claim, status, message, residual="", dims="unsupported", restrictions=None):
    return {"id": str(claim.get("id", "invalid")), "title": str(claim.get("title", "Untitled claim")),
            "status": status, "residual": residual[:4000], "dimensions": dims,
            "domainRestrictions": restrictions or [], "message": message,
            "steps": ["Validation stopped: " + message[:1000]] if status == "unsupported" else []}


def verify(payload):
    digest = payload.get("packageDigest", "") if isinstance(payload, dict) else ""
    report = new_report(digest)
    package = payload.get("package") if isinstance(payload, dict) else None
    raw_claims = package.get("claims", []) if isinstance(package, dict) else []
    claims = raw_claims[:MAX_CLAIMS] if isinstance(raw_claims, list) else []
    claims = [c for c in claims if isinstance(c, dict)]
    try:
        if not isinstance(digest, str) or not DIGEST.fullmatch(digest):
            raise Unsupported("A lowercase SHA-256 package digest is required.")
        compiler = Compiler(package)
    except (Unsupported, KeyError, TypeError, RecursionError) as error:
        dims = "mismatch" if isinstance(error, DimensionMismatch) else "unsupported"
        report["claims"] = [claim_result(c, "unsupported", str(error), dims=dims) for c in claims]
        report["limitations"].append(f"Package could not be checked: {error}")
        return report
    for claim in claims:
        steps = []
        kind = "identity"
        try:
            steps = compiler.operation_steps(claim)
            kind = compiler.derivation_kind(claim)
            lhs, rhs = compiler.evaluate(claim["lhs"]), compiler.evaluate(claim["rhs"])
            obligations = (*compiler.global_obligations, *lhs.obligations, *rhs.obligations)
            restrictions, missing = compiler.domain_audit(obligations)
            dims = "consistent" if lhs.dimensions is None or rhs.dimensions is None or lhs.dimensions == rhs.dimensions else "mismatch"
            steps.append(f"Audited SI dimensions [M,L,T,I,temperature,amount,luminous intensity]: {lhs.dimensions} versus {rhs.dimensions}; exact zero is dimension-compatible.")
            steps.append(f"Audited {len(restrictions)} distinct original denominator, negative-power, definition-domain and substitution obligations: {len(missing)} unresolved.")
            if missing:
                result = claim_result(claim, "unsupported", "The approved domains do not exclude undefined regions or establish required input properties: " + "; ".join(missing), dims=dims, restrictions=restrictions)
            elif dims == "mismatch":
                result = claim_result(claim, "contradicted", "The two sides have incompatible SI dimensions.", dims=dims, restrictions=restrictions)
            else:
                raw_residual = lhs.expression - rhs.expression
                budget(raw_residual)
                residual = sp.cancel(sp.together(raw_residual))
                budget(residual)
                steps.append("Computed exact lhs - rhs, combined rational denominators and cancelled common factors; residual = " + str(residual)[:2000] + ".")
                if residual == 0:
                    result = claim_result(claim, "checked", "The exact residual is zero under the approved definitions and established domain restrictions.", "0", dims, restrictions)
                else:
                    numerator, _ = sp.fraction(residual)
                    independent_symbols = [s for n, s in compiler.symbols.items() if n not in compiler.definitions]
                    if numerator.is_polynomial(*independent_symbols):
                        result = claim_result(claim, "contradicted", "The equality is not an identity on the declared domain: its exact polynomial/rational residual is nonzero. This does not mean it is false at every individual value.", str(residual), dims, restrictions)
                    else:
                        result = claim_result(claim, "inconclusive", "The residual could not be decided by the bounded rational identity checker.", str(residual), dims, restrictions)
        except DimensionMismatch as error:
            result = claim_result(claim, "contradicted", str(error), dims="mismatch")
        except (Unsupported, KeyError, TypeError, ValueError, RecursionError, MemoryError) as error:
            result = claim_result(claim, "unsupported", str(error))
        if kind == "definition-restatement":
            steps.append("Classified as a direct definition restatement or the same algebraic expression on both sides; this does not independently justify that input physically.")
            if result["status"] == "checked":
                result["message"] += " This equality restates an approved definition or the same expression; it is not an independent physical test."
        result["derivationKind"] = kind
        result["steps"] = [*steps, *result["steps"]]
        report["claims"].append(result)
    statuses = [c["status"] for c in report["claims"]]
    report["status"] = "checked" if statuses and all(s == "checked" for s in statuses) else ("partial" if "checked" in statuses else "failed")
    return report


def no_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise Unsupported("Duplicate JSON object keys are not allowed.")
        result[key] = value
    return result


def main():
    raw = sys.stdin.buffer.read(MAX_INPUT + 1)
    try:
        if len(raw) > MAX_INPUT:
            raise Unsupported("Input exceeds the 1 MiB limit.")
        payload = json.loads(raw, object_pairs_hook=no_duplicate_keys,
                             parse_constant=lambda _: (_ for _ in ()).throw(Unsupported("Non-finite JSON numbers are forbidden.")))
        report = verify(payload)
    except (ValueError, TypeError, RecursionError, MemoryError) as error:
        report = new_report("")
        report["limitations"].append(f"Invalid verifier input: {error}")
    print(json.dumps(report, separators=(",", ":"), allow_nan=False))


if __name__ == "__main__":
    main()
