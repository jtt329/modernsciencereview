import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(new URL('../artifacts/scireview/package.json', import.meta.url));
const { build } = createRequire(new URL('../artifacts/api-server/package.json', import.meta.url))('esbuild');
const katex = require('katex');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const scratch = await mkdtemp(join(tmpdir(), 'formal-math-'));
await build({ stdin: { contents: "export {formalMathSegments,formalMathLatex} from './lib/formalMath';export {default as FormalMathText} from './components/FormalMathText';", resolveDir: resolve('artifacts/scireview/src'), loader: 'tsx' }, outfile: join(scratch, 'display.mjs'), platform: 'node', bundle: true, format: 'esm', external: ['react', 'react-dom/server', 'katex'], banner: { js: `import {createRequire} from 'node:module';const require=createRequire(${JSON.stringify(resolve('artifacts/scireview/package.json'))});` }, plugins: [{ name: 'resolved-runtime', setup(b) { b.onResolve({ filter: /^(react|katex)$/ }, a => ({ path: require.resolve(a.path), external: true })); } }] });
const { formalMathSegments, FormalMathText } = await import(pathToFileURL(join(scratch, 'display.mjs')).href);
after(() => rm(scratch, { recursive: true, force: true }));
const math = value => formalMathSegments(value).filter(s => s.kind === 'math');
function checkMath(value) { for (const segment of math(value)) assert.doesNotThrow(() => katex.renderToString(segment.text, { throwOnError: true, trust: false, strict: 'ignore' }), segment.source); }

test('screenshot warnings retain the canonical superscript and render Greek/subscript notation', () => {
  const text = 'Definitions of Θ_κ^(0) and Δτ; Schwarzschild has P_R = 2P_L. The positive work quantity F_L dL differs from dU. P = ρ/3 differs from bulk p_m.';
  const found = math(text).map(s => s.text);
  assert.ok(found.includes('\\Theta{}_{\\kappa{}}^{(0)}'));
  assert.ok(found.includes('\\Delta{}\\tau{}'));
  assert.ok(found.some(s => s.includes('P_{R} = 2P_{L}')));
  assert.ok(found.includes('F_{L} dL'));
  assert.ok(found.includes('p_{m}'));
  checkMath(text);
});
test('unicode powers and compound formulas render without truncating their mathematical terms', () => {
  const formulas = ['U(A,L) = Aκc²/(8πG)', 'L = c²/κ', 'U = c⁴A/(8πGL)', 'dU = Π dA − F_L dL', 'R_A = c/H', 'a_obs', 'κ²/(8πG)', 'AdΠ = −F_L dL', 'F_L = −(∂U/∂L)_A'];
  for (const formula of formulas) { checkMath(formula); const found = math(formula); assert.ok(found.length, formula); assert.ok(found.some(s => s.text.includes('^{2}') || s.text.includes('^{4}') || s.text.includes('_{') || s.text.includes('\\Pi')), formula); }
});
test('bare multi-digit and negative exponents keep the full exponent above the baseline', () => {
  assert.equal(math('L^12')[0].text, 'L^{12}');
  assert.equal(math('x^-12')[0].text, 'x^{-12}');
  assert.equal(math('x^ab')[0].text, 'x^{ab}');
  assert.equal(math('c^4A')[0].text, 'c^{4}A');
  checkMath('L^12 + x^-12 + x^ab + c^4A');
});
test('prose, technical IDs, links, hashes and code remain literal', () => {
  const literal = 'In this review, No AI or PDF code runs. A derivative is conditional. i03 p1-l082 b1-g01_potential_length_form b1_F_L schw_pressure_kappa gpt-6.1-sol https://example.org/P_R?x=2 1a74fdf4-4e69-4e94-945e-811f742b6c86';
  assert.equal(math(literal).length, 0);
  const code = formalMathSegments('Exact `F_L = U/L` and ```$x_i$``` remain code.');
  assert.deepEqual(code.filter(s => s.kind === 'code').map(s => s.text), ['F_L = U/L', '$x_i$']);
  assert.equal(code.filter(s => s.kind === 'math').length, 0);
});
test('explicit inline, display and environment TeX stays valid', () => {
  const text = '$x_i + x_{ij}$; \\(E=mc^2\\); \\[P=\\frac{\\rho}{3}\\]; \\begin{align} F_L &= U/L \\end{align}';
  const found = math(text);
  assert.equal(found.length, 4);
  assert.equal(found.filter(s => s.display).length, 2);
  assert.equal(found[0].text, 'x_i + x_{ij}');
  checkMath(text);
});
test('numbered PDF extraction is preserved instead of guessing lost equation layout', () => {
  const raw = '2 2 4\nc Aκc c A\nL = , U ( A,L ) = = . (1)';
  assert.deepEqual(formalMathSegments(raw, true), [{ kind: 'text', text: raw }]);
  assert.ok(formalMathSegments('Explicit $x_i$ remains renderable.', true).some(s => s.kind === 'math'));
});
test('rendering produces accessible math without evaluating untrusted markup or links', () => {
  const html = renderToStaticMarkup(React.createElement(FormalMathText, { text: 'P_R = 2P_L <script>alert(1)</script> $\\href{javascript:alert(1)}{click}$' }));
  assert.match(html, /class="fl-math-text"/);
  assert.match(html, /<math /);
  assert.match(html, /application\/x-tex/);
  assert.doesNotMatch(html, /<script|href="javascript:|katex-error/);
  assert.match(html, /&lt;script&gt;/);
});
test('rendering leaves malformed author TeX visible instead of losing scientific text', () => {
  const html = renderToStaticMarkup(React.createElement(FormalMathText, { text: 'Review $\\notARealCommand{x}$ before approval.' }));
  assert.match(html, /fl-math-fallback/);
  assert.match(html, /notARealCommand/);
  assert.match(html, /before approval/);
});

test('author-supplied canonical notation renders using its fixed macro definitions', () => {
  const html = renderToStaticMarkup(React.createElement(FormalMathText, { text: '$\\hkap=\\kappa/c^2$ and $\\epsS=\\sqrt{\\det q}\\,d^2x$' }));
  assert.ok(!html.includes('fl-math-fallback'));
  assert.equal((html.match(/class="katex"/g) || []).length, 2);
  assert.match(html, /<mover accent="true"><mi>κ<\/mi>/);
  assert.match(html, /<msub><mi>ϵ<\/mi><mi>S<\/mi>/);
});

test('saved seven-page boundary notation keeps adjacent indexed factors and symbolic indices intact', () => {
  const examples = [
    ['U_∂', 'U_{\\partial }'],
    ['κ_EΠ_∂', '\\kappa{}_{E}\\Pi{}_{\\partial }'],
    ['F_LL_κ', 'F_{L}L_{\\kappa{}}'],
    ['F_LdL_κ', 'F_{L}dL_{\\kappa{}}'],
    ['2P_RdV_H', '2P_{R}dV_{H}'],
    ['κ_EP_L', '\\kappa{}_{E}P_{L}'],
    ['3P_scrV_A', '3P_{\\mathrm{scr}}V_{A}'],
    ['P_scrV_A', 'P_{\\mathrm{scr}}V_{A}'],
    ['L_CK', 'L_{\\mathrm{CK}}'],
  ];
  for (const [source, expected] of examples) {
    const found = math(source);
    assert.equal(found.map(segment => segment.source).join(''), source);
    assert.equal(found.map(segment => segment.text).join(''), expected, source);
    checkMath(source);
    const html = renderToStaticMarkup(React.createElement(FormalMathText, { text: source }));
    assert.doesNotMatch(html, /fl-math-fallback/);
  }
  const integral = math('Θ_L^(0) = −∫dτ∫_S ε_SP_LδL_s.');
  assert.equal(integral.length, 1);
  assert.match(integral[0].text, /\\int _\{S\}/);
  assert.match(integral[0].text, /\\epsilon\{\}_\{S\}P_\{L\}\\delta\{\}L_\{s\}/);
  checkMath('Θ_L^(0) = −∫dτ∫_S ε_SP_LδL_s.');
  const curvature = math('⁽²⁾R_⊥ ≡ 2ä/(ac²).');
  assert.equal(curvature.length, 1);
  assert.match(curvature[0].text, /R_\{\\perp \} \\equiv  2\\ddot\{a\}/);
  checkMath('⁽²⁾R_⊥ ≡ 2ä/(ac²).');
  assert.equal(math('b1_F_L schw_pressure_kappa u_time_series').length, 0);
  assert.equal(math('$F_{LL_κ}$')[0].text, 'F_{LL_\\kappa{}}');
});


test('Unicode hat and time derivatives retain their accent and following factors', () => {
  const formulas = ['μ = κ̂ + θ/2', 'κ̂ξ', 'δκ̂=δκ/c²', 'ρ̇+3H(ρ+p_m)=0'];
  for (const formula of formulas) {
    const found = math(formula);
    assert.equal(found.length, 1, formula);
    assert.equal(found[0].source, formula);
    checkMath(formula);
    assert.doesNotMatch(renderToStaticMarkup(React.createElement(FormalMathText, { text: formula })), /fl-math-fallback/);
  }
  assert.match(math('κ̂ξ')[0].text, /\\widehat\{\\kappa\{\}\}\\xi\{\}/);
  assert.match(math('ρ̇')[0].text, /\\dot\{\\rho\{\}\}/);
});
