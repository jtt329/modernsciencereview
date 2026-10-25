#!/usr/bin/env python3
"""Fixed exact variational/tensor identities. Input is only a digest, never code or formulas.

The identities are mathematical prerequisites, NOT a proof that an uploaded
manuscript implements the required action, boundary polarization or corners.
"""
import json
import re
import sys

try:
    import resource
    resource.setrlimit(resource.RLIMIT_CPU, (15, 18))
    if sys.platform.startswith('linux'):
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024**2, 512 * 1024**2))
except (ImportError, OSError, ValueError):
    pass

import sympy as s


def checks():
    result = []

    def record(id, title, expression, residuals, assumptions, scope):
        residuals = [s.factor(s.cancel(x)) for x in residuals]
        zero = all(x == 0 for x in residuals)
        result.append(dict(id=id, title=title, status='checked' if zero else 'contradicted',
                           expression=expression, residual='0' if zero else '; '.join(str(x) for x in residuals if x != 0)[:3000],
                           assumptions=assumptions, scope=scope, components=len(residuals)))

    a, b, d, ha, hb, hd, e = s.symbols('a b d ha hb hd e', real=True)
    q = s.Matrix([[a, b], [b, d]])
    h = s.Matrix([[ha, hb], [hb, hd]])
    qi = q.inv()
    varied_inverse = (q + e*h).inv().diff(e).subs(e, 0)
    record('inverse-metric-variation', 'Inverse cut metric variation', 'δq⁻¹ = −q⁻¹(δq)q⁻¹',
           list(varied_inverse + qi*h*qi), ['Symmetric, invertible 2×2 cut metric; a*d-b² ≠ 0.'],
           'Exact four-component matrix identity for a general two-dimensional cut; not a null-boundary variational principle.')
    determinant_derivative = (q+e*h).det().diff(e).subs(e, 0)
    record('cut-area-variation', 'Cut area density variation', 'δ√det(q) = ½√det(q) qᴬᴮδq_AB',
           [determinant_derivative-q.det()*s.trace(qi*h)], ['Positive-definite cut metric and positive area-density branch.'],
           'Checks Jacobi’s determinant identity; the square-root formula follows on the stated positive branch.')

    # Γ is an arbitrary torsion-free connection; D = δΓ is a (1,2) tensor.
    # Check every Ricci component against the covariant derivative of D, using
    # independent symbolic coefficients rather than numeric sampling.
    n = 4
    def connection(name, upper, low1, low2):
        low1, low2 = sorted((low1, low2))
        return s.Symbol(f'{name}{upper}_{low1}_{low2}')
    def g(u, a, b): return connection('G', u, a, b)
    def v(u, a, b): return connection('D', u, a, b)
    def pd(k, u, a, b):
        a, b = sorted((a, b))
        return s.Symbol(f'dD{k}_{u}_{a}_{b}')
    def cov(k, u, a, b):
        return pd(k,u,a,b)+sum(g(u,k,j)*v(j,a,b)-g(j,k,a)*v(u,j,b)-g(j,k,b)*v(u,a,j) for j in range(n))
    palatini = []
    for aa in range(n):
        for bb in range(n):
            direct = sum(pd(c,c,aa,bb)-pd(bb,c,aa,c) for c in range(n))
            direct += sum(v(c,c,j)*g(j,aa,bb)+g(c,c,j)*v(j,aa,bb)-v(c,bb,j)*g(j,aa,c)-g(c,bb,j)*v(j,aa,c) for c in range(n) for j in range(n))
            covariant = sum(cov(c,c,aa,bb)-cov(bb,c,aa,c) for c in range(n))
            palatini.append(s.expand(direct-covariant))
    record('palatini-ricci-variation', 'Four-dimensional Palatini variation',
           'δR_ab = ∇c δΓᶜ_ab − ∇b δΓᶜ_ac', palatini,
           ['Four dimensions; torsion-free connection and torsion-preserving variation.', 'Ricci convention R_ab=∂cΓᶜ_ab−∂bΓᶜ_ac+Γᶜ_cdΓᵈ_ab−Γᶜ_bdΓᵈ_ac.'],
           'All 16 tensor-component polynomial identities checked with independent symbolic connection/variation jets; does not evaluate the manuscript’s null-boundary action.')

    # A concrete canonical momentum calculation in a regular static near-horizon
    # metric, derived from Christoffels rather than assuming the target flux.
    # N^a_bc = -Γ^a_bc + (δ^a_b Γ^d_cd + δ^a_c Γ^d_bd)/2.
    # This covers the 2013 source's static sector only; no general null/corner
    # boundary condition is inferred from this specialization.
    nn, kg, sx, sy = s.symbols('n kappa_geom sx sy', positive=True)
    ax, ay, dkg, dsx, dsy, dax, day = s.symbols('ax ay dkappa_geom dsx dsy dax day', real=True)
    lapse = kg*nn
    qx, qy = sx+ax*nn**2/2, sy+ay*nn**2/2
    metric = [-lapse**2, s.Integer(1), qx, qy]
    inverse = [1/value for value in metric]
    def dg(i,j,coordinate):
        return s.diff(metric[i],nn) if i==j and coordinate==1 else s.Integer(0)
    def christoffel(a,b,c):
        return inverse[a]*(dg(a,c,b)+dg(a,b,c)-dg(b,c,a))/2
    def momentum(a,b,c):
        return -christoffel(a,b,c)+sum(((1 if a==b else 0)*christoffel(j,c,j)+(1 if a==c else 0)*christoffel(j,b,j))/2 for j in range(4))
    variation={kg:kg+e*dkg,sx:sx+e*dsx,sy:sy+e*dsy,ax:ax+e*dax,ay:ay+e*day}
    density=lapse*s.sqrt(qx*qy)
    flux=s.Integer(0)
    for aa in range(4):
        delta_momentum=momentum(1,aa,aa).subs(variation,simultaneous=True).diff(e).subs(e,0)
        flux += density*inverse[aa]*delta_momentum
    horizon_flux=s.limit(flux,nn,0,dir='+')
    record('static-horizon-momentum-variation', 'Static horizon connection-momentum response',
           'lim(n→0⁺) √(-g) g^{ab} δNⁿ_ab = 2√σ δκ_geom',
           [horizon_flux-2*s.sqrt(sx*sy)*dkg],
           ['Four-dimensional static diagonal metric ds²=−(κ_geom n)²dt²+dn²+(sx+ax n²/2)dx²+(sy+ay n²/2)dy².',
            'κ_geom,sx,sy positive; smooth even cut-metric expansion; fixed coordinates, clock normalization and cut location.',
            'Nᵃ_bc=−Γᵃ_bc+(δᵃ_b Γᵈ_cd+δᵃ_c Γᵈ_bd)/2; outward radial orientation; vary independent metric parameters.'],
           'Christoffels, canonical connection momentum, its variation and the near-horizon limit are computed explicitly. Establishes this static-sector density coefficient only; general null polarizations, moving cuts and corner terms remain unproved.')

    A, L, c, G, k, hbar, kB = s.symbols('A L c G kappa hbar kB', positive=True)
    dA, dk, dL = s.symbols('dA dk dL', real=True)
    potential = A*c**4/(8*s.pi*G*L)
    coefficient = A*c**2/(8*s.pi*G)
    force = A*c**4/(8*s.pi*G*L**2)
    record('canonical-coordinate-variation', 'Surface-gravity to length response coefficient',
           '[Ac²/(8πG)] δκ = −[Ac⁴/(8πGL²)] δL, κ=c²/L',
           [coefficient*s.diff(c**2/L,L)+force],
           ['κ=c²/L and A is held independent while changing coordinates.', 'The canonical starting response coefficient is an input, not established by this check.'],
           'Checks the pullback coefficient and sign of a stated one-form; not its derivation from a gravitational action.')
    record('potential-force-variation', 'Potential derivative and force', '−∂U/∂L|A = F_L = U/L',
           [-s.diff(potential,L)-force,force-potential/L],
           ['U=Ac⁴/(8πGL); A and L independent; c,G positive fixed constants.'],
           'Two exact scalar equalities under the chosen potential; physical choice of potential remains an input.')
    U_k = A*k*c**2/(8*s.pi*G)
    record('canonical-product-variation', 'Area and surface-gravity product variation', 'δ(AκC) = CκδA + CAδκ, C=c²/(8πG)',
           [s.diff(U_k,A)*dA+s.diff(U_k,k)*dk-c**2/(8*s.pi*G)*(k*dA+A*dk)],
           ['Independent A,κ and fixed c,G.'],
           'Retains the area term; does not silently replace the full energy variation by its κ term.')
    T = hbar*k/(2*s.pi*c*kB)
    entropy = kB*c**3*A/(4*G*hbar)
    record('thermal-canonical-coefficient', 'Thermal momentum coefficient', 'S δT/δκ = Ac²/(8πG)',
           [entropy*s.diff(T,k)-coefficient],
           ['Unruh/Hawking temperature and Bekenstein-Hawking entropy are adopted physical inputs.'],
           'Checks normalization in restored SI units; does not independently prove the thermal laws or boundary polarization.')
    return result


def main():
    raw = sys.stdin.read(2049)
    if len(raw)>2048:
        raise ValueError('oversized input')
    data = json.loads(raw)
    if not isinstance(data,dict) or set(data)!={'packageDigest'} or not re.fullmatch('[a-f0-9]{64}', data['packageDigest']):
        raise ValueError('expected digest only')
    print(json.dumps(dict(packageDigest=data['packageDigest'],engine='SymPy '+s.__version__,checks=checks()),ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Canonical prerequisite checks did not complete.',file=sys.stderr)
        sys.exit(1)
