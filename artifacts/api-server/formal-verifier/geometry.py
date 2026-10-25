#!/usr/bin/env python3
"""Fixed Rindler geometry checks. Only a digest is accepted, never author code.
The observer's acceleration, instantaneous normal distance, and patch area are
checked in an explicitly normalized uniformly accelerated Minkowski model.
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


def run():
    a,c=s.symbols('a c',positive=True)
    rho,tau,y,z=s.symbols('rho tau y z',real=True)
    L=c**2/a
    N=1+a*rho/c**2
    rapidity=a*tau/c
    embedding=s.Matrix([(rho+L)*s.sinh(rapidity),(rho+L)*s.cosh(rapidity),y,z])
    J=embedding.jacobian([tau,rho,y,z])
    minkowski=s.diag(-1,1,1,1)
    pulled=(J.T*minkowski*J).applyfunc(s.simplify)
    target=s.diag(-c**2*N**2,1,1,1)
    assumptions=['Minkowski spacetime, uniform rectilinear acceleration a>0 and c>0.',
                 'Reference observer rho=0 uses proper time tau; domain rho>−c²/a (positive lapse).',
                 'Distance is measured along the instantaneous orthogonal rest slice, not along a photon path.']
    result=[]
    def record(id,title,expression,residuals,scope,extra=None):
        values=[s.simplify(s.trigsimp(value)) for value in residuals]
        result.append(dict(id=id,title=title,status='checked' if all(value==0 for value in values) else 'contradicted',
                           expression=expression,residual='0' if all(value==0 for value in values) else '; '.join(str(value) for value in values if value!=0)[:2000],
                           assumptions=assumptions+(extra or []),scope=scope,components=len(values)))
    record('rindler-metric-pullback','Minkowski to Rindler metric',
           'X⁰=(rho+c²/a)sinh(a tau/c), X¹=(rho+c²/a)cosh(a tau/c); ds²=−c²(1+a rho/c²)²d tau²+d rho²+dy²+dz²',
           list(pulled-target),'All 16 metric components are derived from the coordinate Jacobian.')
    inverse=target.inv()
    gamma_r_tt=-inverse[1,1]*s.diff(target[0,0],rho)/2
    u=s.Matrix([1/N,0,0,0])
    acceleration=s.Matrix([0,gamma_r_tt/N**2,0,0])
    norm_squared=(acceleration.T*target*acceleration)[0]
    record('rindler-proper-acceleration','Proper acceleration and reference clock',
           '|a(rho)|=a/(1+a rho/c²)=c²/(rho+c²/a), |a(0)|=a',
           [norm_squared-a**2/N**2,(u.T*target*u)[0]+c**2,norm_squared.subs(rho,0)-a**2],
           'Four-acceleration is calculated from the connection and normalized four-velocity; the positive norm branch follows from the declared domain.')
    tangent=s.Matrix([0,1,0,0])
    record('rindler-rest-slice-orthogonality','Instantaneous rest slice',
           'g(u,∂rho)=0',[(u.T*target*tangent)[0]],
           'Constant tau spatial slices are orthogonal to the Rindler observer; this is the specific simultaneity convention in the manuscript.')
    distance=s.integrate(s.sqrt(target[1,1]),(rho,-L,0))
    record('rindler-normal-distance','Observer–horizon normal distance',
           'distance=∫[−c²/a,0] sqrt(g_rhorho) d rho=c²/a',
           [distance-L],'The rest-slice endpoint lies on the wedge boundary. The proper length to that boundary is finite and equals c²/a; no universal curved-spacetime distance claim follows.')
    null_plus=s.Matrix([1,1,0,0]);null_minus=s.Matrix([1,-1,0,0])
    record('rindler-wedge-boundary','Null Rindler wedge boundary',
           '(X¹)²−(X⁰)²=(rho+c²/a)²; X¹=±X⁰ are null',
           [embedding[1]**2-embedding[0]**2-(rho+L)**2,(null_plus.T*minkowski*null_plus)[0],(null_minus.T*minkowski*null_minus)[0]],
           'Checks the hyperbolae and null boundary of the Rindler wedge. The boundary is a coordinate limit, not a regular timelike material surface.')
    width,height=s.symbols('width height',positive=True)
    area=width*height*s.sqrt(target[2,2]*target[3,3])
    record('rindler-area-independence','Independent planar patch area',
           'A=width×height, ∂A/∂a=∂A/∂rho=0',
           [s.diff(area,a),s.diff(area,rho)],'Transverse planar patch area can be varied independently of the normal acceleration length; this does not establish a canonical action response.')
    return result


def main():
    raw=sys.stdin.read(2049)
    if len(raw)>2048: raise ValueError('oversized')
    value=json.loads(raw)
    if not isinstance(value,dict) or set(value)!={'packageDigest'} or not isinstance(value['packageDigest'],str) or not re.fullmatch('[a-f0-9]{64}',value['packageDigest']): raise ValueError('invalid')
    print(json.dumps(dict(packageDigest=value['packageDigest'],engine='SymPy '+s.__version__,checks=run()),ensure_ascii=False))
if __name__=='__main__':
    try: main()
    except Exception:
        print('Fixed geometry checks did not complete.',file=sys.stderr)
        sys.exit(1)
