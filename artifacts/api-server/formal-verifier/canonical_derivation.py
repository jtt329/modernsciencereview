#!/usr/bin/env python3
"""Trusted finite derivation kernel. JSON AST data is parsed without eval/sympify.

This verifies a restricted scalar derivation downstream of the cited EH null
projection. It deliberately does not claim a covariant/corner action theorem.
Nonzero negative controls are successful counterexamples, not paper failures.
"""
import json
import re
import sys
try:
    import resource
    resource.setrlimit(resource.RLIMIT_CPU, (18, 20))
    if sys.platform.startswith('linux'):
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024**2, 512 * 1024**2))
except (ImportError, OSError, ValueError):
    pass
import sympy as s

NAME = re.compile(r'^[A-Za-z][A-Za-z0-9_]{0,79}$')


def match_package(package):
    """Recognize the actual independent-coordinate AST, never manuscript keywords.

    Arbitrary symbol names work: roles are inferred from SI dimensions and the
    exact expanded potential. A constrained radius-family definition is not an
    independent A,L match. Unknown AST instructions and cycles fail closed.
    """
    if not isinstance(package, dict) or set(package) != {'symbols', 'definitions', 'claims'}:
        raise ValueError('invalid package fields')
    symbols, definitions, claims = package['symbols'], package['definitions'], package['claims']
    if not isinstance(symbols,list) or len(symbols)>200 or not isinstance(definitions,list) or len(definitions)>150 or not isinstance(claims,list) or len(claims)>150:
        raise ValueError('invalid bounds')
    names, dims, domain = {}, {}, {}
    for item in symbols:
        if not isinstance(item,dict) or set(item)!={'name','dimensions','domain'} or not isinstance(item['name'],str) or not NAME.fullmatch(item['name']) or item['name'] in names:
            raise ValueError('invalid symbol')
        ds=item['dimensions']
        if not isinstance(ds,list) or len(ds) not in (3,7) or any(type(v) is not int or abs(v)>12 for v in ds):
            raise ValueError('invalid dimensions')
        if item['domain'] not in ['real','positive','nonzero']:
            raise ValueError('invalid domain')
        name=item['name'];names[name]=s.Symbol(name,positive=True) if item['domain']=='positive' else s.Symbol(name,real=True,nonzero=True) if item['domain']=='nonzero' else s.Symbol(name,real=True)
        dims[name]=tuple(ds+[0]*(7-len(ds)));domain[name]=item['domain']
    defs={}
    for item in definitions:
        if not isinstance(item,dict) or set(item)!={'symbol','expression'} or item['symbol'] not in names or item['symbol'] in defs:
            raise ValueError('invalid definition')
        defs[item['symbol']]=item['expression']
    expanded={};active=set();budget=[0]
    def symbol(name):
        if name not in names:raise ValueError('undeclared symbol')
        if name in expanded:return expanded[name]
        if name not in defs:return names[name]
        if name in active:raise ValueError('definition cycle')
        active.add(name);value=parse(defs[name]);active.remove(name);expanded[name]=value;return value
    def parse(node,depth=0):
        budget[0]+=1
        if budget[0]>25000 or depth>32 or not isinstance(node,dict):raise ValueError('AST bound')
        op=node.get('op')
        if op=='symbol' and set(node)=={'op','name'}:return symbol(node['name'])
        if op=='integer' and set(node)=={'op','value'} and type(node['value']) is int and abs(node['value'])<=1000000:return s.Integer(node['value'])
        if op=='rational' and set(node)=={'op','numerator','denominator'} and type(node['numerator']) is int and type(node['denominator']) is int and abs(node['numerator'])<=1000000 and 0<abs(node['denominator'])<=1000000:return s.Rational(node['numerator'],node['denominator'])
        if op in ['mul','add'] and set(node)=={'op','args'} and isinstance(node['args'],list) and 1<=len(node['args'])<=32:
            args=[parse(a,depth+1) for a in node['args']];return s.Mul(*args) if op=='mul' else s.Add(*args)
        if op=='div' and set(node)=={'op','numerator','denominator'}:
            den=parse(node['denominator'],depth+1)
            if den==0:raise ValueError('zero denominator')
            return parse(node['numerator'],depth+1)/den
        if op=='pow' and set(node)=={'op','base','exponent'} and type(node['exponent']) is int and abs(node['exponent'])<=12:return parse(node['base'],depth+1)**node['exponent']
        if op=='diff' and set(node)=={'op','expr','variable'} and node['variable'] in names:return s.diff(parse(node['expr'],depth+1),names[node['variable']])
        if op=='substitute' and set(node)=={'op','expr','values'} and isinstance(node['values'],dict) and len(node['values'])<=30 and all(k in names for k in node['values']):
            return parse(node['expr'],depth+1).subs({names[k]:parse(v,depth+1) for k,v in node['values'].items()},simultaneous=True)
        raise ValueError('unsupported AST')
    for name in defs:symbol(name)
    parsed=[]
    for claim in claims:
        if not isinstance(claim,dict) or set(claim)!={'id','lhs','rhs'} or not isinstance(claim['id'],str) or len(claim['id'])>160:raise ValueError('invalid claim')
        parsed.append((claim['id'],parse(claim['lhs']),parse(claim['rhs']),claim))
    def dimension(name,ds):return dims[name]==tuple(ds+[0]*4)
    def refs(node):
        if isinstance(node,list):return set().union(*(refs(v) for v in node)) if node else set()
        if not isinstance(node,dict):return set()
        own={node['name']} if node.get('op')=='symbol' else set()
        return own|set().union(*(refs(v) for v in node.values()))
    def dependency(name,seen=None):
        seen=set() if seen is None else seen
        if name in seen:return seen
        seen.add(name)
        if name in defs:
            for other in refs(defs[name]):dependency(other,seen)
        return seen
    # Audit original syntax before SymPy cancellation, so x/x does not erase
    # the excluded x=0 branch. Only provably nonzero original denominators and
    # negative-power bases can support a matched definition or claim.
    safe_definitions={}
    def original_domains_safe(node,seen=None):
        seen=set() if seen is None else seen
        if isinstance(node,list):return all(original_domains_safe(value,seen) for value in node)
        if not isinstance(node,dict):return True
        # Substitution can invalidate declared domains after an expression has
        # cancelled (for example (x/x)|x=0 with nonzero x). This small matcher
        # does not transport original obligations through substitutions; leave
        # those proof closures to the full scalar verifier instead of treating
        # the simplified result as domain-safe. Unrelated ASTs remain allowed.
        if node.get('op')=='substitute':return False
        if node.get('op')=='symbol' and node.get('name') in defs:
            name=node['name']
            if name in safe_definitions:return safe_definitions[name]
            if name in seen:return False
            safe_definitions[name]=original_domains_safe(defs[name],seen|{name})
            return safe_definitions[name]
        if node.get('op')=='div' and parse(node['denominator']).is_nonzero is not True:return False
        if node.get('op')=='pow' and node['exponent']<0 and parse(node['base']).is_nonzero is not True:return False
        return all(original_domains_safe(value,seen) for value in node.values())
    matches=[]
    for potential in defs:
        if not dimension(potential,[1,2,-2]) or not original_domains_safe({'op':'symbol','name':potential}):continue
        value=symbol(potential);free=[str(v) for v in value.free_symbols]
        if len(free)!=5:continue
        role=lambda ds:[n for n in free if dimension(n,ds)]
        aa,ll,cc,gg,pp=role([0,2,0]),role([0,1,0]),role([0,1,-1]),role([-1,3,-2]),role([0,0,0])
        if not all(len(v)==1 for v in [aa,ll,cc,gg,pp]):continue
        # Circle-constant semantics must be explicit, not inferred from dimensions.
        # Its identification with mathematical pi is additionally displayed as a
        # declared translation premise by the source-bound TypeScript wrapper.
        if not re.search(r'(?:^|_)pi$',pp[0]):continue
        A,L,c,G,pi=[names[v[0]] for v in [aa,ll,cc,gg,pp]]
        if any(n in defs or domain[n]!='positive' for n in [aa[0],ll[0],cc[0],gg[0],pp[0]]):continue
        if s.cancel(value-A*c**4/(8*pi*G*L))!=0:continue
        kappas=[n for n in defs if dimension(n,[0,1,-2]) and original_domains_safe({'op':'symbol','name':n}) and s.cancel(symbol(n)-c**2/L)==0]
        linked=[]
        for cid,left,right,raw in parsed:
            dep=set().union(*(dependency(n) for n in refs(raw))) if refs(raw) else set()
            if potential in dep and original_domains_safe(raw['lhs']) and original_domains_safe(raw['rhs']) and s.cancel(left-right)==0:linked.append(cid)
        matches.append(dict(potentialSymbol=potential,areaSymbol=aa[0],lengthSymbol=ll[0],kappaSymbol=kappas[0] if kappas else None,lightSpeedSymbol=cc[0],newtonSymbol=gg[0],piSymbol=pp[0],claimIds=linked,definitionSymbols=sorted(dependency(potential))))
    return matches


def checks():
    result=[]
    def record(id,title,expression,values,assumptions,scope,depends=(),negative=False):
        residuals=[s.factor(s.cancel(value)) for value in values];success=all(x!=0 for x in residuals) if negative else all(x==0 for x in residuals)
        raw='; '.join(str(x) for x in residuals)
        result.append(dict(id=id,title=title,status='checked' if success else 'contradicted',expression=expression,residual='0' if success else raw,rawResidual=raw,assumptions=assumptions,scope=scope,components=len(values),dependsOn=list(depends),kind='negative-control' if negative else 'derivation',expected='nonzero' if negative else 'zero'))
    A,L,c,G,k,theta,dtheta,dA,dk,dL,dv,dt,mu,dmu,beta,e=s.symbols('A L c G kappa theta dtheta dA dkappa dL dv dt mu dmu beta epsilon',positive=True)
    C=1/(8*s.pi*G)
    # 1611.03096 Eq71 is a CITED PREMISE. Compute its D=4 spin-zero
    # reduction; sigma and generator/spin-one terms are retained outside scope.
    qab=s.Matrix([[s.Symbol('q11',positive=True),s.Symbol('q12')],[s.Symbol('q12'),s.Symbol('q22',positive=True)]])
    hab=s.Matrix([[s.Symbol('h11'),s.Symbol('h12')],[s.Symbol('h12'),s.Symbol('h22')]])
    trace=s.trace(qab.inv()*hab)
    area_variation=A*trace/2
    scalar_density=A*(theta*trace/2-(k+theta)*trace)/2
    record('null-scalar-trace-reduction','Reduce the cited null tensor potential to its scalar sector',r'\frac{\epsilon_S}{2}[\frac{\theta}{2}q^{AB}\delta q_{AB}-(\widehat\kappa+\theta)q^{AB}\delta q_{AB}]=-(\widehat\kappa+\theta/2)\delta\epsilon_S',
        [scalar_density+(k+theta/2)*area_variation],['Four dimensions; cited EH null projection and 8πG normalization; shear and generator sectors controlled separately.','Positive cut determinant; δepsilon=epsilon tr(q⁻¹δq)/2.'],
        'Computes the scalar trace reduction of a cited tensor expression, not the starting EH null projection itself.')
    # Independent derivation from the actual Einstein-Hilbert boundary current
    # in a Gaussian-null chart, rather than assuming the cited scalar potential.
    # Coordinates (u,r,x,y); N:r=0; g_ur=1; g_uu=-2r*kappa_hat;
    # g_uA=r*beta_A. All cut-metric first jets and their variations are free.
    # The chart/generator/null location is fixed, so h_ur=h_uA|N=h_uu|N=0.
    metric=s.zeros(4);metric[0,1]=metric[1,0]=1
    for aa in range(2):
        for bb in range(2):metric[aa+2,bb+2]=qab[aa,bb]
    inverse=metric.inv();dg=[s.zeros(4) for _ in range(4)]
    dg[1][0,0]=-2*k
    betas=s.symbols('beta_x beta_y',real=True)
    for aa in range(2):dg[1][0,aa+2]=dg[1][aa+2,0]=betas[aa]
    for coordinate in range(4):
        for aa in range(2):
            for bb in range(aa,2):dg[coordinate][aa+2,bb+2]=dg[coordinate][bb+2,aa+2]=s.Symbol(f'qjet_{coordinate}_{aa}_{bb}',real=True)
    variation=s.zeros(4)
    for aa in range(2):
        for bb in range(2):variation[aa+2,bb+2]=hab[aa,bb]
    dh=[s.zeros(4) for _ in range(4)];dh[1][0,0]=-2*dk
    dbetas=s.symbols('dbeta_x dbeta_y',real=True)
    for aa in range(2):dh[1][0,aa+2]=dh[1][aa+2,0]=dbetas[aa]
    for coordinate in range(4):
        for aa in range(2):
            for bb in range(aa,2):dh[coordinate][aa+2,bb+2]=dh[coordinate][bb+2,aa+2]=s.Symbol(f'hjet_{coordinate}_{aa}_{bb}',real=True)
    delta_inverse=-inverse*variation*inverse
    delta_connection={}
    for upper in range(4):
        for lower1 in range(4):
            for lower2 in range(4):
                delta_connection[upper,lower1,lower2]=sum((
                    delta_inverse[upper,dd]*(dg[lower1][dd,lower2]+dg[lower2][dd,lower1]-dg[dd][lower1,lower2])+
                    inverse[upper,dd]*(dh[lower1][dd,lower2]+dh[lower2][dd,lower1]-dh[dd][lower1,lower2]))/2 for dd in range(4))
    flux=sum(inverse[aa,bb]*delta_connection[1,aa,bb] for aa in range(4) for bb in range(4))-sum(inverse[1,bb]*delta_connection[aa,aa,bb] for aa in range(4) for bb in range(4))
    qinverse=qab.inv();qdot=dg[0][2:4,2:4];hdot=dh[0][2:4,2:4]
    theta_geometry=s.trace(qinverse*qdot)/2
    delta_theta=s.trace(-qinverse*hab*qinverse*qdot+qinverse*hdot)/2
    trace_h=s.trace(qinverse*hab)
    shear_upper=qinverse*qdot*qinverse/2-theta_geometry*qinverse/2
    shear_variation=sum(shear_upper[aa,bb]*hab[aa,bb] for aa in range(2) for bb in range(2))
    flux_formula=-2*dk-s.trace(qinverse*hdot)+s.trace(qinverse*hab*qinverse*qdot)/2
    common_assumptions=['Four-dimensional Gaussian-null metric ds²=−2r*kappa_hat du²+2du dr+2r beta_A du dx^A+q_AB dx^A dx^B at r=0, with positive-definite general symmetric q_AB.',
        'Fixed null location, coordinates, generator and g_ur=1; h_uu=h_ur=h_uA=0 on the null surface; radial derivatives δg_uu,r=−2δkappa_hat and δg_uA,r=δbeta_A retained.',
        'All u/r/transverse q_AB first jets, h_AB and their first-jet variations are independent before imposing the displayed restrictions. Einstein–Hilbert boundary current and Levi-Civita connection convention are specified.']
    record('gaussian-null-eh-current','Compute the Einstein–Hilbert null boundary current from metric jets',r'g^{ab}\delta\Gamma^r_{ab}-g^{rb}\delta\Gamma^a_{ab}=-2\delta\widehat\kappa-\operatorname{tr}(q^{-1}\delta\dot q)+\tfrac12\operatorname{tr}(q^{-1}h q^{-1}\dot q)',
        [flux-flux_formula],common_assumptions,
        'All 64 connection-variation components are constructed from inverse-metric variation and metric/variation first jets. This is a direct local EH-current computation in the stated fixed Gaussian-null gauge, not an arbitrary covariant/corner theorem.')
    # Choose the oriented null boundary element -dr. The opposite orientation
    # flips every displayed canonical response, not just the final force.
    eh_oriented=-C*A*flux/2
    delta_area=A*trace_h/2
    delta_B0=C*(delta_area*(k+theta_geometry)+A*(dk+delta_theta))
    scalar_area=-C*(k+theta_geometry/2)*delta_area
    shear_form=C*A*shear_variation/2
    record('gaussian-null-scalar-projection','Derive the scalar null potential and its exact action term',r'\Theta_{EH}=\frac1{8\pi G}\!\left[-(\widehat\kappa+\theta/2)\delta\epsilon_S+\frac{\epsilon_S}{2}\sigma^{AB}\delta q_{AB}+\delta\!\left(\epsilon_S(\widehat\kappa+\theta)\right)\right]',
        [eh_oriented-scalar_area-shear_form-delta_B0],common_assumptions+['Oriented boundary element −dr; θ=tr(q⁻¹ qdot)/2; σ_AB=qdot_AB/2−θ q_AB/2; δepsilon=epsilon tr(q⁻¹h)/2.'],
        'Derives the scalar, shear and exact-variation decomposition directly. Generator variations and global endpoint/corner potentials remain outside this fixed-gauge computation.',['gaussian-null-eh-current'])
    delta_mu=dk+delta_theta/2
    delta_Bmu=C*(delta_area*(k+theta_geometry/2)+A*delta_mu)
    selected_action=eh_oriented-delta_B0+delta_Bmu
    record('gaussian-null-rate-action','Vary the explicit selected reduced boundary action',r'I_{rate}=I_{EH}-B_0+B_\mu,\quad B_0=\!\int\epsilon_S(\widehat\kappa+\theta)/(8\pi G),\quad B_\mu=\!\int\epsilon_S(\widehat\kappa+\theta/2)/(8\pi G);\quad\Theta_{rate}=\epsilon_S\delta\mu/(8\pi G)+\Theta_{shear}',
        [selected_action-C*A*delta_mu-shear_form],common_assumptions+['Fixed integration domain; B0 and Bmu are the explicitly chosen boundary functionals; no further source-dependent counterterm.'],
        'The exact boundary-function variations are computed, with the remaining shear response retained. Does not declare global corners zero.',['gaussian-null-scalar-projection'])
    # The selected functionals also differ by an endpoint area term. This is
    # not silently dropped: expansion gives epsilon*theta=du epsilon, and FTC
    # on a smooth fixed interval supplies the actual endpoint difference.
    uu,ui,uf=s.symbols('u u_initial u_final',real=True)
    epsilon_function=s.Function('epsilon')(uu)
    varied_area_function=s.Function('delta_epsilon')(uu)
    kappa_function=s.Function('kappa_hat')(uu)
    expansion_function=s.diff(epsilon_function,uu)/epsilon_function
    delta_expansion=s.diff((epsilon_function+e*varied_area_function),uu)/(epsilon_function+e*varied_area_function)
    delta_expansion=s.diff(delta_expansion,e).subs(e,0)
    shift_density=C*epsilon_function*((kappa_function+expansion_function/2)-(kappa_function+expansion_function))
    integrated_shift=s.integrate(shift_density,(uu,ui,uf))
    expected_shift=-C*(epsilon_function.subs(uu,uf)-epsilon_function.subs(uu,ui))/2
    varied_shift=s.diff(s.integrate(-C*s.diff(epsilon_function+e*varied_area_function,uu)/2,(uu,ui,uf)),e).subs(e,0)
    expected_varied_shift=-C*(varied_area_function.subs(uu,uf)-varied_area_function.subs(uu,ui))/2
    record('boundary-functional-endpoint-identity','Track the exact endpoint area term in the selected action',r'I_{rate}-I_{EH}=B_\mu-B_0=-\frac C2\int\epsilon_S\theta\,du=-\frac C2(A_f-A_i),\quad\delta(I_{rate}-I_{EH})=-\frac C2(\delta A_f-\delta A_i),\ C=(8\pi G)^{-1}',
        [shift_density+C*s.diff(epsilon_function,uu)/2,integrated_shift-expected_shift,varied_shift-expected_varied_shift],
        common_assumptions+['Smooth positive cut-area density on a fixed finite generator interval and fixed transverse integration domain; epsilon*theta=∂u epsilon by definition.','Fundamental theorem of calculus and commuting the variation with integration are adopted regularity/domain premises; cuts and endpoint coordinate labels do not vary.'],
        'Computes the density identity, symbolic endpoint integral and endpoint variation. This does not set endpoint-area variations to zero or certify other global corner terms.',['gaussian-null-rate-action'])
    constant_area,constant_area_variation=s.symbols('constant_area constant_area_variation',positive=True)
    constant_density=constant_area+e*constant_area_variation
    constant_theta=s.diff(constant_density,uu)/constant_density
    constant_shift=-C*(constant_density.subs(uu,uf)-constant_density.subs(uu,ui))/2
    record('nonexpanding-endpoint-variation','Check tangent nonexpansion controls the endpoint difference without fixing each area',r'\theta=\delta\theta=0\text{ throughout }[u_i,u_f]\Rightarrow\delta A_f=\delta A_i,\quad\delta(I_{rate}-I_{EH})=0;\quad\delta A_i\text{ need not vanish}',
        [constant_theta.subs(e,0),s.diff(constant_theta,e).subs(e,0),s.diff(constant_shift,e).subs(e,0)],
        common_assumptions+['Tangent nonexpansion holds throughout the same fixed smooth interval, not just at one cut; epsilon=A0+epsilon_parameter*deltaA0 is an explicit nonzero common-area variation.','In the general case δ(epsilon theta)=theta δε+epsilon δtheta=0 under these restrictions, so the fixed-domain endpoint difference is controlled by the preceding identity.'],
        'Demonstrates that a nonzero equal area variation at both endpoint cuts is compatible with a vanishing action-shift variation. It does not require each endpoint area to be fixed separately.',['boundary-functional-endpoint-identity'])

    fixed_subs={value:0 for value in hab};fixed_subs.update({value:0 for value in hdot})
    record('gaussian-null-fixed-cut-response','Check the direct EH response with fixed cut metric',r'\delta q_{AB}=\partial_u\delta q_{AB}=0\ \Rightarrow\ \Theta_{EH}=\epsilon_S\delta\widehat\kappa/(8\pi G)',
        [eh_oriented.subs(fixed_subs)-C*A*dk],common_assumptions+['Stronger optional subcase: fixed cut metric and its generator derivative, δq_AB=∂uδq_AB=0.'],
        'A direct local EH-action route to the same scalar coefficient in a stronger restricted subcase; it does not prove a general corner prescription.',['gaussian-null-eh-current'])
    # Nonexpansion and tangent nonexpansion do not remove a shear response.
    # Choose q=I, qdot=diag(2s,-2s), h=diag(h,-h), hdot=h*qdot.
    # Both θ and δθ are zero, yet the explicit EH flux retains A*s*h/(8πG).
    sh,hh=s.symbols('nonzero_shear nonzero_tracefree_variation',nonzero=True)
    shear_subs={qab[0,0]:1,qab[0,1]:0,qab[1,1]:1,qdot[0,0]:2*sh,qdot[0,1]:0,qdot[1,1]:-2*sh,hab[0,0]:hh,hab[0,1]:0,hab[1,1]:-hh,hdot[0,0]:2*sh*hh,hdot[0,1]:0,hdot[1,1]:2*sh*hh}
    record('nonexpanding-shear-tangency','Verify the shear counterexample really preserves nonexpansion',r'\theta=\delta\theta=0\text{ for }q=I,\ \dot q=\operatorname{diag}(2s,-2s),\ h=\operatorname{diag}(h,-h),\ \dot h=h\dot q',
        [theta_geometry.subs(shear_subs),delta_theta.subs(shear_subs)],common_assumptions+['The explicit tracefree metric/variation jets used in the following control are substituted into the actual geometric expansion and its full variation.'],
        'Both background and tangent nonexpansion are checked, so the remaining shear term cannot be dismissed as an expansion violation.',['gaussian-null-scalar-projection'])
    record('nonexpanding-shear-control','Negative control: nonexpansion alone does not suppress shear work',r'\theta=\delta\theta=0,\ \sigma^{AB}\delta q_{AB}\ne0\ \Rightarrow\ \Theta_{EH}-C\epsilon_S\delta\widehat\kappa=C\epsilon_S s h\ne0',
        [(eh_oriented-C*A*dk).subs(shear_subs)],common_assumptions+['q_AB=I, qdot_AB=diag(2s,−2s), h_AB=diag(h,−h), hdot_AB=h*qdot_AB with nonzero s,h.','For this explicit tangent variation θ=δθ=0; the tracefree shear response is deliberately not controlled.'],
        'Expected nonzero counterexample computed from the direct EH current. A selected scalar claim must control other canonical sectors, not merely set expansion to zero.',['gaussian-null-scalar-projection','nonexpanding-shear-tangency'],True)

    area_form=-C*mu*dA
    B=C*mu*A
    dB=s.diff(B,A)*dA+s.diff(B,mu)*dmu
    record('exact-polarization-exchange','Derive rate polarization through the exact boundary variation',r'-\mu\delta A/(8\pi G)+\delta(A\mu/(8\pi G))=A\delta\mu/(8\pi G)',[area_form+dB-C*A*dmu],['Selected boundary generating functional B_mu=A mu/(8πG); fixed boundary location and integration domain.'], 'Exact field-space product rule; B_mu is the specified action choice, not derived from the energy function.', ['null-scalar-trace-reduction'])
    # Exterior derivatives of a(A,mu)dA+b(A,mu)dmu have coefficient db/dA-da/dmu.
    curl=lambda aa,bb:s.diff(bb,A)-s.diff(aa,mu)
    record('polarization-preserves-two-form','Check the scalar symplectic two-form',r'\delta\Theta_A=\delta\Theta_\mu=\delta A\wedge\delta\mu/(8\pi G)',[curl(-C*mu,0)-C,curl(0,C*A)-C],['Exterior variation with independent A and mu.'],'Two canonical one-forms differ, while their field-space two-forms agree.',['exact-polarization-exchange'])
    expanded=C*A*(dk+dtheta/2)
    record('nonexpanding-tangent-restriction','Impose both nonexpansion and tangent variations',r'\mu=\widehat\kappa+\theta/2,\quad \theta=\delta\theta=0\Rightarrow A\delta\mu=A\delta\widehat\kappa',[expanded.subs(dtheta,0)-C*A*dk],['theta=0 AND delta theta=0; other canonical sectors separately fixed or accounted.'],'Restriction of the cited scalar rate form to tangent variations; theta=0 alone is insufficient.',['exact-polarization-exchange'])
    record('theta-zero-alone-insufficient','Negative control: nonexpansion at a point is insufficient',r'\theta=0\not\Rightarrow\delta\theta=0;\quad \Theta_\mu-CA\delta\widehat\kappa=CA\delta\theta/2',[expanded-C*A*dk],['Independent nonzero delta theta; C,A positive.'],'An expected nonzero residual demonstrates the omitted expansion response rather than a manuscript contradiction.',['nonexpanding-tangent-restriction'],True)
    restored=c**3*C*A*(dk/c**2)*c*dt
    record('physical-clock-si-restoration','Restore acceleration and the fixed physical clock',r'\frac{c^3}{8\pi G}A\delta(\kappa/c^2)\,c\,d\tau=\frac{Ac^2}{8\pi G}\delta\kappa\,d\tau',[restored-C*A*c**2*dk*dt],['Geometric inaffinity kappa_hat=kappa/c²; length generator parameter dv=c dτ; c,G and clock prescription fixed.'],'Computes both Jacobians; the physical choice and normalization of the generator remain explicit premises.',['nonexpanding-tangent-restriction'])
    U=C*A*c**4/L;Pi=C*c**4/L;F=C*A*c**4/L**2
    record('length-source-pullback','Pull the action response back to acceleration length',r'\frac{Ac^2}{8\pi G}\delta\kappa=-\frac{Ac^4}{8\pi GL^2}\delta L=-F_L\delta L',[C*A*c**2*s.diff(c**2/L,L)+F],['kappa=c²/L; nonzero positive L; fixed c,G; independent area when varying L.'],'A coordinate pullback of the selected action one-form, not an additional assumed force law.',['physical-clock-si-restoration'])
    record('complete-independent-differential','Compute the complete boundary potential differential',r'\delta U=\Pi\delta A-F_L\delta L,\quad \Pi=c^4/(8\pi GL)',[s.diff(U,A)-Pi,s.diff(U,L)+F],['A,L independent; U=Ac⁴/(8πGL); fixed c,G.'],'Retains both legs; the selected rate response is only the length leg.',['length-source-pullback'])
    # I=Lagrangian integrated over a fixed stationary interval. Variation of the
    # specific area-polarized functional includes -Pi dA; adding B=∫A Pi dτ
    # yields rate polarization, with endpoint/corner data an external condition.
    tau=s.symbols('Delta_tau',positive=True);P=s.symbols('Pi',real=True);dP=s.symbols('dPi',real=True)
    gen=tau*A*P
    rate=-tau*P*dA+s.diff(gen,A)*dA+s.diff(gen,P)*dP
    record('fixed-interval-generating-functional','Vary the explicit stationary boundary generating functional',r'\Theta_\Pi=\Theta_A+\delta\!\int A\Pi\,d\tau=\int A\delta\Pi\,d\tau;\quad\delta_\tau\Delta\tau=0',[rate-tau*A*dP],['Fixed integration endpoints and cut identifications; the residual endpoint/corner potential is controlled separately.','Other boundary data held fixed; no arbitrary additional source-dependent counterterm.'],'The supplied generating functional is varied explicitly; no endpoint/corner vanishing is inferred from theta=0.',['exact-polarization-exchange','physical-clock-si-restoration'])
    record('stationary-hamilton-jacobi-response','Obtain the fixed-duration action derivative',r'\delta I_{os}= -\Delta\tau F_L\delta L\Rightarrow\partial I_{os}/\partial L=-\Delta\tau F_L',[tau*A*s.diff(Pi,L)+tau*F],['Specified on-shell rate-polarized action and controlled other responses; stationary common source variation.'],'Computes the reduced Hamilton–Jacobi coefficient conditionally on that variational principle. No arbitrary source solution existence theorem is asserted.',['fixed-interval-generating-functional','length-source-pullback'])
    J=A*c**3*C;eta=c*tau/L
    record('stationary-area-boost-route','Check the stationary area–boost representation',r'J_\eta=Ac^3/(8\pi G),\quad\eta=c\Delta\tau/L,\quad J_\eta\delta\eta/\Delta\tau=-F_L\delta L',[J*s.diff(eta,L)/tau+F],['Cited area–boost canonical pair, consistent orientation, fixed stationary physical duration.'],'Checks the stationary corner coefficient; the full corner action and arbitrary moving cuts are not certified.',['length-source-pullback'])
    # dL∧dF coefficient for independent(A,L) equals -dF/dA on dA∧dL.
    record('work-pair-two-form','Check the transformed canonical pair',r'\delta A\wedge\delta\Pi=\delta L\wedge\delta F_L',[s.diff(Pi,L)+s.diff(F,A)],['Independent area/length; source-response orientation selected above.'],'Checks the two-form under the coordinate map; not a new independent pair.',['polarization-preserves-two-form','length-source-pullback'])
    record('oneform-not-full-differential','Negative control: the selected work response is not δU',r'\delta U-(-F_L\delta L)=\Pi\delta A',[s.diff(U,A)*dA+s.diff(U,L)*dL+F*dL],['Nonzero independent delta A; fixed positive c,G,L.'],'Expected nonzero area term rules out identifying the selected one-form with the complete energy differential.',['complete-independent-differential'],True)
    # Same U, different exact boundary functional B -> B+alpha A*kappa.
    alpha=s.symbols('alpha',nonzero=True)
    shift=alpha*A*k
    record('potential-does-not-select-action','Negative control: identical U does not uniquely select the action response',r'\Theta\mapsto\Theta+\delta(\alpha A\kappa):\quad\Delta[\delta\kappa]=\alpha A\ne0;\quad U\text{ unchanged}',[s.diff(shift,k)],['Nonzero source-dependent boundary counterterm alpha A kappa; same chosen energy function.'],'An explicit family of different source responses is compatible with the same U; action/polarization cannot be inferred solely from rewriting U.',['exact-polarization-exchange'],True)
    record('counterterm-two-form-unchanged','Check that the counterterm ambiguity preserves the two-form',r'\delta^2(\alpha A\kappa)=0',[s.diff(s.diff(shift,k),A)-s.diff(s.diff(shift,A),k)],['Fixed alpha and smooth independent A,kappa.'],'The one-form ambiguity is real even though the symplectic two-form is unchanged.',['potential-does-not-select-action'])
    return result


def main():
    raw=sys.stdin.read(400001)
    if len(raw)>400000:raise ValueError('oversized input')
    data=json.loads(raw)
    if not isinstance(data,dict) or set(data)!={'packageDigest','package'} or not isinstance(data['packageDigest'],str) or not re.fullmatch('[a-f0-9]{64}',data['packageDigest']):raise ValueError('invalid input')
    matches=match_package(data['package'])
    print(json.dumps(dict(packageDigest=data['packageDigest'],kernelImplementation='gaussian-null-eh-v2',engine='SymPy '+s.__version__,matches=matches,checks=checks() if matches else []),ensure_ascii=False))
if __name__=='__main__':
    try:main()
    except Exception:
        print('Restricted canonical derivation did not complete.',file=sys.stderr);sys.exit(1)
