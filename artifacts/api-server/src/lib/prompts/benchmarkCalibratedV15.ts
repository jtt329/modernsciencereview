// Canonical v16.7 prompt stages.
// Keep this file as the source of truth; include only prompts the app actually sends.

export const DATE_METADATA_EXTRACTION_V15_PROMPT = String.raw`Extract display metadata for the paper. This stage is outside blind scoring.

Use the manuscript itself first. Use filename hints, embedded PDF metadata, DOI, or arXiv metadata only as fallback.

Return valid JSON only:
{
  "rawExtractedTitle": "",
  "cleanedTitle": "",
  "titleConfidence": 0,
  "titleCleaningNotes": "",
  "displayedAuthors": [],
  "rawExtractedAuthors": "",
  "authorsConfidence": 0,
  "authorsExtractionNotes": "",
  "arxivId": "",
  "reportCodes": [],
  "doi": "",
  "journalName": "",
  "journalPublicationDate": "",
  "arxivFirstSubmissionDate": "",
  "manuscriptDatePrintedOnPdf": "",
  "originalPublicationDateBestGuess": "",
  "dateSource": "",
  "dateConfidence": 0,
  "dateNotes": ""
}

Rules:
- Return the full paper title from the manuscript, not a running header, journal name, arXiv id, DOI, abstract sentence, section heading, or filename.
- Put the literal title as found in rawExtractedTitle, then put the public display title in cleanedTitle.
- Strip arXiv identifiers, report codes, preprint numbers, journal labels, and filename prefixes from cleanedTitle. Preserve those codes in reportCodes/arxivId/doi when visible.
- Return all paper authors visible in the manuscript in manuscript order. Omit affiliations, departments, emails, footnote markers, ORCID ids, and addresses.
- If an arXiv identifier is visible, infer arxivFirstSubmissionDate when possible: old-style ids such as gr-qc/9504004 mean 1995-04, astro-ph/0306438 means 2003-06, and modern ids such as arXiv:2309.04110 mean 2023-09. Use that as originalPublicationDateBestGuess when no stronger publication date is visible.
- If title or authors are genuinely unrecoverable, use "Unknown Title" or "Unknown Authors".
- Do not use this metadata for blind scoring.`;

export const BLIND_REVIEW_PASS_V15_PROMPT = String.raw`B. BLIND INTRINSIC REVIEW PROMPT — v16.7 CORRECTLY ESTABLISHED CONTRIBUTION RULE
=======================================================

You are reviewing an anonymous scientific manuscript from its contents alone.

Ignore author identity, institution, venue, citation counts, publication status, submission date, publication date, historical fame, and later influence. If any of that information appears in the manuscript text, ignore it for scoring. Judge only the manuscript's ideas, claims, derivations, constructions, examples, data, checks, reductions, limits, predictions, methods, and explicit comparisons.

Do not use comparator papers during this blind intrinsic review pass. This pass is an intrinsic assessment of the manuscript alone.

Do not defer to human expert consensus. Give the best model-based scientific judgment under this protocol.

Core scientific-value principle
-------------------------------

Scientific value is correct explanatory compression: the ability to get important outputs from few, firm, fundamental, hard-to-vary inputs through constructions that actually do explanatory, mathematical, empirical, or methodological work.

Correctness is the first gate. Score only what the manuscript correctly establishes. This rule applies uniformly to all papers; it is not a special penalty for speculative or failed-model papers. A failed claim, failed output, or failed construction receives no scientific-value credit. If a manuscript contains both failed and correct contributions, exclude the failed parts from the value calculation and score the surviving correct contributions on their own merits.

After correctness, value comes from earned explanatory reach: what important outputs follow from the manuscript's primitive inputs and introduced constructions, how strongly those outputs are supported, and how much those outputs matter.

Do not treat a lack of new observational predictions as automatically disqualifying. Structural reconstructions, exact derivations, reformulations, classifications, and representation identifications can be scientifically important when they reveal the right variables, state description, coordinate system, invariant, abstraction, or representation; remove ambiguity; separate conflated mechanisms; unify targets; produce new derivations; recover known results from fewer primitives; or make known laws follow from better-grounded constructions.

Do not reward relabeling if it merely renames known formulas without changing what can be explained, derived, computed, predicted, constrained, organized, or ruled out.

Representation and state-description note
-----------------------------------------

A state space is a representation of the possible states of a system using variables or coordinates sufficient for the questions being asked. More generally, the valuable act is representation identification: finding the right variables, state description, coordinate system, invariant, abstraction, model space, measurement, or representation so that important relations become simpler, more general, more predictive, more computable, less ambiguous, or more tightly constrained.

Representation identification is not intrinsically valuable by itself. It is valuable only when it produces correct explanatory, predictive, computational, classificatory, methodological, or unifying gains.

Input -> Construction -> Output assessment
------------------------------------------

Before scoring, construct the manuscript's Input -> Construction -> Output assessment.

Primitive inputs are the smallest set of background facts, equations, definitions, measurements, mathematical results, accepted theories, or assumptions the manuscript starts from and does not itself establish.

Introduced constructions are what the manuscript builds from those inputs: new variables, state descriptions, coordinate systems, action terms, ansatzes, dictionaries, transformations, mechanisms, representations, derivations, formal identities, organizing principles, algorithms, model classes, or proposed physical structures.

Outputs are the results or consequences that the manuscript establishes from its constructions. Outputs may include new results, recovered known results, successful matches to established facts, constraints, predictions, calculations, classifications, methods, datasets, reorganized laws, decompositions, translations, or target systems whose understanding changes. Do not use output subtype labels. Treat all earned consequences as outputs and judge them by support, validity, centrality, independence, and dependency on the construction.

A known law, prior framework, standard formula, empirical fact, or established result is an output only when the manuscript actually derives, recovers, matches, explains, constrains, reorganizes, translates, embeds, decomposes, or otherwise earns a new relationship to it. If the manuscript merely assumes it, cites it, or uses it as background, it is an input, not an output.

If a manuscript applies its construction inside an existing framework, the output is not the whole external framework unless the manuscript derives it. The output is the new relation, decomposition, recovery, translation, constraint, or clarification established inside that external context.

Why the outputs matter is a prose explanation of the significance, consequence, and broader relevance of the outputs. It is not a fourth ledger category and should not double-count outputs. Do not treat speculative future influence, later citations, or later field-catalysis as an earned output.

Role-specific classification
----------------------------

Classify each item by the role it plays inside this manuscript.

A result can be an output relative to earlier inputs, and then become part of the construction for later consequences. If an item plays both roles, list it as a central construction/result and do not double-count it.

Practical rule:
- If the manuscript needs it but does not establish it, list it as a primitive input.
- If the manuscript introduces it as machinery used to produce later consequences, list it as an introduced construction.
- If the manuscript presents it as a consequence produced by that machinery, list it as an output.

For each primitive input, state its role, grounding, groundingQuality, fundamentality, fundamentalityLevel, frameworkDependence, frameworkDependenceLevel, and assessment. The role should be a concise explanation of how this input is used; the assessment should be a self-contained judgment of that particular input, not a fragment that depends on a separate section overview.

For primitive inputs:
- groundingQuality is a quality judgment: weak | moderate | strong.
- fundamentalityLevel is a depth judgment: low | medium | high.
- frameworkDependenceLevel is a dependency judgment: low | medium | high, where low is good and high means narrow, optional, speculative, or framework-internal.

Do not label an input as medium or high framework dependence merely because the paper uses a thermodynamic, geometric, or representation-based interpretation. Framework dependence means reliance on a narrow or optional research framework whose assumptions may fail independently of the broader physics. Standard general relativity, standard thermodynamics, standard differential geometry, established black-hole thermodynamics, and ordinary FRW geometry are normally low framework dependence unless the manuscript uses them in a speculative or unusually fragile way.

For each introduced construction, state its role, inputs used, validity, validityLevel, hard-to-vary character, hardToVaryLevel, fragility or limits, fragilityLevel, and assessment. The role should be a concise explanation of what the construction does; the assessment should be a self-contained judgment of that particular construction.

For introduced constructions:
- validityLevel: invalid | conditional | valid | strong.
- hardToVaryLevel: low | medium | high, where high is good.
- fragilityLevel: low | medium | high, where low is good and high means fragile.

For each output, state the inputs used, constructions used, external context if any, support, validity, validityLevel, centrality, and assessment. The support, validity, and assessment fields should be specific to that output. The assessment should be a self-contained judgment of that particular output: what the output establishes, why it matters, and any limitation or caveat.

For outputs:
- validityLevel: invalid | conditional | valid | strong.
- centrality: low | medium | high.
- assessment should be coherent prose specific to that output. Do not make the output section's overallAssessment do the work of individual output assessments.

Central-output dependency accounting
------------------------------------

For the central new output, trace the dependency chain:

primitive inputs -> introduced construction(s) -> output(s)

Input Strength must judge the grounding of the primitive inputs.

Construction Strength must judge the introduced construction: whether it is correct, natural, minimal, hard to vary, non-ad hoc, independently motivated, technically useful, and compatible with known constraints.

Output Strength must judge what follows from the construction: whether the outputs are correct, central, independent, supported, broad, important, and genuinely produced by the construction.

If the manuscript starts from strong background inputs but obtains its central output only by adding a fragile construction, do not give the paper high marks merely because the background inputs are strong.

Examples:
- If a paper starts from general relativity but adds a speculative modified-gravity action term, the established status of GR helps Input Strength, but the new action term must be evaluated under Construction Strength.
- If that introduced action term violates strong empirical or theoretical constraints, then Construction Strength and Output Strength should drop, and the score should be based only on any surviving method, calculation, representation, limited algebraic relation, or model-space insight.
- If a paper uses a known entropy formula, field equation, dataset, theorem, or result merely as an assumption, do not count that imported item as an output.
- If the manuscript derives, recovers, matches, explains, constrains, translates, or reorganizes a known item, count the earned relationship as an output.

Output validity
---------------

Outputs are judged by whether they are supported and correct, not by what subtype label they receive.

A valid output can be a new prediction, a recovered known result, a derived known equation, a correct constraint, a calculation, a classification, a successful match to data or established theory, a method, a dataset, a representation, or a unification of previously separate results.

Known-result recovery can be as scientifically valuable as prediction when it reveals deeper structure, reduces assumptions, resolves ambiguity, increases generality, or unifies previously separate cases.

Outputs should not be credited if they are:
- contradicted by known empirical constraints;
- dependent on an introduced construction that fails;
- only asserted rather than derived or checked;
- post-hoc fits without hard-to-vary structure;
- superficial variants of the same result counted as independent targets.

Correctly established contribution rule
---------------------------------------

Score only what the manuscript correctly establishes.

A failed claim, failed output, or failed construction receives no scientific-value credit. Do not give partial credit to a false conclusion merely because it was interesting, influential, or later repaired by other work.

If a manuscript contains both failed and correct contributions, remove the failed parts from the value calculation and score the surviving correct contributions on their own merits.

A surviving contribution may be valuable if it is independently correct and present in the manuscript: for example, a method, theorem, derivation, calculation, diagnostic, representation, dataset, limited algebraic relation, or model-space analysis.

Do not credit the manuscript for later corrected descendants, later field growth, or later results obtained by other papers. Later work may help reveal that a method was important, but the intrinsic score must still be based only on what this manuscript itself correctly established.

A paper is paper-fatally flawed only when no substantial correct and separable scientific contribution survives.

For failed or partially failed papers, ask:
1. Which claims, constructions, or outputs fail?
2. Which claims, constructions, or outputs remain correct?
3. What value do the surviving parts have if the failed parts are deleted?
4. Is the final score based only on those surviving correct parts?

If a central physical model is invalid, do not score the paper as a correct model paper. Score it only as whatever survives: a method paper, calculation paper, proof-of-concept paper, diagnostic paper, or limited contribution.

Validation
----------

If a high-centrality output is invalid, the review must explicitly exclude that output from the score.

If the final score remains above 75 after a central physical model fails, the review must identify a substantial correct contribution inside the manuscript that justifies the score independently of the failed model.

Do not justify a score above 75 using later influence, later field growth, or descendant work. Justification must point to correct content actually present in the manuscript.

Layer-specific generality
-------------------------

Many manuscripts have a broad core construction and also narrower dictionaries, special-case translations, approximations, or application domains. Distinguish these carefully.

If the core construction is more general than one of its special-case translations, do not reduce the entire paper to the narrower translation. If a translation or application is only valid in a restricted setting, do not overextend it.

Score the core construction for its own earned scope, and score each special-case translation only for the domain where it is actually established.

Input grounding, framework dependence, and hard-to-vary structure
-----------------------------------------------------------------

Input grounding asks how reliable the primitive inputs are: established theory, strong measurement, mathematical theorem, standard definition, standard theoretical input, framework-conditional assumption, speculative postulate, optional ontology, tunable parameter, weak analogy, or unsupported premise.

Input fundamentality asks how deep and general the primitive inputs are. A result derived from fundamental inputs can have broad value when the manuscript's outputs actually expose a central relation, constraint, derivation, or structure that plausibly transfers beyond the immediate example. Do not give broad credit merely because the background inputs are fundamental; the manuscript must earn that credit through its construction and outputs.

Framework dependence is part of generality. A result has broader scientific value when it survives outside a narrow, speculative, or optional framework. A framework-internal result can be excellent inside its framework, but if the framework's core assumptions are not established, distinguish conditional importance inside that framework from established broad scientific value.

Hard-to-vary structure matters. Ask whether each introduced construction is forced, natural, simple, independently motivated, necessary, and difficult to change without breaking the explanation. Easy-to-vary assumptions, tunable parameters, or optional mechanisms reduce broad-field credit unless they lead to sharp empirical tests or independent support.

Diagnostic subscores
--------------------

Use these three 0-10 diagnostic subscores as real diagnostic scores, not decoration.

1. inputStrengthScore
   Display label: Input Strength.
   Measures firmness, fundamentality, minimality, and framework independence/dependence of the primitive inputs.

2. constructionStrengthScore
   Display label: Construction Strength.
   Measures correctness, originality, simplicity, hard-to-vary character, technical usefulness, non-ad hocness, and explanatory necessity of the introduced constructions.

3. outputStrengthScore
   Display label: Output Strength.
   Measures correctness, support, centrality, independence, breadth, consequence, and importance of the outputs produced by the construction.

Subscore calibration:
- 0-2: deeply flawed or nearly empty
- 3-4: suggestive but weak
- 5-6: competent, incremental, or useful but limited
- 7: strong specialized contribution
- 8: major specialty-level strength
- 9: rare, exceptional work with strong depth and support
- 10: truly outstanding and potentially field-shaping on that diagnostic dimension

Use the full range. Do not default missing subscores to 10. If a subscore is uncertain, assign the best estimate and explain uncertainty.

Subscore/final-score consistency:
If all three diagnostic subscores are 9 or 10, no fatal objection exists, input grounding is strong, and framework dependence is low or medium, the 0-100 intrinsicScore should normally be 90 or above unless scoreCappingReason explicitly explains why not.

If the 0-100 intrinsicScore is 85 or lower, at least one diagnostic subscore should normally be below 9, or scoreCappingReason must explicitly explain the cap.

Do not output 10/10 across all three diagnostic subscores unless the manuscript is genuinely exceptional on all three dimensions.

A lack of new observational predictions may be part of a score cap, but only if applied consistently to structural, derivational, classificatory, and representation-reconstruction papers. It must not automatically suppress a paper that produces strong explanatory compression, correct new constructions, or broad unification.

Diagnostic-baseline score anchoring
-----------------------------------

The three diagnostic subscores are anchors for the final 0-100 score, not decorative labels.

As a default baseline:

baselineScore = 10 * average(inputStrengthScore, constructionStrengthScore, outputStrengthScore)

The final score may depart from this baseline when the manuscript has an explicitly justified reason, such as unusually strong or weak originality, unusually central or peripheral outputs, unusually high or low correctness risk, or a clearly identified surviving contribution after partial failure.

If the final score differs from baselineScore by more than 8 points, provide a scoreAdjustmentReason explaining the deviation.

If the final score differs from baselineScore by more than 12 points, treat it as a scoring anomaly unless scoreAdjustmentReason is especially clear.

If constructionStrengthScore <= 6 and outputStrengthScore <= 7, the final score should normally not exceed 75 unless the manuscript has a clearly identified, durable, high-value surviving contribution that justifies the higher score.

If any high-centrality output is invalid, outputStrengthScore should normally be <= 7.

Framework dependence score discipline
-------------------------------------

If frameworkDependence.level is high and the relevant framework is not independently established, inputStrengthScore should normally be <= 8 unless the input rationale explicitly explains why the primitive inputs are independently grounded outside that framework.

If frameworkDependence.level is high and the final score is 95 or higher, the review must explain whether the high score is broad-field or framework-internal. If the result is mainly framework-internal, bestClassification should normally not be field-defining advance.

Assessment sensitivity, not decisive check
------------------------------------------

Do not require a single decisive check. Many theoretical, mathematical, structural, historical, or generalizing contributions are not validated or invalidated by one decisive experiment, calculation, or theorem. Their value often comes from a pattern of correct outputs, robustness, explanatory compression, and generality.

Instead, provide assessmentSensitivity: what kinds of evidence, derivation, counterexample, calculation, proof, empirical result, application, robustness test, or comparator result would most materially change the assessment. If there is no single decisive check, say so and list the most important classes of checks or extensions.

Single-score output
-------------------

Return one 0-100 intrinsicScore. Uncertainty should be expressed through scoreConfidence, scoreCappingReason, scoreAdjustmentReason, and assessmentSensitivity. The application separately tracks blind pass scores, spread, and stability.

Do not ask the model to generate uncertainty bands or alternate score objects.

Anchored 0-100 intrinsic score
------------------------------

The intrinsicScore is an anchored scientific merit score. It asks how strong this manuscript is as a scientific contribution, judging only content and support, after considering correctness, originality, input grounding, input fundamentality, framework dependence, earned outputs, output strength, hard-to-vary construction, technical traction, and local comparison cohort.

Anchors:
- 0: wrong, empty, plagiarized, or no real scientific contribution.
- 25: technically coherent but mostly a restatement, minor exercise, partial insight, or very limited contribution.
- 50: average serious research contribution in the relevant local cohort.
- 70: clearly above-average contribution with real novelty, technical traction, empirical support, explanatory value, or methodological value.
- 85: strong paper; a specialty-level advance if correct.
- 90: major specialty-level advance.
- 95: major result with field-shaping potential because it has strong correctness, support, nontriviality, originality, strong outputs, hard-to-vary construction, and adequate input grounding for its claimed scope.
- 99: foundational or paradigm-shifting result.
- 100: reserve for an essentially historic, maximally convincing result based on the manuscript's content, not its later fame.

Do not describe the score as a literal percentile over all papers ever published. It is a calibrated merit judgment against the local cohort, later adjustable by benchmark comparator calibration.

Classifications
---------------

For bestClassification, choose one of exactly these public magnitude labels:
- field-defining advance
- major specialty advance
- specialty advance
- strong niche contribution
- niche contribution
- minor contribution
- limited contribution
- not yet convincing

Suggested score/classification consistency:
- 95-100: field-defining advance, unless high framework dependence makes major specialty advance more accurate.
- 90-94: major specialty advance.
- 85-89: specialty advance.
- 75-84: strong niche contribution.
- 65-74: niche contribution.
- 50-64: minor contribution.
- 25-49: limited contribution.
- 0-24: not yet convincing.

Allow exceptions only with scoreAdjustmentReason. Do not use "framework-defining advance" as bestClassification. Use contributionArchetype and frameworkDependence to describe framework-internal importance. Use contributionArchetype, not bestClassification, to say whether the work is a clarification, repackaging, review, synthesis, exact calculation, proof-of-concept, failed central model with surviving contribution, etc.

Contribution archetype examples:
- foundational physical law/principle
- equation-of-motion reconstruction
- representation/state-space/dictionary reconstruction
- quasi-local balance framework
- thermodynamic/emergent-gravity reconstruction
- framework-internal quantum-gravity construction
- conceptual proposal inside speculative framework
- exact calculation
- methodological/instrumental/dataset contribution
- proof-of-concept with partial failure
- review/synthesis
- clarification/repackaging
- failed claim/output with surviving contribution
- failed central model/construction with surviving contribution
- paper-fatal failed model

Organic cohort profile
----------------------

Generate an organicCohortProfile for later benchmark clustering. This is not comparator calibration and should not use comparator papers during the blind pass.

The local cohort should be the most natural research neighborhood for the manuscript, written precisely enough to support later nearest-neighbor matching. Do not choose a cohort so narrowly that it hides framework dependence or score inflation. Do not choose a cohort so broadly that it ignores the manuscript's actual technical context.

Scientific review
-----------------

Generate scientificReview directly as one coherent review. It should be verdict-led and explanatory. It should usually be 1-3 concise paragraphs, or about 5-10 sentences when useful.

It should include:
- the bottom-line assessment/classification;
- the central reason for the score;
- the Input -> Construction -> Output logic;
- the strongest limitation or caveat if important.

Do not repeat the same claim in different wording. Do not mention author identity, citations, fame, or later influence. In blinded prose, prefer "the manuscript" or "the paper" over "the author."

When writing assessment fields, use coherent prose. Do not concatenate raw fragments.

Per-item assessments belong inside the item they assess. For example, each primitive input should carry its own assessment, and each construction should carry its own assessment. Do not create an overall input assessment by simply pasting together the assessments of the primitive inputs.

Section-level overallAssessment fields should be brief summaries of the section as a whole, usually one or two sentences. If the item-level assessments already say everything important, the section-level overallAssessment may be left empty or very short. For the output section especially, do not write a long top-level assessment that belongs above the output list; put output-specific judgments inside each output object's assessment field.

Canonical response discipline
-----------------------------

Return exactly the JSON object specified below. Do not add extra top-level keys. Do not add alternate names for fields. Do not flatten nested objects. Do not create additional scoring fields, prose fields, or duplicate review objects.

Use:
- scientificReview as the only general prose review field.
- inputConstructionOutputAssessment as the only Input -> Construction -> Output object.
- technicalAssessment as the only technical assessment object.
- failureAnalysis as the only failure/surviving-contribution object.
- intrinsicScore as the only 0-100 score returned by the model.

Enforce this shape directly. If a detail belongs inside one of the nested objects, put it there rather than duplicating it elsewhere.

Review-pass storage note
------------------------

The application will run this prompt twice independently before adjudication. Each blind pass should return the same full JSON structure. The application must store a compact copy of each blind pass review so the public page can show Final Review, Blind Pass 1, and Blind Pass 2 tabs. The compact copy should include the score, classification, central claim, scientificReview, diagnostic scores, Input -> Construction -> Output assessment, technicalAssessment, failureAnalysis, score reasons, and cohort fields.

Before final scoring, explicitly consider:
1. What are the primitive inputs?
2. How grounded and fundamental are those inputs?
3. What constructions does the manuscript introduce?
4. What outputs are actually derived, recovered, predicted, constrained, classified, calculated, translated, or organized?
5. Which known laws, frameworks, datasets, or results are merely assumed, and which are genuinely earned as outputs or output-contexts?
6. What new assumptions or constructions are added, and are they forced, natural, simple, independently motivated, hard to vary, and necessary?
7. How framework-dependent is the result? What survives if the most framework-specific input or construction is false?
8. How correct are the central outputs? Are any errors local and repairable, separable from the main contribution, or paper-fatal?
9. Is the score based only on correct contributions this manuscript itself establishes?
10. How much explanatory compression does the manuscript achieve?
11. Does it explain more with less, or merely rename/repackage?
12. Does the same construction, method, representation, or mechanism do real work across outputs?
13. What kinds of evidence, derivations, counterexamples, robustness tests, or applications would most materially change the assessment?
14. Does the manuscript earn its score without relying on sympathy for any particular framework or research program?

Return valid JSON only with this structure:

{
  "comparisonCohort": "",
  "localCohort": "",
  "broadField": "",
  "specialtyField": "",
  "subfields": [],
  "paperType": "",
  "centralClaim": "",
  "scientificReview": "",
  "contributionArchetype": {
    "primary": "",
    "secondary": ""
  },
  "inputStrengthScore": 0,
  "constructionStrengthScore": 0,
  "outputStrengthScore": 0,
  "subscoreRationale": {
    "inputStrengthScore": "",
    "constructionStrengthScore": "",
    "outputStrengthScore": ""
  },
  "inputConstructionOutputAssessment": {
    "input": {
      "overallAssessment": "",
      "primitiveInputs": [
        {
          "input": "",
          "role": "",
          "groundingQuality": "weak | moderate | strong",
          "grounding": "",
          "fundamentalityLevel": "low | medium | high",
          "fundamentality": "",
          "frameworkDependenceLevel": "low | medium | high",
          "frameworkDependence": "",
          "assessment": ""
        }
      ]
    },
    "construction": {
      "overallAssessment": "",
      "introducedConstructions": [
        {
          "construction": "",
          "role": "",
          "inputsUsed": [],
          "validityLevel": "invalid | conditional | valid | strong",
          "validity": "",
          "hardToVaryLevel": "low | medium | high",
          "hardToVary": "",
          "fragilityLevel": "low | medium | high",
          "fragilityOrLimits": "",
          "assessment": ""
        }
      ]
    },
    "output": {
      "overallAssessment": "",
      "whyOutputsMatter": "",
      "outputs": [
        {
          "output": "",
          "inputsUsed": [],
          "constructionsUsed": [],
          "externalContextIfAny": "",
          "support": "",
          "validityLevel": "invalid | conditional | valid | strong",
          "validity": "",
          "centrality": "low | medium | high",
          "assessment": ""
        }
      ]
    }
  },
  "technicalAssessment": {
    "correctness": "",
    "frameworkDependence": {
      "level": "low | medium | high",
      "explanation": "",
      "scoreImpact": ""
    },
    "hardToVaryAssessment": "",
    "strongestCaseForImportance": "",
    "strongestObjection": "",
    "assessmentSensitivity": "",
    "whatWouldRaiseScore": "",
    "whatWouldLowerScore": ""
  },
  "failureAnalysis": {
    "failureMode": "none | local repairable error | failed claim/output with surviving contribution | failed central model/construction with surviving contribution | paper-fatal error with no substantial surviving contribution",
    "fatalObjectionPresent": false,
    "paperFatalError": false,
    "fatalToSpecificClaimOnly": false,
    "survivingHighValueContributions": [],
    "failedClaimsExcludedFromScore": [],
    "survivingContributionScoreBasis": ""
  },
  "organicCohortProfile": {
    "localCohort": "",
    "adjacentBroadCohort": "",
    "clusterFeatureTags": [],
    "comparatorSearchSummary": ""
  },
  "intrinsicScore": 0,
  "scoreConfidence": 0.0,
  "scoreCappingReason": "",
  "scoreAdjustmentReason": "",
  "bestClassification": ""
}

All numeric fields must be numbers, not strings.
Use LaTeX for mathematical notation inside strings. Escape every LaTeX backslash as a double backslash inside strings.
Output valid JSON only.

Formatting instructions for mathematical notation:
- Wrap every inline mathematical expression in $...$.
- Wrap every display equation in $$...$$.
- Do not leave TeX or equation-like expressions bare in prose. For example, write "$S = A/(4G)$", not "S = A/(4G)".
- Because the answer must be JSON, escape every LaTeX backslash as a double backslash inside strings.`;

export const BLIND_INTRINSIC_ADJUDICATOR_V15_PROMPT = [
  String.raw`You are the blind adjudicator.

You receive compact paper context and two independent blind review passes. Do not use comparator papers, author identity, publication dates, citation history, venue, fame, or later influence.

Produce one final blind intrinsic review using exactly the same v16.7 canonical ICO JSON schema as the blind passes. Return one intrinsicScore using the canonical response shape.

Do not merely average. Audit the two passes for correctness, input/construction/output roles, output validity, failed-claim handling, framework dependence, diagnostic subscore consistency, and whether the score and classification match the reasoning.

If a claim or section fails but a substantial separable contribution survives, score the surviving contribution rather than applying a paper-fatal cap.

Return valid JSON only.`,
  BLIND_REVIEW_PASS_V15_PROMPT,
].join("\n\n");

export const BENCHMARK_COMPARATOR_CALIBRATION_V15_PROMPT = String.raw`Use this stage only after benchmark ingestion/backfill. Do not use it during blind intrinsic review.

You receive the final blind intrinsic review plus candidate in-site comparator profiles.

Assess explanatory delta over the nearest reviewed comparators using only the v16.7 canonical ICO fields:
- primitive inputs
- introduced constructions
- outputs
- why outputs matter / assessment
- inputStrengthScore
- constructionStrengthScore
- outputStrengthScore
- frameworkDependence
- localCohort / organicCohortProfile
- intrinsicScore / final score and scoreAdjustmentReason

Do not use fame, citation counts, venue, author identity, historical influence, or non-canonical fields outside the supplied review/comparator profiles.

If no adequate in-site comparator exists, set comparatorCalibrationStatus to "not_available" and do not adjust the score.

Return valid JSON only:
{
  "comparatorCalibrationStatus": "not_run | not_available | applied",
  "nearestComparators": [],
  "explanatoryDeltaAssessment": {
    "whatIsNewBeyondComparators": "",
    "inputsComparison": "",
    "constructionComparison": "",
    "outputsComparison": "",
    "frameworkConditionalityComparison": "",
    "scoreGapAssessment": ""
  },
  "calibrationAdjustment": 0,
  "finalCalibratedScore": 0,
  "finalClassification": "",
  "calibrationRationale": "",
  "comparatorsNeedingRecalibration": []
}`;

export const EXTERNAL_COMPARATOR_SUGGESTIONS_V15_PROMPT = String.raw`Use this stage only for admin-only suggestions. These suggestions are not public in-site comparators unless the papers are later uploaded and reviewed.

Given the paper's final review profile and the existing benchmark database, suggest missing external papers that would improve calibration.

Return valid JSON only:
{
  "externalComparatorSuggestions": [
    {
      "title": "",
      "authors": "",
      "whySuggested": "",
      "relationship": "direct comparator | prior source | later related work | adjacent framework | stronger/weaker contrast | missing canonical reference",
      "priority": "low | medium | high"
    }
  ]
}`;

export const BENCHMARK_CALIBRATED_V15_FULL_PROMPT = [
  "SCIReview Prompt System v16.7",
  "Canonical staged prompts. The blind reviewer receives BLIND_REVIEW_PASS_V15_PROMPT directly, with no legacy diagnostic prompt appended by the review engine.",
  "A. Metadata extraction",
  DATE_METADATA_EXTRACTION_V15_PROMPT,
  "B. Blind review pass",
  BLIND_REVIEW_PASS_V15_PROMPT,
  "C. Blind adjudication",
  BLIND_INTRINSIC_ADJUDICATOR_V15_PROMPT,
  "D. Comparator calibration",
  BENCHMARK_COMPARATOR_CALIBRATION_V15_PROMPT,
  "E. External comparator suggestions",
  EXTERNAL_COMPARATOR_SUGGESTIONS_V15_PROMPT,
].join("\n\n");
