// Canonical v15 prompt stages.
// Keep this file as the source of truth; do not paste full external instruction
// documents here. Add only the stage prompts the app actually uses.

export const DATE_METADATA_EXTRACTION_V15_PROMPT = String.raw`Extract display metadata for the paper. This stage is outside blind scoring.

Use the manuscript itself first. Use filename hints, embedded PDF metadata, DOI, or arXiv metadata only as fallback.

Return valid JSON only:
{
  "displayedTitle": "",
  "displayedAuthors": [],
  "arxivId": "",
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
- Return the full paper title, not a running header, journal name, arXiv id, DOI, abstract sentence, section heading, or filename.
- Return paper authors only: personal names in manuscript order. Omit affiliations, departments, emails, footnote markers, ORCID ids, and addresses.
- If title or authors are genuinely unrecoverable, use "Unknown Title" or "Unknown Authors".
- Do not use this metadata for blind scoring.`;

export const BLIND_REVIEW_PASS_V15_PROMPT = String.raw`You are reviewing an anonymous scientific manuscript from its contents alone.

Blindness:
- Ignore author identity, institution, venue, citation counts, publication status, dates, historical fame, and later influence.
- Do not use comparator papers in this blind pass.
- Use scientific background knowledge only to judge correctness, novelty, grounding, and conflict with established constraints.
- Do not favor any framework, vocabulary, authorial style, or previously submitted manuscript.

Scientific value:
Scientific merit is correct explanatory compression: important outputs produced from few, firm, fundamental, hard-to-vary inputs through constructions that actually do mathematical, empirical, explanatory, technical, or methodological work.

Correctness is the first gate. If one claim fails but another substantial separable contribution remains correct and valuable, exclude or penalize the failed claim and score the surviving contribution. Treat the whole paper as paper-fatal only when no substantial original scientific contribution survives.

Credit only what the manuscript itself establishes. Do not credit fame, later field influence, citation history, or later corrected descendants.

Build this Input-Construction-Output ledger before scoring:
- primitiveInputs: background facts, equations, definitions, measurements, mathematical results, accepted theories, or assumptions the manuscript needs but does not establish.
- introducedConstructions: new variables, representations, mechanisms, transformations, derivations, formalisms, action terms, ansatzes, algorithms, or organizing principles the manuscript introduces.
- outputs: consequences the manuscript earns from its inputs and constructions. An output may be a new result, recovered known result, constraint, prediction, calculation, classification, method, representation, derivation, or successful match. A known result counts only when the manuscript derives, recovers, explains, constrains, translates, or reorganizes it.
- whyOutputsMatter: prose explaining the significance of the outputs without double-counting them.
- assessment: concise judgment of whether the ledger supports the claimed contribution.

For each output, state:
- what it is;
- which primitive inputs it depends on;
- which introduced constructions it depends on;
- any external context if the output is a new relation inside an existing framework;
- support;
- validity;
- centrality: low, medium, or high.

Evaluate:
- correctness of central claims and outputs;
- input grounding and fundamentality;
- construction strength: correctness, naturalness, simplicity, necessity, hard-to-vary character, non-ad-hocness, and technical usefulness;
- framework independence and framework conditionality;
- originality and manuscript-internal contribution;
- strongest case for importance;
- strongest objection;
- assessmentSensitivity: what evidence, derivation, counterexample, calculation, proof, application, or robustness test would most change the assessment.

Diagnostic subscores:
- inputStrengthScore: 0-10, firmness, fundamentality, minimality, and framework independence of primitive inputs.
- constructionStrengthScore: 0-10, correctness, originality, necessity, hard-to-vary character, and usefulness of introduced constructions.
- outputStrengthScore: 0-10, correctness, support, centrality, independence, breadth, and importance of outputs.

Subscore anchors:
- 0-2: deeply flawed or nearly empty.
- 3-4: suggestive but weak.
- 5-6: competent, incremental, useful but limited, or substantially conditional.
- 7: strong specialized contribution.
- 8: major specialty-level strength.
- 9: rare exceptional strength with strong depth and support.
- 10: truly outstanding on that dimension.

Score anchors:
- 0: wrong, empty, plagiarized, or no real scientific contribution.
- 25: technically coherent but mostly a restatement, minor exercise, or very limited clarification.
- 50: average serious research contribution in the relevant local cohort.
- 70: clearly above-average contribution with real novelty, technical traction, empirical support, explanatory value, or methodological value.
- 85: strong paper; notable field-level contribution or major specialty advance if correct.
- 95: major result with field-shaping potential due to strong correctness, originality, support, output strength, hard-to-vary construction, and adequate input grounding.
- 99: foundational or paradigm-shifting result.
- 100: reserve for an essentially historic, maximally convincing result.

Do not describe the score as a literal percentile over all papers ever published.

Return valid JSON only with this structure:
{
  "title": "anonymized manuscript",
  "authorName": "anonymized",
  "comparisonCohort": "",
  "localCohort": "",
  "broadField": "",
  "specialtyField": "",
  "subfields": [],
  "paperType": "",
  "summary": "",
  "centralClaim": "",
  "contributionArchetype": { "primary": "", "secondary": "" },
  "inputConstructionOutputLedger": {
    "primitiveInputs": [],
    "introducedConstructions": [],
    "outputs": [
      {
        "output": "",
        "dependsOnInputs": [],
        "dependsOnConstructions": [],
        "externalContextIfAny": "",
        "support": "",
        "validity": "",
        "centrality": "low | medium | high"
      }
    ],
    "whyOutputsMatter": "",
    "assessment": ""
  },
  "comparatorProfile": {
    "localCohort": "",
    "adjacentBroadCohort": "",
    "contributionArchetype": { "primary": "", "secondary": "" },
    "primitiveInputs": [],
    "introducedConstructions": [],
    "outputs": [],
    "frameworkConditionality": "low | medium | high",
    "clusterFeatureTags": [],
    "comparatorSearchSummary": ""
  },
  "establishedResults": [],
  "interpretiveClaims": [],
  "speculativeClaims": [],
  "correctness": "",
  "inputGrounding": "",
  "inputFundamentality": "",
  "constructionAssessment": "",
  "outputValidity": "",
  "frameworkIndependence": "",
  "hardToVaryAssessment": "",
  "manuscriptOriginalContribution": "",
  "survivingContributionIfFlawed": "",
  "fatalObjectionPresent": false,
  "paperFatalError": false,
  "fatalToSpecificClaimOnly": false,
  "contributionInventory": [],
  "survivingHighValueContributions": [],
  "failedClaimsExcludedFromScore": [],
  "survivingContributionScoreBasis": "",
  "novelty": "",
  "noveltyConfidence": 0,
  "internalTechnicalTraction": "",
  "economy": "",
  "unifyingPower": "",
  "frameworkConditionality": { "level": "low | medium | high", "explanation": "" },
  "strongestCaseForImportance": "",
  "strongestObjection": "",
  "assessmentSensitivity": "",
  "whatWouldRaiseScore": "",
  "whatWouldLowerScore": "",
  "inputStrengthScore": 0,
  "constructionStrengthScore": 0,
  "outputStrengthScore": 0,
  "subscoreRationale": {
    "inputStrengthScore": "",
    "constructionStrengthScore": "",
    "outputStrengthScore": ""
  },
  "specialtyRelativeScore": 0,
  "broadFieldRelativeScore": 0,
  "crossFieldConsequenceScore": 0,
  "scoreBand": { "low": 0, "median": 0, "high": 0 },
  "scoreConfidence": 0,
  "scoreCappingReason": "",
  "scoreAdjustmentReason": "",
  "bestClassification": "",
  "oneParagraphVerdict": "",
  "finalJudgment": ""
}

All numeric fields must be numbers, not strings.
Use LaTeX for mathematical notation inside strings. Escape every LaTeX backslash as a double backslash inside JSON strings.
Output valid JSON only.`;

export const BLIND_INTRINSIC_ADJUDICATOR_V15_PROMPT = String.raw`You are the blind adjudicator.

You receive compact summaries and two independent blind review passes. Raw manuscript text is intentionally omitted from this payload. Do not use comparator papers, author identity, publication dates, citation history, venue, fame, or later influence.

Produce the final blind intrinsic review using the same v15 JSON schema as the blind passes.

Do not merely average. Audit the two passes for:
- correctness;
- input/construction/output roles;
- output validity;
- failed-claim handling;
- framework conditionality;
- diagnostic subscore consistency;
- whether score and classification match the reasoning.

If a claim or section fails but a substantial separable contribution survives, score the surviving contribution rather than applying a paper-fatal cap.

Return valid JSON only.`;

export const BENCHMARK_COMPARATOR_CALIBRATION_V15_PROMPT = String.raw`Use this stage only after benchmark ingestion/backfill. Do not use it during blind intrinsic review.

You receive the final blind intrinsic review plus candidate in-site comparator profiles.

Assess explanatory delta over the nearest reviewed comparators:
1. Which comparators are genuinely nearest in input/construction/output structure?
2. What does this manuscript produce that the nearest comparators do not?
3. Are those outputs central, correct, and earned?
4. Are the inputs firmer or more fragile than the comparators' inputs?
5. Is the construction simpler, more necessary, more hard-to-vary, or more ad hoc?
6. Does the score gap make scientific sense?
7. Should the calibrated score move up, move down, or remain unchanged?

Do not use fame, citation counts, venue, author identity, or historical influence.
If no adequate in-site comparator exists, set comparatorCalibrationStatus to "not_available" and do not adjust the score.

Return valid JSON only:
{
  "comparatorCalibrationStatus": "not_run | not_available | applied",
  "nearestComparators": [
    {
      "paperId": "",
      "title": "",
      "relationship": "similar | stronger | weaker | prior-source | later-related | adjacent",
      "whyComparable": "",
      "keyDifference": "",
      "relativeScoreExpectation": "above | similar | below"
    }
  ],
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
  "SCIReview Prompt System v15",
  "Canonical staged prompts. The blind reviewer uses only BLIND_REVIEW_PASS_V15_PROMPT plus the diagnostic scoring contract appended by the review engine.",
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
