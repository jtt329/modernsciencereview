import type { CoverageResult, Expr, FormalClaim, FormalPackage, IngestedSource } from './contract';
import type { ClaimEvidenceReference, ClaimObligationDisposition, ClaimVerificationObligation, ClaimVerificationPlan, ClaimVerificationPlanEvidence, ClaimVerificationRequirement, ClaimSourceJudgment } from './obligationContract';
import { FormalError, packageDigest } from './package';
import { buildCoverage } from './outputs';

const unique = <T>(items: T[]): T[] => [...new Set(items)];
const overlaps = (left: string[], right: string[]): boolean => left.some(id => right.includes(id));
const ref = (kind: ClaimEvidenceReference['kind'], id: string, status: string, summary: string): ClaimEvidenceReference => ({kind,id,status,summary});
const distinctEvidence = (items: ClaimEvidenceReference[]) => [...new Map(items.map(item => [`${item.kind}:${item.id}`,item])).values()];
const canonicalLanguage = /\bcanonical\b|symplect|polarization|boundary prescription|boundary variation|action variation|action response|one[- ]form|\bTheta\b|Θ|\\Theta/i;
const horizonLanguage = /\bhorizon\b|\bRindler\b|surface gravity|null boundary|nonexpanding|null response/i;
const mechanicalLanguage = /\bmechanic|\bforce\b|\bpressure\b|\bstress\b|conjugate|work coordinate|work term|boundary potential/i;

function expressionSymbols(expr: Expr): string[] {
  switch(expr.op) {
    case 'symbol': return [expr.name];
    case 'integer': case 'rational': return [];
    case 'add': case 'mul': return unique(expr.args.flatMap(expressionSymbols));
    case 'div': return unique([...expressionSymbols(expr.numerator),...expressionSymbols(expr.denominator)]);
    case 'pow': return expressionSymbols(expr.base);
    case 'diff': return unique([expr.variable,...expressionSymbols(expr.expr)]);
    case 'substitute': return unique([...expressionSymbols(expr.expr),...Object.keys(expr.values),...Object.values(expr.values).flatMap(expressionSymbols)]);
  }
}
function definitionDependencies(pkg: FormalPackage, claim: FormalClaim): {symbols:string[];cycles:string[]} {
  const definitions=new Map(pkg.definitions.map(item => [item.symbol,item.expression]));
  const visited=new Set<string>(),cycles=new Set<string>();
  const walk=(symbol:string,stack:string[]) => {
    if(stack.includes(symbol)){cycles.add(symbol);return;}
    if(visited.has(symbol)||!definitions.has(symbol))return;
    visited.add(symbol);
    for(const dependency of expressionSymbols(definitions.get(symbol)!))walk(dependency,[...stack,symbol]);
  };
  for(const symbol of unique([...expressionSymbols(claim.lhs),...expressionSymbols(claim.rhs)]))walk(symbol,[]);
  return {symbols:[...visited],cycles:[...cycles]};
}
function assertBinding(pkg:FormalPackage,source:IngestedSource,digest:string,evidence:ClaimVerificationPlanEvidence):void {
  if(packageDigest(pkg)!==digest || evidence.verification.packageDigest!==digest)throw new FormalError('Claim obligations require the exact saved package and verification report.',409);
  if(pkg.source.sha256 && pkg.source.sha256!==source.sha256)throw new FormalError('Claim obligations belong to another source document.',409);
  if(pkg.analysis && pkg.analysis.sourceId!==source.id)throw new FormalError('Claim obligations belong to another source analysis.',409);
  const known=new Set(pkg.claims.map(item=>item.id)),seen=new Set<string>();
  for(const item of evidence.verification.claims){if(!known.has(item.id)||seen.has(item.id))throw new FormalError('Claim obligation report has invalid or duplicate candidate references.');seen.add(item.id);}
  for(const supplement of [evidence.canonical,evidence.literature,evidence.geometry,evidence.assessment,evidence.derivation]) {
    if(supplement && (supplement.packageDigest!==digest || supplement.sourceId!==source.id || supplement.sourceSha256!==source.sha256))throw new FormalError('Claim obligation supplement belongs to another source or revision.',409);
  }
  if(evidence.outputs && evidence.outputs.packageDigest!==digest)throw new FormalError('Claim obligation outputs belong to another revision.',409);
  const sourceIds=new Set(source.lines.map(line=>line.id));
  for(const finding of evidence.canonical?.findings||[])if(finding.sourceLineIds.some(id=>!sourceIds.has(id)))throw new FormalError('Canonical evidence has unknown source references.');
  if(evidence.derivation){
    const claims=new Set(pkg.claims.map(claim=>claim.id));
    for(const step of evidence.derivation.steps)if(step.sourceLineIds.some(id=>!sourceIds.has(id))||step.claimIds.some(id=>!claims.has(id)))throw new FormalError('Derivation evidence has unknown source or claim references.');
    const ids=evidence.derivation.checks.map(check=>check.id);
    if(new Set(ids).size!==ids.length)throw new FormalError('Derivation evidence has duplicate check references.');
  }
}
function premiseLinks(pkg:FormalPackage,claimIds:string[],coverage:CoverageResult[],sourceLineIds:string[]) {
  const inputIds=unique(coverage.filter(item=>overlaps(item.claimIds,claimIds)).flatMap(item=>item.inputIds));
  return {inputIds, assumptionIndexes:pkg.assumptions.map((_,index)=>index), conditions:[] as string[]};
}
function sourceEvidence(sourceLineIds:string[]):ClaimEvidenceReference[]{return sourceLineIds.map(id=>ref('source-line',id,'mapped','Exact numbered submitted source line.'));}
function premiseRequirement(id:string,pkg:FormalPackage,inputIds:string[]):ClaimVerificationRequirement {
  return {id:`${id}-premises`,title:'Declared premises and domain',kind:'premise',status:'accepted-premise',
    detail:inputIds.length?'These exact mapped inputs are adopted premises. Their adoption is visible and is not an independent proof of physical applicability.':'The approved package-level assumptions and declared symbol domains condition this calculation. No finer input dependency is invented where the source mapping does not supply one.',
    evidence:inputIds.map(inputId=>ref('declared-input',inputId,'declared',pkg.selectedInputs.find(input=>input.id===inputId)?.title||inputId)),dependsOn:[],supportedAdapterIds:[]};
}
function sourceRequirement(id:string,sourceLineIds:string[]):ClaimVerificationRequirement {
  return {id:`${id}-source`,title:'Connection to the submitted claim',kind:'source-fidelity',status:sourceLineIds.length?'source-supported':'open',
    detail:sourceLineIds.length?'The candidate is mapped to these numbered source lines. A source link records provenance; it does not itself machine-prove that every natural-language interpretation is faithful.':'No exact source span is mapped to this formal candidate. Its relationship to the submitted paper must be established before representing it as a checked paper claim.',
    evidence:sourceEvidence(sourceLineIds),dependsOn:[],supportedAdapterIds:[]};
}
function decide(requirements:ClaimVerificationRequirement[],fallback:ClaimObligationDisposition):ClaimObligationDisposition {
  if(requirements.some(item=>item.status==='contradicted'))return 'contradicted';
  if(requirements.some(item=>item.status==='open'))return 'open';
  return fallback;
}
function mathematicalObligation(pkg:FormalPackage,source:IngestedSource,claim:FormalClaim,coverage:CoverageResult[],evidence:ClaimVerificationPlanEvidence):ClaimVerificationObligation {
  const id=`claim-${claim.id}`,matched=coverage.filter(item=>item.claimIds.includes(claim.id));
  const sourceLineIds=unique([...matched.flatMap(item=>item.sourceLineIds),...(pkg.analysis?.claimReferences.find(item=>item.claimId===claim.id)?.sourceLineIds||[])]);
  const dependency=definitionDependencies(pkg,claim),premises=premiseLinks(pkg,[claim.id],coverage,sourceLineIds);
  const result=evidence.verification.claims.find(item=>item.id===claim.id);
  const dimensions=result?.dimensions;
  const exactStatus=result?.status==='contradicted'?'contradicted':result?.status==='checked'&&dimensions==='consistent'?'checked':'open';
  const requirements:ClaimVerificationRequirement[]=[sourceRequirement(id,sourceLineIds),premiseRequirement(id,pkg,premises.inputIds),{
    id:`${id}-equation`,title:'Exact mathematical equality',kind:'mathematical',status:exactStatus,
    detail:result?`${result.message}${result.residual?` Residual: ${result.residual}.`:''}`:'No checker result exists for this formal candidate.',
    evidence:result?[ref('scalar-check',claim.id,result.status,result.title)]:[],dependsOn:[`${id}-premises`],supportedAdapterIds:['scalar-expression']
  },{
    id:`${id}-dimensions`,title:'Dimensional and declared-domain consistency',kind:'domain',status:dimensions==='mismatch'?'contradicted':dimensions==='consistent'?'checked':'open',
    detail:dimensions==='consistent'?'The submitted expression has consistent declared SI dimensions; the listed domain restrictions still apply.':dimensions==='mismatch'?'The exact submitted expression has a dimensional mismatch. Check the translation before concluding that the paper itself is wrong.':'The current checker did not establish dimensions for this expression.',
    evidence:result?[ref('scalar-check',claim.id,dimensions||'missing',`Dimensions: ${dimensions||'missing'}.`)]:[],dependsOn:[`${id}-premises`],supportedAdapterIds:['scalar-expression']
  }];
  if(dependency.cycles.length)requirements.push({id:`${id}-definitions`,title:'Noncircular definitions',kind:'premise',status:'open',detail:`The dependency traversal encountered a definition cycle: ${dependency.cycles.join(', ')}. It must be resolved or explicitly treated as an implicit relation.`,evidence:[],dependsOn:[],supportedAdapterIds:[]});
  const definition=result?.derivationKind==='definition-restatement';
  const disposition=decide(requirements,definition?'definition':'proved-under-premises');
  return {id,title:claim.title,statement:claim.explanation,kind:'mathematical',target:{claimIds:[claim.id],coverageIds:matched.map(item=>item.id),inputIds:premises.inputIds,sourceLineIds},equation:{lhs:claim.lhs,rhs:claim.rhs},disposition,
    materiality:disposition==='contradicted'?'material':disposition==='open'?'clarification':'information',requirements,
    premises:{...premises,definitionSymbols:dependency.symbols,conditions:unique([...premises.conditions,...(result?.domainRestrictions||[]),...pkg.symbols.filter(symbol=>unique([...expressionSymbols(claim.lhs),...expressionSymbols(claim.rhs)]).includes(symbol.name)).map(symbol=>`${symbol.name}: ${symbol.domain}`)])},
    evidence:distinctEvidence(requirements.flatMap(item=>item.evidence)),
    counterexampleStrategy:{method:'Compute the residual and dimensional consistency under the declared definitions and symbol domains; a nonzero residual is a counterexample to this exact formal equality. Testing alternative physical premises is a separate obligation.',scope:'This approved scalar expression and its declared premises; no numerical search over all possible physical theories.',performed:!!result&&['checked','contradicted'].includes(result.status),outcome:result?.status==='contradicted'?'counterexample-found':exactStatus==='checked'?'no-counterexample-in-checked-expression':'not-run'},
    conclusion:disposition==='proved-under-premises'?'The exact mathematical candidate is checked under its declared premises. This alone does not select a physical action, boundary prescription, empirical model, or unique mechanical interpretation.':disposition==='definition'?'This candidate restates a definition; its consistency is recorded separately from an independently derived identity.':disposition==='contradicted'?'The submitted formal candidate has a failed exact or dimensional condition. Source and translation must be inspected before attributing the failure to the paper.':'This mathematical candidate has a specific unresolved check or source dependency.',
    nextActions:requirements.filter(item=>item.status==='open'||item.status==='contradicted').map(item=>item.status==='contradicted'?`Inspect and correct or justify: ${item.title}.`:`Complete: ${item.title}.`)};
}

function relatedEvidence(item:CoverageResult,evidence:ClaimVerificationPlanEvidence):ClaimEvidenceReference[] {
  const findings=(evidence.canonical?.findings||[]).filter(finding=>overlaps(finding.sourceLineIds,item.sourceLineIds));
  const standards=(evidence.assessment?.acceptedStandards||[]).filter(standard=>overlaps(standard.sourceLineIds,item.sourceLineIds)||overlaps(standard.claimIds,item.claimIds));
  const sections=(evidence.literature?.sections||[]).filter(section=>overlaps(section.sourceLineIds,item.sourceLineIds));
  const paperIds=unique(sections.flatMap(section=>section.paperIds));
  const geometry=evidence.geometry && overlaps(evidence.geometry.sourceLineIds,item.sourceLineIds)?evidence.geometry.checks:[];
  return distinctEvidence([...sourceEvidence(item.sourceLineIds),...item.inputIds.map(inputId=>ref('declared-input',inputId,'declared','Mapped adopted input.')),
    ...item.claimIds.flatMap(claimId=>{const result=evidence.verification.claims.find(check=>check.id===claimId);return result?[ref('scalar-check',claimId,result.status,result.title)]:[];}),
    ...findings.map(finding=>ref('canonical-finding',finding.id,finding.status,finding.title)),
    ...standards.map(standard=>ref('assessment-standard',standard.id,standard.basis,standard.statement)),
    ...geometry.map(check=>ref('geometry-check',check.id,check.status,check.title)),
    ...paperIds.flatMap(paperId=>{const paper=evidence.literature?.papers.find(record=>record.id===paperId);return paper?[ref('literature-paper',paper.id,paper.evidenceLevel,paper.title)]:[];})]);
}
function canonicalRequirement(id:string,item:CoverageResult,evidence:ClaimVerificationPlanEvidence):ClaimVerificationRequirement {
  const derivation=evidence.derivation;
  const applicable=derivation?.applicability.status==='matched' && overlaps(item.sourceLineIds,derivation.applicability.sourceLineIds);
  const linkedSteps=applicable?derivation.steps.filter(step=>overlaps(step.sourceLineIds,item.sourceLineIds)):[];
  const coreStep=linkedSteps.find(step=>step.id==='derive-length-work');
  // The stationary area–boost route is an optional alternative, not a required
  // premise of the direct null-scalar chain. Select a supported terminal step
  // and its ancestors rather than treating every available route as necessary.
  const matchedSteps=coreStep?[coreStep]:linkedSteps;
  const stepIds=new Set(matchedSteps.map(step=>step.id));
  // Trace prerequisite steps transitively: an end coefficient check cannot hide
  // an open clock, boundary/polarization or action premise earlier in the chain.
  const collect=(stepId:string) => {const step=derivation?.steps.find(candidate=>candidate.id===stepId);if(!step)return;for(const dependency of step.dependsOn)if(!stepIds.has(dependency)&&derivation!.steps.some(candidate=>candidate.id===dependency)){stepIds.add(dependency);collect(dependency);}};
  for(const step of matchedSteps)collect(step.id);
  const steps=applicable?derivation.steps.filter(step=>stepIds.has(step.id)):[];
  // A source-linked computed step is still conditional on the explicitly listed
  // action/polarization premises. It must never be upgraded to a general theorem.
  const obligations=applicable?derivation.obligations.filter(obligation=>obligation.stepIds.some(stepId=>stepIds.has(stepId))):[];
  const checks=applicable?derivation.checks.filter(check=>steps.some(step=>step.checkIds.includes(check.id))):[];
  const negative=checks.some(check=>check.kind==='derivation'&&check.status==='contradicted');
  const neededPremises=applicable?derivation.premises.filter(premise=>steps.some(step=>step.premiseIds.includes(premise.id))):[];
  const open=steps.some(step=>step.status==='open')||obligations.some(obligation=>obligation.status==='open')||neededPremises.some(premise=>premise.status==='missing');
  const broadClaim=/\b(?:arbitrary|general|all|any|every|unrestricted)\b.{0,70}\b(?:covariant|corner|boundary|horizon|moving|evolving)\b|\b(?:covariant|corner|moving|evolving)\b.{0,55}\b(?:arbitrary|general|all|any|every|unrestricted)\b/i.test(item.statement)&&!/\b(?:not|no|never|does not|without)\b/i.test(item.statement);
  const potentialOnlyUniqueness=/uniquely|unique (?:canonical|boundary|action|polarization)|(?:potential|rewrit).{0,65}(?:guarantee|force|determin).{0,45}(?:canonical|action|polarization)/i.test(item.statement)&&!/not unique|not uniquely|does not|cannot|can not|is not|no unique|neither/i.test(item.statement);
  const foreignPhysicalMeaning=/\b(?:thermal|temperature|entropy|Newton|Newtonian|inverse[- ]square)\b|new interaction|gravitational interaction/i.test(item.statement);
  const supported=steps.length>0&&!open&&!negative&&!broadClaim&&!potentialOnlyUniqueness&&!foreignPhysicalMeaning&&checks.some(check=>check.kind==='derivation'&&check.status==='checked');
  const findings=(evidence.canonical?.findings||[]).filter(finding=>overlaps(finding.sourceLineIds,item.sourceLineIds));
  const contradicted=findings.some(finding=>finding.status==='contradicted');
  return {id:`${id}-canonical`,title:'Canonical origin of the mechanical response',kind:'canonical-structure',status:negative||contradicted?'contradicted':supported?'source-supported':'open',
    detail:foreignPhysicalMeaning?'This assertion includes thermal, Newtonian or new-interaction meaning beyond the restricted action response. Shared potential symbols or product identities cannot establish that additional physics; state its independent inputs and test the precise extra implication.':potentialOnlyUniqueness?'The source appears to infer a unique canonical action or polarization from the potential alone. The implemented exact-counterterm control supplies an alternative response with the same energy function. Formalize the claimed uniqueness implication precisely and resolve it; a derivative identity cannot discharge this requirement.':broadClaim?'This source assertion appears broader than the implemented stationary/nonexpanding derivation. Specify its exact quantified domain and provide a suitable verifier; a restricted match cannot certify arbitrary covariant, corner, moving-boundary or horizon claims.':supported?'The restricted derivation reconstructs the response in its explicitly selected action, polarization, clock, cuts and allowed-variation sector. Its named physical/theorem premises remain premises; the computation does not certify an unrestricted covariant boundary/corner theorem.':'A derivative of a chosen potential establishes a mathematical conjugate, but selecting it as the physical boundary force requires the action/boundary prescription, polarization, clock and cut conventions, allowed variations, and any applicable corner or boundary counterterms. The claim does not uniquely determine these choices.',
    evidence:distinctEvidence([...findings.map(finding=>ref('canonical-finding',finding.id,finding.status,finding.title)),...checks.map(check=>ref('derivation-check',check.id,check.status,check.title)),...obligations.map(obligation=>ref('derivation-obligation',obligation.id,obligation.status,obligation.title))]),
    dependsOn:item.claimIds.map(claimId=>`claim-${claimId}`),supportedAdapterIds:['restricted-canonical-chain']};
}
function sourceObligation(pkg:FormalPackage,item:CoverageResult,coverage:CoverageResult[],evidence:ClaimVerificationPlanEvidence):ClaimVerificationObligation {
  const id=`source-${item.id}`,context=['scope','citation','metadata'].includes(item.role);
  const isCanonical=!context&&(canonicalLanguage.test(item.statement)||(horizonLanguage.test(`${pkg.title} ${pkg.mainClaim} ${item.statement}`)&&mechanicalLanguage.test(item.statement)&&!/\bFRW\b|cosmolog|Friedmann|Misner|Cai.?Kim|Akbar|\bthermal\b|\btemperature\b|\bentropy\b|\bNewton(?:ian)?\b|inverse[- ]square|new interaction/i.test(item.statement)&&['physical-input','interpretation'].includes(item.role)));
  const premises={...premiseLinks(pkg,item.claimIds,coverage,item.sourceLineIds),inputIds:item.inputIds.slice()},references=relatedEvidence(item,evidence);
  const requirements:ClaimVerificationRequirement[]=[sourceRequirement(id,item.sourceLineIds)];
  let fallback:ClaimObligationDisposition='open';
  if(item.role==='definition')fallback='definition';
  else if(context)fallback='context';
  else if(item.role==='physical-input'){
    fallback=item.inputIds.length?'declared-input':'open';
    requirements.push(item.inputIds.length?premiseRequirement(id,pkg,item.inputIds):{id:`${id}-premise`,title:'State the physical input and its applicability',kind:'premise',status:'open',detail:'The source labels a physical starting assertion, but it has no linked adopted input. Formalize its statement, domain and supporting framework before treating it as a premise.',evidence:references,dependsOn:[],supportedAdapterIds:[]});
  } else if(item.role==='mathematical') {
    fallback=item.status==='checked'?'proved-under-premises':item.status==='definition'?'definition':'open';
    requirements.push({id:`${id}-mathematics`,title:'Check the complete source assertion',kind:'mathematical',status:item.status==='contradicted'?'contradicted':item.status==='checked'||item.status==='definition'?'checked':'open',detail:item.status==='checked'?'All mapped formal candidates pass. The physical interpretation and source fidelity remain separate.':`Source coverage status is ${item.status}. ${item.reason}`,evidence:references.filter(reference=>reference.kind==='scalar-check'),dependsOn:item.claimIds.map(claimId=>`claim-${claimId}`),supportedAdapterIds:['scalar-expression']});
  } else if(item.role==='interpretation') {
    const standards=references.filter(reference=>reference.kind==='assessment-standard');
    fallback=standards.length?'conditionally-supported':'open';
    requirements.push({id:`${id}-interpretation`,title:'Justify the interpretation within a stated domain',kind:'premise',status:standards.length?'source-supported':'open',detail:standards.length?'The current scientific assessment explicitly accepts a source-linked standard or interpretation. This is source-supported scientific judgment, not independent machine proof of the physical premise.':'The interpretation requires an explicit argument connecting the checked construction to the physical meaning claimed. A formula alone cannot select that meaning.',evidence:standards,dependsOn:item.claimIds.map(claimId=>`claim-${claimId}`),supportedAdapterIds:[]});
  } else if(item.role==='empirical') {
    requirements.push({id:`${id}-empirical`,title:'Compare predictions with empirical evidence',kind:'empirical',status:'open',detail:'No observational or experimental data validator is present in this evidence bundle. Specify the prediction, data, measurement model, uncertainty and reproducible comparison; a symbolic identity cannot establish empirical adequacy.',evidence:[],dependsOn:item.claimIds.map(claimId=>`claim-${claimId}`),supportedAdapterIds:[]});
  } else if(!context) {
    requirements.push({id:`${id}-formalization`,title:'Classify and formalize this source assertion',kind:'source-fidelity',status:'open',detail:'This numbered source material has not been mapped to a complete checkable assertion. Identify its premises, mathematical statement and intended scope before choosing a verifier.',evidence:references,dependsOn:[],supportedAdapterIds:[]});
  }
  if(isCanonical) {
    const requirement=canonicalRequirement(id,item,evidence);requirements.push(requirement);
    // A full canonical source assertion can have no scalar candidate even when a
    // newly reconstructed restricted chain supports it. Retain its original
    // coverage status and expose this separate conditional evidence instead.
    if(requirement.status==='source-supported'&&item.role==='mathematical'&&item.status!=='contradicted'){
      const math=requirements.find(entry=>entry.id===`${id}-mathematics`)!;
      math.status='source-supported';math.detail='The original scalar coverage remains unchanged. The additional restricted canonical chain supplies a source-linked, premise-conditional derivation of this assertion in its matched domain.';
      math.evidence=distinctEvidence([...math.evidence,...requirement.evidence]);
      fallback='conditionally-supported';
    }
    if(requirement.status==='source-supported'&&item.role==='interpretation'){
      const interpretation=requirements.find(entry=>entry.id===`${id}-interpretation`)!;
      interpretation.status='source-supported';interpretation.detail='The mechanical interpretation is supported in the reconstructed restricted canonical sector and its declared premises, rather than inferred from the potential derivative alone.';fallback='conditionally-supported';
    }
  }
  const contradictedDependencies=item.claimIds.filter(claimId=>evidence.verification.claims.some(check=>check.id===claimId&&(check.status==='contradicted'||check.dimensions==='mismatch')));
  if(!context&&item.role!=='definition'&&contradictedDependencies.length)requirements.push({id:`${id}-blocked`,title:'Resolve failed mapped mathematical prerequisites',kind:'mathematical',status:'contradicted',detail:'A mapped exact mathematical candidate fails. A source-supported interpretation or adopted physical input cannot override this contradiction in the tested expression.',evidence:references.filter(reference=>reference.kind==='scalar-check'&&contradictedDependencies.includes(reference.id)),dependsOn:contradictedDependencies.map(claimId=>`claim-${claimId}`),supportedAdapterIds:['scalar-expression']});
  const disposition=decide(requirements,fallback),open=requirements.filter(requirement=>requirement.status==='open');
  const materiality:ClaimVerificationObligation['materiality']=disposition==='contradicted'?'material':item.role==='empirical'&&open.length?'material':context||['declared-input','definition','proved-under-premises','conditionally-supported'].includes(disposition)?'information':'clarification';
  const hasContradiction=disposition==='contradicted';
  return {id,title:item.statement.slice(0,180),statement:item.statement,kind:isCanonical?'canonical':item.role==='metadata'?'scope':item.role,target:{claimIds:item.claimIds.slice(),coverageIds:[item.id],inputIds:item.inputIds.slice(),sourceLineIds:item.sourceLineIds.slice()},disposition,materiality,requirements,
    premises:{...premises,definitionSymbols:unique(pkg.claims.filter(claim=>item.claimIds.includes(claim.id)).flatMap(claim=>definitionDependencies(pkg,claim).symbols))},
    evidence:distinctEvidence([...references,...requirements.flatMap(requirement=>requirement.evidence)]),
    counterexampleStrategy:{method:isCanonical?'Keep the algebraic potential fixed while varying an allowed boundary term/polarization or clock normalization. Test whether the same physical response still follows, and inspect exact negative controls for dropped variation terms. A match in a restricted sector does not rule out inequivalent canonical structures outside it.':item.role==='empirical'?'Reproduce the quantitative prediction with a declared data set and uncertainty model, then test competing models and residuals.':item.role==='mathematical'?'Compute the mapped exact residual under declared premises, then test whether the source assertion claims more than those expressions.':'Seek a concrete counterexample to the stated implication within its specified domain; distinguish unsupported extrapolation from an actual contradiction.',scope:isCanonical?'The explicitly selected boundary mechanics sector; no universal or unique canonical prescription is inferred.':item.role==='empirical'?'The specified empirical prediction and measurement conditions.':'The exact mapped source assertion and its declared domain.',performed:hasContradiction,outcome:hasContradiction?'counterexample-found':'not-run'},
    conclusion:disposition==='conditionally-supported'?'Supported by the linked assessment or restricted derivation under its explicit premises; not unconditional physical truth or general covariant certification.':disposition==='proved-under-premises'?'The complete mapped mathematical assertion is checked under declared premises; broader physical claims remain separate.':disposition==='declared-input'?'Explicit adopted input: subsequent checks can establish consequences without pretending to prove this premise.':disposition==='definition'?'Definition or convention, distinguished from a newly established physical consequence.':disposition==='context'?'Context, citation or stated scope retained for provenance; not scored as a scientific claim failure.':hasContradiction?'A linked exact tested condition fails; inspect the source and translation before judging the manuscript.':'A concrete dependency remains open. This is not itself evidence that the claim is false.',
    nextActions:open.map(requirement=>requirement.kind==='canonical-structure'?'Provide or select the precise action, boundary/corner prescription, polarization, clock/cut normalization and allowed variations; run the matched restricted derivation or add a new verifier for the stated sector.':`${requirement.title}: ${requirement.detail}`).concat(hasContradiction?['Inspect the exact failed expression and its source translation before revising the scientific conclusion.']:[])};
}

/** Build a deterministic dependency plan from existing evidence. This function
 * neither performs inference nor executes author code, approves a revision,
 * changes old coverage labels, or claims to infer a unique physical theory. */
export function buildClaimVerificationPlan(pkg:FormalPackage,source:IngestedSource,digest:string,evidence:ClaimVerificationPlanEvidence):ClaimVerificationPlan {
  assertBinding(pkg,source,digest,evidence);
  const coverage=buildCoverage(pkg,evidence.verification,source);
  const obligations=[...pkg.claims.map(claim=>mathematicalObligation(pkg,source,claim,coverage,evidence)),...coverage.map(item=>sourceObligation(pkg,item,coverage,evidence))];
  const references=distinctEvidence(obligations.flatMap(obligation=>obligation.evidence));
  // Source-line and adopted-input links already live in target/premises. Avoid
  // duplicating them in every proof edge while retaining the global registry.
  const compactReferences=(items:ClaimEvidenceReference[])=>items.filter(item=>!['source-line','declared-input'].includes(item.kind)).map(({kind,id,status})=>({kind,id,status}));
  const compactObligations=obligations.map(obligation=>({...obligation,evidence:compactReferences(obligation.evidence),requirements:obligation.requirements.map(requirement=>({...requirement,evidence:compactReferences(requirement.evidence)}))}));
  const count=(disposition:ClaimObligationDisposition)=>obligations.filter(obligation=>obligation.disposition===disposition).length;
  const checks=evidence.verification.claims;
  const open=obligations.filter(obligation=>obligation.disposition==='open');
  const canonicalMatched=evidence.derivation?.applicability.status==='matched';
  const hasCanonical=obligations.some(obligation=>obligation.kind==='canonical');
  const contradiction=count('contradicted');
  return {version:'claim-verification-plan-v1',packageDigest:digest,sourceId:source.id,sourceSha256:source.sha256,method:'deterministic-evidence-mapping',
    headline:contradiction?'Exact failed conditions need inspection':open.length?'Checked consequences and remaining dependencies are separated':'Every mapped obligation has an explicit disposition',
    summary:'This ledger starts from each formal candidate and each numbered source assertion, shows what it depends on, links existing evidence, and names the next check when a dependency is open. A mathematical identity, an adopted physical premise, a source-supported canonical derivation and empirical truth are different outcomes.',mainClaim:pkg.mainClaim,
    summaryCounts:{formalCandidates:pkg.claims.length,checkedIdentities:checks.filter(check=>check.status==='checked'&&check.dimensions==='consistent'&&check.derivationKind!=='definition-restatement').length,definitionRestatements:checks.filter(check=>check.status==='checked'&&check.dimensions==='consistent'&&check.derivationKind==='definition-restatement').length,
      sourceAssertions:coverage.length,scientificSourceAssertions:coverage.filter(item=>!['citation','scope','metadata'].includes(item.role)).length,obligations:obligations.length,provedUnderPremises:count('proved-under-premises'),conditionallySupported:count('conditionally-supported'),declaredInputs:count('declared-input'),definitions:count('definition'),contextual:count('context'),open:open.length,contradicted:contradiction,openMaterial:open.filter(obligation=>obligation.materiality==='material').length,openClarifications:open.filter(obligation=>obligation.materiality==='clarification').length,
      distinctEvidence:{scalarChecks:references.filter(reference=>reference.kind==='scalar-check').length,canonicalChecks:references.filter(reference=>reference.kind==='canonical-check').length,geometryChecks:references.filter(reference=>reference.kind==='geometry-check').length,derivationChecks:references.filter(reference=>reference.kind==='derivation-check').length,citedPapers:references.filter(reference=>reference.kind==='literature-paper').length}},
    adapters:[{id:'scalar-expression',title:'Exact scalar expressions and declared dimensions',status:'available',scope:'The approved declarative expression language: identities, finite derivatives, substitutions and dimensions under stated definitions and domains.',limitations:['No arbitrary submitted code, general PDE theorem, empirical model or physical interpretation is certified.']},
      {id:'restricted-canonical-chain',title:'Restricted canonical derivation',status:hasCanonical?'bounded':'not-applicable',scope:canonicalMatched?'The structurally matched Einstein horizon potential and the explicitly stated stationary/nonexpanding boundary sector.':'No validated structural match is available; canonical language can request this adapter but cannot select or pass it by itself.',limitations:['An action, polarization and normalization are physical/theorem inputs, not consequences uniquely forced by rewriting a potential.','A complete differential does not eliminate allowed boundary counterterm, exact-potential, clock or corner ambiguities.','General covariant and moving-boundary claims need a separately specified and implemented verifier.']},
      {id:'rindler-geometry',title:'Uniformly accelerated Rindler geometry',status:evidence.geometry?.status==='not-applicable'||!evidence.geometry?'not-applicable':'bounded',scope:'The fixed Minkowski pullback, acceleration and rest-slice distance checks in the declared uniformly accelerated domain.',limitations:['No universal proper-distance interpretation or physical canonical force follows from this geometry alone.']},
      {id:'literature-evidence',title:'Source and literature assessment',status:evidence.literature?'bounded':'not-applicable',scope:'Actual available source passages, search records and source-linked comparisons.',limitations:['Metadata is not a read proof. A bounded search cannot certify historical firstness or all literature.']},
      {id:'general-theorem-or-empirical',title:'Unspecified theorem or empirical claim',status:'not-applicable',scope:'The planner can identify missing hypotheses, definitions, data or required proof machinery, but no universal truth engine is available.',limitations:['Adding a claim requests the corresponding proof obligation; it does not guarantee that an existing tool can discharge it.']}],
    evidence:references,obligations:compactObligations,assumptions:pkg.assumptions.map((statement,index)=>({index,statement})),
    limits:['Obligations and exact checks are different counting units: several source assertions may depend on the same check. Counts are not a whole-paper truth percentage or probability.','Source links record traceability, not a machine proof of natural-language interpretation.','Package-level assumptions are listed transparently; a fine-grained dependency is not invented where the approved analysis has not supplied one.','A positive scientific assessment cannot override a contradicted exact expression or supply missing empirical evidence.','The potential-to-work-coordinate inference is conditional on a chosen canonical structure. Algebra alone does not uniquely identify the physical potential, force, clock, boundary/corner terms, or allowed variations.']};
}

/** Eligible targets are source-level interpretations or inputs. The scientific
 * model may assess their meaning; it may not rescore an exact scalar candidate. */
export function claimSourceJudgmentTargets(plan:ClaimVerificationPlan):ClaimVerificationObligation[] {
  return plan.obligations.filter(obligation=>['interpretation','canonical','physical-input'].includes(obligation.kind) && !obligation.equation && !['proved-under-premises','definition','context'].includes(obligation.disposition));
}

/** Validate a separately stored scientific overlay. Coverage is required for
 * every still-open eligible source interpretation, not for already computed
 * mathematics, adopted conventions or historical context. This function never
 * mutates the plan or promotes a qualitative opinion into an exact proof. */
export function validateClaimSourceJudgments(value:unknown,plan:ClaimVerificationPlan,options:{requireOpenCoverage?:boolean}={}):ClaimSourceJudgment[] {
  if(!Array.isArray(value)||value.length>plan.obligations.length)throw new FormalError('Source judgments must be a bounded list of existing source obligations.');
  const eligible=new Map(claimSourceJudgmentTargets(plan).map(obligation=>[obligation.id,obligation]));
  const knownEvidence=new Map(plan.evidence.map(item=>[`${item.kind}:${item.id}`,item]));
  const seen=new Set<string>();
  const result=value.map((raw:unknown):ClaimSourceJudgment=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new FormalError('Invalid source judgment.');
    const item=raw as Record<string,unknown>;
    if(Object.keys(item).some(key=>!['obligationId','outcome','reason','sourceLineIds','evidenceRefs'].includes(key)))throw new FormalError('Source judgment contains unsupported fields.');
    if(typeof item.obligationId!=='string'||!eligible.has(item.obligationId)||seen.has(item.obligationId))throw new FormalError('Source judgment must target a distinct existing non-mathematical source obligation.');
    seen.add(item.obligationId);
    const target=eligible.get(item.obligationId)!;
    if(typeof item.outcome!=='string'||!['source-supported','contextual','needs-input','contradicted'].includes(item.outcome))throw new FormalError('Invalid source judgment outcome.');
    if(typeof item.reason!=='string'||item.reason.trim().length<10||item.reason.length>6000)throw new FormalError('A source judgment needs a concrete, bounded reason.');
    if(!Array.isArray(item.sourceLineIds)||!item.sourceLineIds.length||item.sourceLineIds.length>target.target.sourceLineIds.length||item.sourceLineIds.some(id=>typeof id!=='string'||!target.target.sourceLineIds.includes(id))||new Set(item.sourceLineIds).size!==item.sourceLineIds.length)throw new FormalError('Source judgment must cite exact source lines belonging to its target.');
    if(!Array.isArray(item.evidenceRefs)||item.evidenceRefs.length>80)throw new FormalError('Source judgment needs bounded existing evidence references.');
    const evidenceRefs=item.evidenceRefs.map((rawRef:unknown)=>{
      if(!rawRef||typeof rawRef!=='object'||Array.isArray(rawRef))throw new FormalError('Invalid source judgment evidence reference.');
      const evidence=rawRef as Record<string,unknown>;
      if(Object.keys(evidence).some(key=>!['kind','id'].includes(key))||typeof evidence.kind!=='string'||typeof evidence.id!=='string'||!knownEvidence.has(`${evidence.kind}:${evidence.id}`))throw new FormalError('Source judgment cites evidence absent from this exact plan.');
      return {kind:evidence.kind as ClaimEvidenceReference['kind'],id:evidence.id};
    });
    if(new Set(evidenceRefs.map(reference=>`${reference.kind}:${reference.id}`)).size!==evidenceRefs.length)throw new FormalError('Source judgment evidence references must be distinct.');
    if(['source-supported','contextual'].includes(String(item.outcome)) && (target.disposition==='contradicted'||target.requirements.some(requirement=>requirement.status==='contradicted')))throw new FormalError('A positive source judgment cannot override a contradicted exact mathematical prerequisite.');
    if(item.outcome==='source-supported'&&!evidenceRefs.some(reference=>{
      const evidence=knownEvidence.get(`${reference.kind}:${reference.id}`)!;
      return !['source-line','declared-input'].includes(reference.kind)&&!(reference.kind==='literature-paper'&&evidence.status==='metadata');
    }))throw new FormalError('Source support needs existing mathematical, assessed or substantive source evidence; a bare source link, declaration or metadata record is not enough.');
    return {obligationId:item.obligationId,outcome:item.outcome as ClaimSourceJudgment['outcome'],reason:item.reason.trim(),sourceLineIds:item.sourceLineIds as string[],evidenceRefs};
  });
  if(options.requireOpenCoverage!==false){
    const missing=[...eligible.values()].filter(obligation=>obligation.disposition==='open'&&!seen.has(obligation.id));
    if(missing.length)throw new FormalError(`Scientific source judgment omitted ${missing.length} open interpretation or physical-input obligation(s).`);
  }
  return result;
}
