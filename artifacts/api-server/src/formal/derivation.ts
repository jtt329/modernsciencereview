import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { FormalPackage, IngestedSource } from './contract';
import type { CanonicalDerivationApplicability, CanonicalDerivationCheck, CanonicalDerivationContext, CanonicalDerivationMatch, CanonicalDerivationObligation, CanonicalDerivationPremise, CanonicalDerivationReport, CanonicalDerivationStep, DerivationSourceBinding } from './derivationContract';
import { FormalError, packageDigest } from './package';

const VERSION='restricted-canonical-derivation-v1';
const KERNEL='gaussian-null-eh-v2';
const SHA=/^[a-f0-9]{64}$/;
const ids=['null-scalar-trace-reduction','gaussian-null-eh-current','gaussian-null-scalar-projection','gaussian-null-rate-action','boundary-functional-endpoint-identity','nonexpanding-endpoint-variation','gaussian-null-fixed-cut-response','nonexpanding-shear-tangency','nonexpanding-shear-control','exact-polarization-exchange','polarization-preserves-two-form','nonexpanding-tangent-restriction','theta-zero-alone-insufficient','physical-clock-si-restoration','length-source-pullback','complete-independent-differential','fixed-interval-generating-functional','stationary-hamilton-jacobi-response','stationary-area-boost-route','work-pair-two-form','oneform-not-full-differential','potential-does-not-select-action','counterterm-two-form-unchanged'];
const neg=new Set(['nonexpanding-shear-control','theta-zero-alone-insufficient','oneform-not-full-differential','potential-does-not-select-action']);
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const distinct=<T>(values:T[])=>[...new Set(values)];
const body=(source:IngestedSource)=>source.lines.map(line=>line.text).join('\n');
const hasMechanicalClaim=(text:string)=>/horizon|boundary|null|Rindler/i.test(text)&&/potential|work|mechanical|conjugate|force|polarization/i.test(text)&&/length|coordinate|\bL\b|κ|kappa|surface.gravity/i.test(text);
const relevant=(text:string)=>/potential|canonical|symplectic|nonexpand|expan|boundary|clock|cuts|κ|kappa|Θ|Theta|δ|delta|force|work|mixed|polarization|length|Rindler/i.test(text);
/** A cheap planning signal, never a mathematical match. The Python kernel
 * subsequently validates dimensional roles and exact independent-coordinate ASTs. */
export function canonicalDerivationApplicability(pkg:FormalPackage,source:IngestedSource):CanonicalDerivationApplicability{
 const selected=pkg.analysis?.coverage.filter(item=>relevant(item.statement))||[];
 const sourceLineIds=distinct([...source.lines.filter(line=>relevant(line.text)).map(line=>line.id),...selected.flatMap(item=>item.sourceLineIds)]).filter(id=>source.lines.some(line=>line.id===id));
 const requested=hasMechanicalClaim(body(source));
 return {status:requested?'needs-formalization':'unmatched',reason:requested?'The source makes a horizon work-coordinate claim. The exact submitted AST must match the supported independent-area/length potential before this fixed derivation can support it.':'No source-bound horizon work-coordinate claim selects this restricted derivation.',sourceLineIds:requested?sourceLineIds:[],claimIds:requested?distinct(selected.flatMap(item=>item.claimIds)):[],coverageIds:requested?selected.map(item=>item.id):[],matches:[]};
}
function fingerprint(pkg:FormalPackage,source:IngestedSource,context:CanonicalDerivationContext){return hash({version:VERSION,kernelImplementation:KERNEL,packageDigest:packageDigest(pkg),sourceId:source.id,sourceSha256:source.sha256,lines:source.lines,primary:(context.primaryReferences||[]).map(r=>({id:r.id,status:r.status,sha256:r.sha256||null,excerpts:r.excerpts.map(e=>({id:e.id,locator:e.locator}))})),companion:(context.companion||[]).map(r=>({sha256:r.sha256,sourceUrl:r.sourceUrl,excerpts:r.excerpts.map(e=>({id:e.id,locator:e.locator}))}))});}
export function derivationReportMatches(pkg:FormalPackage,source:IngestedSource,report:CanonicalDerivationReport|null|undefined,context?:CanonicalDerivationContext):boolean{return !!report&&report.version===VERSION&&report.kernelImplementation===KERNEL&&report.packageDigest===packageDigest(pkg)&&report.sourceId===source.id&&report.sourceSha256===source.sha256&&SHA.test(report.evidenceFingerprint)&&(!context||report.evidenceFingerprint===fingerprint(pkg,source,context));}
let active=0;
async function kernel(pkg:FormalPackage,digest:string):Promise<{engine:string;matches:CanonicalDerivationMatch[];checks:CanonicalDerivationCheck[]}>{
 if(active>=2)throw new FormalError('The restricted derivation checker is busy. Saved results are preserved.',429);
 active++;
 const fromBundle=fileURLToPath(new URL('./formal-verifier/canonical_derivation.py',import.meta.url));
 const script=existsSync(fromBundle)?fromBundle:fileURLToPath(new URL('../../formal-verifier/canonical_derivation.py',import.meta.url));
 const rootVenv=path.resolve(process.cwd(),'.formal-venv/bin/python');const python=process.env.FORMAL_PYTHON||(existsSync(rootVenv)?rootVenv:'python3');
 const data={packageDigest:digest,package:{symbols:pkg.symbols.map(({name,dimensions,domain})=>({name,dimensions,domain})),definitions:pkg.definitions.map(({symbol,expression})=>({symbol,expression})),claims:pkg.claims.map(({id,lhs,rhs})=>({id,lhs,rhs}))}};
 if(Buffer.byteLength(JSON.stringify(data))>400000){active--;throw new FormalError('The restricted derivation input exceeded its bound.',422);}
 try{return await new Promise((resolve,reject)=>{
  const child=spawn(python,['-I',script],{cwd:path.dirname(script),stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH||'/usr/bin:/bin',LANG:'C.UTF-8',PYTHONHASHSEED:'0'}});
  let output='',done=false;const finish=(error?:Error,result?:any)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(result);};
  const timer=setTimeout(()=>{child.kill('SIGKILL');finish(new FormalError('The fixed canonical derivation checker reached its 30-second execution limit. This does not limit the model review.',504));},30000);
  child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.length>150000){child.kill('SIGKILL');finish(new FormalError('The derivation checker output exceeded its limit.',502));}});child.stderr.resume();child.stdin.on('error',()=>{});
  child.on('error',()=>finish(new FormalError('The restricted canonical derivation checker is unavailable.',503)));
  child.on('close',code=>{if(done)return;if(code!==0){finish(new FormalError('The submitted AST could not be checked by the restricted canonical derivation kernel.',422));return;}try{
   const value=JSON.parse(output);if(value.packageDigest!==digest||value.kernelImplementation!==KERNEL||typeof value.engine!=='string'||!Array.isArray(value.matches)||!Array.isArray(value.checks)||value.checks.length!==(value.matches.length?ids.length:0))throw new Error('invalid');
   const names=new Set(pkg.symbols.map(item=>item.name)),claimIds=new Set(pkg.claims.map(item=>item.id));
   for(const match of value.matches){if(![match.potentialSymbol,match.areaSymbol,match.lengthSymbol,match.lightSpeedSymbol,match.newtonSymbol,match.piSymbol].every(name=>names.has(name))||(match.kappaSymbol&&!names.has(match.kappaSymbol))||!Array.isArray(match.claimIds)||match.claimIds.some((id:string)=>!claimIds.has(id)))throw new Error('invalid match');}
   value.checks.forEach((check:any,index:number)=>{if(check.id!==ids[index]||!['checked','contradicted'].includes(check.status)||check.kind!==(neg.has(check.id)?'negative-control':'derivation')||check.expected!==(neg.has(check.id)?'nonzero':'zero')||typeof check.rawResidual!=='string'||typeof check.residual!=='string'||!Array.isArray(check.dependsOn)||!Array.isArray(check.assumptions)||typeof check.scope!=='string')throw new Error('invalid check');});finish(undefined,value);
  }catch{finish(new FormalError('The restricted canonical derivation checker returned invalid evidence.',502));}});
  child.stdin.end(JSON.stringify(data));
 });}finally{active--;}
}
function bindings(context:CanonicalDerivationContext,kind:'projection'|'polarization'|'clock'|'corners'|'boost'):DerivationSourceBinding[]{
 const out:DerivationSourceBinding[]=[];
 for(const reference of context.primaryReferences||[]){if(reference.status!=='retrieved'||!reference.sha256||!SHA.test(reference.sha256))continue;
  for(const excerpt of reference.excerpts){if(!excerpt.text.trim())continue;const locator=excerpt.locator,text=excerpt.text;
   const accepted=kind==='projection'?reference.id==='1611.03096'&&(/#S4\.EGx26$/.test(locator)&&/Theta|Θ/.test(text)||/#S5\.p5\.1$/.test(locator)&&/spin.?0|spin.?–.?0|spin.?zero/.test(text)):
    kind==='polarization'?reference.id==='1611.03096'&&/#S2\.p3\.3$/.test(locator)&&/polarization/.test(text):
    kind==='corners'?reference.id==='1611.03096'&&(/#S4\.EGx26$|#S3\.SS2\.p1\.1$|#S2\.p3\.3$/.test(locator))&&/corner|boundar|fixed|hypersurface/i.test(text):false;
   if(accepted)out.push({kind:'primary',sourceId:reference.id,excerptId:excerpt.id,locator,sha256:reference.sha256});
  }
 }
 for(const companion of context.companion||[]){if(!SHA.test(companion.sha256))continue;
  for(const excerpt of companion.excerpts){if(!excerpt.text.trim())continue;const text=excerpt.text;
   const accepted=kind==='projection'?/µ|mu|scalar canon/i.test(text)&&/area polarization|area polarisation/i.test(text):kind==='polarization'?/polarization|polarisation/i.test(text)&&/exact|product rule/i.test(text):kind==='clock'?/physical time|physical clock|clock prescription/i.test(text)&&/c2|c²|c\^2|acceleration units/i.test(text):kind==='corners'?/cut identifications|corner data|fixed interval|fixed stationary duration/i.test(text):kind==='boost'?/corner one.form|area.boost|boost relation/i.test(text):false;
   if(accepted)out.push({kind:'companion',sourceId:companion.sha256,excerptId:excerpt.id,locator:excerpt.locator,sha256:companion.sha256});
  }
 }
 return out;
}
/** Runs fixed, source-bound mathematical checks only. It never calls AI, changes
 * a manuscript, grants approval, or equates a cited premise with a formal proof. */
export async function runRestrictedCanonicalDerivation(pkg:FormalPackage,source:IngestedSource,digest:string,context:CanonicalDerivationContext={}):Promise<CanonicalDerivationReport>{
 if(!SHA.test(digest)||packageDigest(pkg)!==digest||pkg.source.sha256!==source.sha256||(pkg.analysis&&pkg.analysis.sourceId!==source.id))throw new FormalError('The canonical derivation must use the exact saved source and package.',409);
 const planned=canonicalDerivationApplicability(pkg,source);const base={version:VERSION as typeof VERSION,kernelImplementation:KERNEL as typeof KERNEL,packageDigest:digest,sourceId:source.id,sourceSha256:source.sha256,createdAt:new Date().toISOString(),evidenceFingerprint:fingerprint(pkg,source,context)};
 const limitations=['This includes a direct local Einstein–Hilbert null-current derivation in a fixed Gaussian-null gauge, plus a source-crosschecked scalar/polarization chain. It is not a machine proof of arbitrary covariant generators, moving boundaries or global corner prescriptions.','The selected boundary polarization, physical generator/clock, controlled other sectors and endpoint/corner data are physical premises. Rewriting the same energy function does not uniquely determine them.','Stationary null scalar conclusions do not certify a generic evolving FRW worldtube, arbitrary moving cuts, all corner prescriptions, empirical truth or historical priority.'];
 if(planned.status==='unmatched')return {...base,engine:'not-run',status:'not-applicable',applicability:planned,premises:[],checks:[],steps:[],obligations:[],summary:{title:'No supported canonical claim selected',text:planned.reason,checked:0,negativeControls:0,conditionalPremises:0,openObligations:0,fullCovariantProof:false},limitations};
 const computed=await kernel(pkg,digest);const matches=computed.matches;const matchClaims=distinct(matches.flatMap(match=>match.claimIds));
 const applicability:CanonicalDerivationApplicability={...planned,status:matches.length?'matched':'needs-formalization',matches,claimIds:matchClaims,reason:matches.length?'Exact dimensional and symbolic AST matching identifies the independent-area/length Einstein boundary potential. The selected action response is checked conditionally on the separately displayed physical premises.':'The mechanical claim is recognized, but the approved formal package does not contain the supported independent-area/length potential. No fixed derivation evidence is assigned to it.'};
 if(!matches.length)return {...base,engine:computed.engine,status:'partial',applicability,premises:[],checks:[],steps:[],obligations:[{id:'formal-construction-needed',title:'Formalize the claimed potential and independent coordinates',status:'open',reason:applicability.reason,stepIds:[],checkIds:[],premiseIds:[],needed:'Supply the potential, dimensional roles, independent variables and candidate work identity in the reviewable formal package. An AI proposal must be approved before it can support the manuscript.'}],summary:{title:'Claim identified; construction still needed',text:applicability.reason,checked:0,negativeControls:0,conditionalPremises:0,openObligations:1,fullCovariantProof:false},limitations};
 const text=body(source),lines=(rx:RegExp)=>source.lines.filter(line=>rx.test(line.text)).map(line=>line.id);
 const declared=(rx:RegExp)=>rx.test(text)||rx.test(pkg.assumptions.join('\n'));
 const projection=bindings(context,'projection'),polarization=bindings(context,'polarization'),clock=bindings(context,'clock'),corners=bindings(context,'corners'),boost=bindings(context,'boost');
 // A general theorem describes available structures; it cannot select a
 // manuscript's action or boundary conditions. A specific author companion may
 // record that adoption, but unrelated/general reference passages cannot.
 const companionAdopts=(id:string,binding:DerivationSourceBinding):boolean=>{
  if(binding.kind!=='companion')return false;
  const passage=context.companion?.find(item=>item.sha256===binding.sha256)?.excerpts.find(item=>item.id===binding.excerptId)?.text||'';
  if(id==='chosen-rate-polarization')return /area polarization|area polarisation|source exchange/i.test(passage)&&/adding.*exact|exact\s+variation|selected|prescribed|product rule/i.test(passage);
  if(id==='controlled-other-and-corner-data')return /cut identifications|boundary\/corner data|boundary and corner data|remaining data|fixed interval|fixed stationary duration/i.test(passage)&&/specified|controlled|account|fixed|preserve/i.test(passage);
  if(id==='physical-clock-and-orientation')return /physical time|physical clock|clock prescription/i.test(passage)&&/prescribed|specified|fixed|restoring|restor/i.test(passage);
  if(id==='stationary-boost-pair')return /corner one.form|area.boost|boost relation/i.test(passage)&&/stationary|prescribed|fixed/i.test(passage);
  if(id==='eh-null-projection')return /Einstein|gravitational action/i.test(passage)&&/selected|specified|prescribed|canonical foundation/i.test(passage);
  return false;
 };
 const p=(id:string,title:string,statement:string,isDeclared:boolean,evidence:DerivationSourceBinding[],sourceLineIds:string[],needed:string,onlyPrimary=false):CanonicalDerivationPremise=>{
  const adopted=isDeclared||evidence.some(binding=>companionAdopts(id,binding));
  const supported=evidence.some(binding=>!onlyPrimary||binding.kind==='primary');
  return {id,title,statement,status:adopted?(supported?'source-supported':'declared'):'missing',sourceLineIds,evidence,needed};
 };
 const circleDeclared=matches.every(match=>{const symbol=pkg.symbols.find(item=>item.name===match.piSymbol);return !!symbol&&/circle|mathematical constant.*π|\\pi|\bpi\b|π/i.test(symbol.label);});
 const physicalConstantsDeclared=matches.every(match=>{const c=pkg.symbols.find(item=>item.name===match.lightSpeedSymbol),G=pkg.symbols.find(item=>item.name===match.newtonSymbol);return !!c&&!!G&&/speed.*light|light.*speed/i.test(c.label)&&/Newton|gravitational.*constant|constant.*gravitational/i.test(G.label);});
 const sourceLengthIdentified=matches.every(match=>{if(!match.kappaSymbol)return false;const kappa=pkg.symbols.find(item=>item.name===match.kappaSymbol);return !!kappa&&/surface.?gravity|inaffinity|proper acceleration/i.test(kappa.label);});
 const premises:CanonicalDerivationPremise[]=[
  p('source-length-identification','Identify the length with the gravitational source','Every matched construction must include the actual AST relation kappa=c²/L, with kappa declared as the physical surface-gravity acceleration (or its normalized inaffinity/observer realization). The algebraic energy function alone does not establish this physical source-coordinate identification.',sourceLengthIdentified,[],lines(/κ|kappa|surface.gravity|inaffinity|length/i),'Supply the reciprocal AST relation and identify its kappa with the chosen gravitational generator/clock. A free length in U does not automatically become the EH mechanical coordinate.'),
  p('local-gaussian-null-gauge','Fixed local Gaussian-null derivation domain','Use a smooth null patch with ds²=−2r kappa_hat du²+2du dr+2r beta_A du dx^A+q_AB dx^A dx^B at r=0. Keep the generator, null location, chart normalization g_ur=1 and cut identifications fixed. General q_AB and all first jets are retained; this is a local derivation domain, not a claim of arbitrary-generator covariance.',declared(/null|Rindler/i)&&declared(/clock|generator/i),[],lines(/null|Rindler|clock|cuts/i),'Specify a fixed-generator local null domain, or provide a different supported action/geometry construction.'),
  p('physical-constant-roles','Physical meaning of the matched SI constants','The matched velocity and gravitational-coupling symbols are declared to be the fixed speed of light c and Newton gravitational constant G. Dimensions alone cannot establish those physical identifications.',physicalConstantsDeclared,[],lines(/\bc\b|\bG\b|Einstein/i),'Declare the fixed physical constants c and G for the supported Einstein-action normalization.'),
  p('circle-constant-normalization','Circle-constant interpretation of the submitted AST','The matched pi tokens denote the mathematical circle constant π. The generic AST stores named dimensionless symbols, so this identification is a declared translation premise, not a theorem established by dimensional matching.',circleDeclared,[],lines(/π|\bpi\b/i), 'Declare the matched pi token as the mathematical circle constant. A free dimensionless coefficient does not establish Einstein normalization.'),
  p('eh-null-projection','Einstein–Hilbert action and boundary-current convention','Adopt the Einstein–Hilbert action and its Levi-Civita boundary current sqrt(−g)(g^ab delta Gamma^r_ab−g^rb delta Gamma^a_ab)/(16πG), with the stated orientation. The local fixed-gauge scalar projection is now computed directly from metric/variation jets and crosschecked against cited Eq. (71).',declared(/Einstein|Hopfm|1611\.03096/i),projection,lines(/Einstein|1611\.03096|Hopfm/i),'The EH theory/current convention is an adopted standard; arbitrary-generator covariance and the complete global corner variational problem remain separate obligations.',true),
  p('chosen-rate-polarization','Specified boundary action and rate polarization','Choose the area-polarized scalar form and add the exact functional B_mu=(8πG)⁻¹ ∫epsilon_S mu dv; arbitrary further source-dependent counterterms are not permitted under this choice.',declared(/mixed[ -]*(?:boundary[ -]*)?(?:prescription|conditions?)|(?:rate|area)[ -]*polarization/i),polarization,lines(/mixed|polarization|prescription/i),'State the selected boundary prescription, rather than infer it from U alone.'),
  p('nonexpanding-tangent-sector','Nonexpanding sector and tangent variations','Impose theta=0 AND delta theta=0; the scalar source mu=kappa_hat+theta/2 then reduces to kappa_hat.',declared(/nonexpand/i)&&declared(/δ.?θ|delta.?theta|\\delta.?\\theta|δθ/i),projection,lines(/nonexpand|θ|theta/i),'Both the background restriction and tangent variation are needed. Source evidence for the general scalar form does not itself impose this manuscript restriction.'),
  p('physical-clock-and-orientation','Physical generator, clock and orientation','Use the stated physical clock, dv=c dτ, kappa=c² kappa_hat, fixed c,G, and consistent orientation. Holding that clock prescription fixed does not force delta kappa=0.',declared(/fixed clock|prescribed clock|specified clock|clock.*fixed/i),clock,lines(/clock|orientation/i),'Identify generator/clock normalization and orientation for the claimed realization.'),
  p('controlled-other-and-corner-data','Other sectors and endpoint/corner data','Keep the integration domain, cut identifications and endpoint coordinate labels fixed; control the remaining shear/generator/matter/corner response and the endpoint difference δA_f−δA_i in the selected variational problem. Tangent nonexpansion throughout the interval implies equal endpoint-area variations; it does not require each endpoint area variation to vanish. Theta=0 alone does not make these terms vanish.',declared(/fixed.{0,25}cuts|cuts.{0,25}fixed|cut identifications.{0,25}(?:specified|fixed)|controlled.{0,25}(?:corner|other|remaining)|corner.{0,25}(?:specified|fixed|controlled)/i),corners,lines(/cuts|corner|not the full action/i),'The complete boundary-value problem must supply admissible controlled data; this kernel does not certify arbitrary corner cancellation.'),
  p('stationary-boost-pair','Stationary area–boost canonical pair','For the optional stationary route use J_eta=Ac³/(8πG), eta=c Deltaτ/L and the consistently oriented area–boost one-form.',false,boost,lines(/stationary|Rindler|Schwarzschild|de Sitter/i),'The area–boost pair and fixed stationary duration are cited premises, not independently established by the coefficient match.'),
 ];
 // Source support for the general formula cannot replace an actual restriction.
 const restriction=premises.find(item=>item.id==='nonexpanding-tangent-sector')!;
 restriction.status=declared(/nonexpand/i)&&declared(/δ.?θ|delta.?theta|\\delta.?\\theta|δθ/i)?'declared':'missing';
 const lineIds=applicability.sourceLineIds,claimIds=applicability.claimIds;
 const step=(id:string,title:string,statement:string,kind:CanonicalDerivationStep['kind'],checkIds:string[],premiseIds:string[],dependsOn:string[],scope:string):CanonicalDerivationStep=>({id,title,statement,kind,status:checkIds.some(id=>computed.checks.find(check=>check.id===id)?.status!=='checked')?'open':premiseIds.some(id=>premises.find(item=>item.id===id)?.status==='missing')?'open':premiseIds.length?'conditional':'checked',checkIds,premiseIds,dependsOn,sourceLineIds:lineIds,claimIds,scope});
 const steps:CanonicalDerivationStep[]=[
  step('cited-gravity-start','Select the gravitational action and boundary conventions','Adopt the Einstein–Hilbert action, its standard boundary current, and the fixed generator, clock and cut domain. The local projection below is computed directly.','cited-premise',[],['eh-null-projection','controlled-other-and-corner-data'],[],'Physical theory and complete boundary-value conventions remain explicit; arbitrary covariant/global corner theorems are not asserted.'),
  step('derive-gaussian-null-current','Derive the local null action response from metric jets','The kernel constructs $\\delta\\Gamma^a{}_{bc}$ from all metric and variation first jets in the fixed Gaussian-null chart, then computes $\\Theta_{EH}$ and the explicit exact boundary terms $-\\delta B_0+\\delta B_\\mu$. The resulting scalar rate form is $\\epsilon_S\\delta\\mu/(8\\pi G)$, with shear response retained.','computed',['gaussian-null-eh-current','gaussian-null-scalar-projection','gaussian-null-rate-action','gaussian-null-fixed-cut-response'],['local-gaussian-null-gauge','circle-constant-normalization','physical-constant-roles'],['cited-gravity-start'],'Direct local action-current computation in the stated fixed gauge; no arbitrary generator, moving-cut or global corner theorem.'),
  step('track-endpoint-variation','Track the endpoint area contribution','The selected functionals satisfy $I_{rate}-I_{EH}=-(A_f-A_i)/(16\\pi G)$. Fixed endpoint coordinates alone do not eliminate its variation. If $\\theta=\\delta\\theta=0$ throughout the interval, then $\\delta A_f=\\delta A_i$ and this difference variation vanishes, even when each area changes.','computed',['boundary-functional-endpoint-identity','nonexpanding-endpoint-variation'],['controlled-other-and-corner-data'],['derive-gaussian-null-current'],'The expansion identity and smooth fixed-domain integration are explicit. No unrelated global corner contribution is silently discarded.'),
  step('derive-spin-zero','Derive the four-dimensional scalar trace','The direct metric-jet result and the cited tensor expression give the same scalar form $-(\\widehat\\kappa+\\theta/2)\\delta\\epsilon_S/(8\\pi G)$.','computed',['null-scalar-trace-reduction'],['circle-constant-normalization','physical-constant-roles'],['derive-gaussian-null-current'],'Crosschecks the scalar reduction; shear and generator responses remain separate.'),
  step('derive-polarization','Vary the chosen boundary generating functional','$-\\mu\\delta A+\\delta(A\\mu)=A\\delta\\mu$; the exterior two-form is unchanged.','computed',['exact-polarization-exchange','polarization-preserves-two-form'],['chosen-rate-polarization'],['derive-spin-zero','track-endpoint-variation'],'A definite action prescription selects this one-form; U alone does not.'),
  step('restrict-source-sector','Restrict admissible variations','$\\theta=\\delta\\theta=0$ removes expansion work. The direct EH current also retains shear work unless $\\sigma^{AB}\\delta q_{AB}$ is controlled; both counterexamples are computed.','restriction',['nonexpanding-tangent-restriction','theta-zero-alone-insufficient','nonexpanding-shear-tangency','nonexpanding-shear-control'],['nonexpanding-tangent-sector','controlled-other-and-corner-data'],['derive-polarization'],'Both restrictions are required, and are displayed as premises.'),
  step('restore-physical-response','Restore the physical time and acceleration normalization','$\\frac{c^3}{8\\pi G}A\\delta(\\kappa/c^2)c\\,d\\tau=\\frac{Ac^2}{8\\pi G}\\delta\\kappa\\,d\\tau$.','computed',['physical-clock-si-restoration'],['physical-clock-and-orientation','source-length-identification'],['restrict-source-sector'],'The Jacobians are checked, while the physical clock choice remains explicit.'),
  step('derive-length-work','Transform the action response and compare the full potential differential','$\\kappa=c^2/L$ gives $\\Theta_L/\\Delta\\tau=-F_L\\delta L$, while $\\delta U=\\Pi\\delta A-F_L\\delta L$ retains the area term.','computed',['length-source-pullback','complete-independent-differential','work-pair-two-form','oneform-not-full-differential'],[],['restore-physical-response'],'Exact independent-coordinate consequences conditional on the upstream action premises.'),
  step('derive-fixed-interval-action','Check the explicit reduced action response','Adding $\\delta\\int A\\Pi\\,d\\tau$ to the area-polarized response gives $\\int A\\delta\\Pi\\,d\\tau$ and the constant-source derivative $-\\Delta\\tau F_L$.','computed',['fixed-interval-generating-functional','stationary-hamilton-jacobi-response'],['controlled-other-and-corner-data'],['derive-polarization','derive-length-work'],'Conditional on controlled endpoint/corner and other-sector data; not an arbitrary-source existence theorem.'),
  step('check-stationary-corner','Check the optional stationary area–boost route','$J_\\eta\\delta\\eta/\\Delta\\tau=-F_L\\delta L$ with $\\eta=c\\Delta\\tau/L$.','computed',['stationary-area-boost-route'],['stationary-boost-pair'],['derive-length-work'],'Same Einstein normalization and stationary clock; not an independent empirical test.'),
  step('test-uniqueness-inference','Test whether rewriting U uniquely supplies a canonical derivation','A source-dependent exact counterterm changes the canonical one-form while leaving U and the two-form unchanged.','interpretation',['potential-does-not-select-action','counterterm-two-form-unchanged'],[],[],'This counterexample defeats an inference of unique action/polarization from the energy function alone.'),
 ];
 // These are targeted manuscript links, not a claim that every exact identity
 // related to U (including thermal/mass translations) follows from the EH route.
 const sourceIds=new Set(source.lines.map(item=>item.id));
 const canonicalItems=pkg.analysis?.coverage.filter(item=>/quoted canonical response|canonical.*response|scalar.*response|nonexpanding|mixed boundary|Θ|Theta|δκ/.test(item.statement))||[];
 const canonicalSpan=distinct(canonicalItems.flatMap(item=>item.sourceLineIds)).filter(id=>sourceIds.has(id));
 const matchedLines=(rx:RegExp)=>source.lines.filter(item=>rx.test(item.text)).map(item=>item.id);
 const spans:Record<string,string[]>={
  'cited-gravity-start':[...canonicalSpan,...matchedLines(/canonical basis|mixed boundary|Hopfm|1611\.03096/)],
  'derive-gaussian-null-current':canonicalSpan,
  'track-endpoint-variation':matchedLines(/fixed clock|cuts|corner|nonexpand|δθ/),
  'derive-spin-zero':canonicalSpan,
  'derive-polarization':matchedLines(/mixed boundary|polarization|source exchange/),
  'restrict-source-sector':matchedLines(/nonexpand|δθ|delta.?theta|other.*sector|shear/),
  'restore-physical-response':canonicalSpan.filter(id=>{const line=source.lines.find(item=>item.id===id);return !!line&&/clock|κ|kappa|τ|tau/.test(line.text);}),
  'derive-length-work':[...canonicalSpan,...matchedLines(/boundary potential|full differential|dU|d U|δU|δκ.*δL|force.*length/)],
  'derive-fixed-interval-action':matchedLines(/fixed clock|cuts|corner|selected action response|not the full action/),
  'check-stationary-corner':matchedLines(/Stationary Rindler|stationary.*boost|area.boost|de Sitter/),
  'test-uniqueness-inference':matchedLines(/boundary potential|mixed boundary|selected action response|polarization/),
 };
 const relatedClaims=new Set(applicability.claimIds);
 for(const current of steps){
  current.sourceLineIds=distinct(spans[current.id]||[]).filter(id=>sourceIds.has(id)).slice(0,12);
  const stepLines=new Set(current.sourceLineIds);
  const linked=distinct([...(pkg.analysis?.claimReferences.filter(ref=>ref.sourceLineIds.some(id=>stepLines.has(id))).map(ref=>ref.claimId)||[]),...(pkg.analysis?.coverage.filter(item=>item.sourceLineIds.some(id=>stepLines.has(id))).flatMap(item=>item.claimIds)||[])]);
  current.claimIds=linked.filter(id=>relatedClaims.has(id)&&! /thermal|temperature|entropy|Hawking|Unruh|Misner|FRW|Friedmann|Schwarzschild|Smarr|mass/i.test(pkg.claims.find(claim=>claim.id===id)?.title||''));
 }
 // A local residual can be checked while the manuscript-level inference remains
 // conditional or open. Propagate every upstream obligation through the DAG.
 const byStep=new Map<string,CanonicalDerivationStep>();
 for(const current of steps){
  const upstream=current.dependsOn.map(id=>byStep.get(id)?.status||'open');
  if(current.status==='open'||upstream.includes('open'))current.status='open';
  else if(current.status==='conditional'||upstream.includes('conditional'))current.status='conditional';
  byStep.set(current.id,current);
 }
 const failed=computed.checks.filter(check=>check.status!=='checked');const missing=premises.filter(item=>item.status==='missing');
 const obligations:CanonicalDerivationObligation[]=[
  {id:'restricted-length-work-chain',title:'Derive the restricted length-conjugate action response',status:failed.length||missing.some(p=>p.id!=='stationary-boost-pair')?'open':'conditional',reason:'The local EH projection, exact boundary-function exchange and downstream algebra are computed in the fixed Gaussian-null domain. The adopted theory, domain, polarization, clock and controlled-sector/corner premises remain explicit.',stepIds:steps.filter(s=>s.id!=='check-stationary-corner').map(s=>s.id),checkIds:computed.checks.filter(c=>c.kind==='derivation').map(c=>c.id),premiseIds:premises.filter(p=>p.id!=='stationary-boost-pair').map(p=>p.id),needed:missing.filter(p=>p.id!=='stationary-boost-pair').map(p=>p.needed).join(' ')||'Accept the standard EH theory/current and the displayed local boundary-value domain; the local scalar projection itself is now computed.'},
  {id:'potential-only-uniqueness',title:'Can the potential alone force the canonical prescription?',status:'discharged',reason:'No. The explicit exact-counterterm and polarization counterexamples show that the same U does not uniquely fix the source response. This is an answered logical requirement, not a paper contradiction when the action is specified.',stepIds:['test-uniqueness-inference'],checkIds:['potential-does-not-select-action','counterterm-two-form-unchanged'],premiseIds:[],needed:'Retain the selected action/polarization as an explicit premise.'},
  {id:'complete-covariant-corner-theorem',title:'Full arbitrary covariant and corner certification',status:'out-of-scope',reason:'Not asserted by this fixed restricted kernel. It requires a complete action, field-space boundary restrictions, corner prescription and general tensor/form proof. Stationary scalar coefficient agreement does not establish it.',stepIds:['cited-gravity-start','derive-fixed-interval-action'],checkIds:[],premiseIds:['eh-null-projection','controlled-other-and-corner-data'],needed:'A supported general covariant action/proof backend, with all boundary and corner data, if the author actually claims that stronger theorem.'},
 ];
 const status=failed.length||missing.some(p=>p.id!=='stationary-boost-pair')?'partial':'conditional-checked';
 return {...base,engine:computed.engine,status,applicability,premises,checks:computed.checks,steps,obligations,summary:{title:status==='conditional-checked'?'Restricted canonical proof chain checked under explicit premises':'Canonical proof chain computed; specific premises remain',text:`The kernel checks ${computed.checks.filter(c=>c.kind==='derivation'&&c.status==='checked').length} derivation steps and ${computed.checks.filter(c=>c.kind==='negative-control'&&c.status==='checked').length} expected-nonzero controls. It computes the local EH null projection directly from metric and variation jets, varies the explicit boundary functionals, and derives length work through the tangent restrictions and physical-clock conversion. Arbitrary covariant/global corner certification is not claimed.`,checked:computed.checks.filter(c=>c.kind==='derivation'&&c.status==='checked').length,negativeControls:computed.checks.filter(c=>c.kind==='negative-control'&&c.status==='checked').length,conditionalPremises:premises.filter(p=>p.status!=='missing').length,openObligations:obligations.filter(o=>o.status==='open').length,fullCovariantProof:false},limitations};
}
