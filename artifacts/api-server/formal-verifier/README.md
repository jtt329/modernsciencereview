# Formal Lab scalar verifier

This is an independent, bounded SymPy checker for the declarative language in
`src/formal/contract.ts`. It never runs submission Python, evaluates strings as
code, fetches source URLs, or uses AI credentials. The author-approved package is
data. The AI proposes that package; this worker decides mathematical checks.

## Runtime interface

Install the pinned environment once:

```sh
python3 -m venv .formal-venv
.formal-venv/bin/pip install -r formal-verifier/requirements.txt
```

The API adapter resolves Python through `FORMAL_PYTHON`, then
`.formal-venv/bin/python`, then `python3`. It invokes the static checker with
Python isolated mode (`-I`), passes JSON through stdin, and receives one
`VerificationReport` JSON object on stdout:

```json
{"package": {"schemaVersion": "formal-lab-v1"}, "packageDigest": "64 lowercase hexadecimal characters"}
```

The abbreviated `package` above must be replaced by the complete package. The
worker echoes the supplied digest; the API is responsible for computing it from
the frozen stored package and checking the author's approval before invocation.
A worker success is never sufficient to establish authorship or semantic approval.

`checker` is `formal-lab-sympy-v1`, `engine` is `SymPy 1.14.0`, and `checkedAt` is
UTC ISO 8601. Each claim contains an exact residual, dimensional status, original
denominator restrictions, and a scoped result. The package status is `checked`
only when all claims pass; `partial` means at least one passes; otherwise `failed`.
Malformed input produces a failed report. Crashes, signals, missing runtimes, or
missing JSON output must be treated by the caller as worker failure, never pass.

## Mathematical scope and ordering

Supported operations are exact integer/rational constants, declared real scalar
symbols, addition, multiplication, division, bounded integer powers,
differentiation, and simultaneous substitution. Definitions are resolved as a
DAG. Domains are `real`, `nonzero`, and `positive`. Every definition's dimensions
and declared domain are audited against its expanded expression.

Differentiation variables and substitution keys must be independent declared
symbols. AST ordering matters:

- `substitute(diff(x^2, x), {x: 3})` is `6`.
- `diff(substitute(x^2, {x: 3}), x)` is `0`.

For the example, differentiate in independent area/length coordinates before
specializing to the Schwarzschild family. Derived symbols expand before a
requested derivative, so differentiating `U` expands its defining formula.

Dimensions are integer exponent vectors for mass, length, and time. Addition,
substitution, declared definitions, derivatives, and equality sides are checked.
Exact zero is compatible with any dimension. Temperature and other base units
are outside this version.

Original denominator and negative-power restrictions are recorded before
simplification and transformed through substitutions. For example, `x/x = 1`
is unsupported for a merely real `x`, and checked for an explicitly nonzero `x`.
Multiplying an undefined expression by zero cannot hide its pole. An unknown
restriction blocks a check even when the simplified residual would be zero.

A rational equality passes only when its exact residual reduces to zero. A
nonzero polynomial/rational residual means the proposed equality is not an
identity on the declared domain; it does not mean it is false at every point.
A dimensional mismatch within a claim is reported on that claim. A malformed or
inconsistent shared model definition can prevent checking the entire package.

Prose assumptions, citations, physical applicability, interpretations, novelty,
experimental evidence, and the main claim's faithful correspondence to the
paper are not automatically checked. A symbolic check is not a Lean proof.

## Bounds and isolation

- 512 KiB input, 2,048 AST nodes, depth 32.
- 32 symbols, 32 definitions, 24 claims, 32 operands per sum/product.
- Literal magnitude at most 1,000,000,000; input integer exponent magnitude 16.
- Conservative expanded numerator/denominator term bounds of 4,096, combined
  exponent magnitude 64, and exact-integer arithmetic size limits.
- CPU limit of 8 seconds (hard limit 9); Linux address-space limit 512 MiB;
  output-file limit 1 MiB. The API must additionally enforce a wall timeout,
  bounded stdout/stderr, and concurrency limits, and provide a minimal environment
  without service credentials. Symbolic operations are not run on API threads.

Some valid expressions are intentionally rejected by these conservative limits.
Rejected, unsupported, inconclusive, and failed execution results are not evidence
of incorrect physics. The worker does not attempt a general consistency theorem
for arbitrary physical postulates.

## Tests

From the repository root, with an environment containing the pinned dependencies:

```sh
artifacts/api-server/.formal-venv/bin/python -B -m unittest discover -s artifacts/api-server/formal-verifier -v
```

For the development environment used here:

```sh
/private/tmp/msr-formal-venv/bin/python -B -m unittest discover -s artifacts/api-server/formal-verifier -v
```

Tests cover the actual ten-claim example, independent exact derivatives, sign
and factor mutations, local dimensional failures, hidden and explicit poles,
substitution order/domains, cyclic definitions, invalid declared properties,
malicious/unsupported ASTs, input limits, and the subprocess JSON protocol.
