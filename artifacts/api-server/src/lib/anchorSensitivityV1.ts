// Anchor-sensitivity analysis artifact, published at
// GET /api/stats/anchor-sensitivity. Generated 2026-06-11 under
// pairwise-bt-v1 (prompt hash d29df044413e7d57) from the same cached
// pair judgments — zero new model calls; pre-dates the v2 mapping fix.
// Regenerate at each freeze via the calibration route's dryRunAnchors
// option and replace this constant.
export const ANCHOR_SENSITIVITY_V1 = {
  "artifact": "anchor-sensitivity-analysis",
  "generated": "2026-06-11",
  "calibrationEngine": "pairwise-bt-v1",
  "promptHash": "d29df044413e7d57",
  "note": "Four anchor-set variants fit from the SAME 125 cached pair judgments (zero new model calls). Computed before the v2 mapping + cluster surgery; regenerate under pairwise-bt-v2 at the v19 freeze. Scores are calibrated 0-100.",
  "variants": {
    "A": "six anchors, Cai-Kim 88 as horizon-cohort anchor",
    "B": "six anchors, Padmanabhan 95 instead of Cai-Kim",
    "C": "seven anchors, both pinned (production choice)",
    "M": "minimal two anchors: Particle Creation 100, Mersini-Houghton 7"
  },
  "headline": {
    "papers": 49,
    "maxSpread": 4,
    "papersWithSpreadOver3": 1,
    "claim": "48 of 49 papers move 0-3 points across anchor variants; one (f(R) thermodynamics) moves 4. Two-anchor minimal mapping tracks the seven-anchor mapping within a few points everywhere."
  },
  "rows": [
    {"title": "Information in Black Hole Radiation", "intrinsic": 93, "A": 100, "B": 100, "C": 100, "M": 100},
    {"title": "Black Holes: Complementarity or Firewalls?", "intrinsic": 100, "A": 100, "B": 100, "C": 100, "M": 100},
    {"title": "The Large N Limit of Superconformal Field Theories", "intrinsic": 100, "A": 100, "B": 100, "C": 100, "M": 100},
    {"title": "Dynamical Horizons and Their Properties", "intrinsic": 97, "A": 100, "B": 100, "C": 100, "M": 100},
    {"title": "Holographic Derivation of Entanglement Entropy from AdS", "intrinsic": 100, "A": 100, "B": 100, "C": 100, "M": 100},
    {"title": "Particle Creation by Black Holes", "intrinsic": 100, "A": 100, "B": 100, "C": 100, "M": 100, "anchor": 100},
    {"title": "Thermodynamics of Spacetime: The Einstein Equation of State", "intrinsic": 98, "A": 100, "B": 100, "C": 99, "M": 100},
    {"title": "Quasilocal Energy and Conserved Charges (Brown-York)", "intrinsic": 97, "A": 99, "B": 99, "C": 99, "M": 99},
    {"title": "A Covariant Holographic Entanglement Entropy Proposal", "intrinsic": 98, "A": 99, "B": 99, "C": 99, "M": 99},
    {"title": "Classical and Quantum Thermodynamics of Horizons (Padmanabhan 2002)", "intrinsic": 95, "A": 98, "B": 95, "C": 95, "M": 96, "anchorInBC": 95},
    {"title": "Microscopic Origin of the Bekenstein-Hawking Entropy", "intrinsic": 97, "A": 97, "B": 97, "C": 97, "M": 97},
    {"title": "A Covariant Entropy Conjecture", "intrinsic": 98, "A": 97, "B": 97, "C": 97, "M": 97},
    {"title": "Universal Upper Bound on the Entropy-To-Energy Ratio", "intrinsic": 93, "A": 96, "B": 96, "C": 96, "M": 96},
    {"title": "Black Hole Entropy Is Noether Charge", "intrinsic": 100, "A": 96, "B": 96, "C": 96, "M": 96},
    {"title": "Some Properties of Noether Charge (Iyer-Wald)", "intrinsic": 97, "A": 96, "B": 96, "C": 96, "M": 96},
    {"title": "Particle Emission Rates from a Black Hole (Page)", "intrinsic": 93, "A": 95, "B": 95, "C": 95, "M": 94},
    {"title": "Hawking Radiation as Tunneling", "intrinsic": 93, "A": 95, "B": 95, "C": 95, "M": 93},
    {"title": "Isolated Horizons: The Classical Phase Space", "intrinsic": 93, "A": 95, "B": 95, "C": 95, "M": 95},
    {"title": "Conserved Energy Flux for the Spherically Symmetric System", "intrinsic": 95, "A": 94, "B": 94, "C": 94, "M": 95},
    {"title": "Dimensional Reduction in Quantum Gravity", "intrinsic": 97, "A": 94, "B": 94, "C": 94, "M": 94},
    {"title": "Thermodynamics and/of Horizons: A Comparison", "intrinsic": 88, "A": 94, "B": 91, "C": 92, "M": 93},
    {"title": "The World as a Hologram", "intrinsic": 93, "A": 92, "B": 92, "C": 92, "M": 92},
    {"title": "Unified First Law of Black-Hole Dynamics (Hayward)", "intrinsic": 88, "A": 91, "B": 91, "C": 91, "M": 90},
    {"title": "Statistical Mechanics of the 3D Euclidean Black Hole", "intrinsic": 92, "A": 89, "B": 89, "C": 89, "M": 89},
    {"title": "Relativistic Equations for Adiabatic Spherical Collapse (Misner-Sharp)", "intrinsic": 92, "A": 89, "B": 89, "C": 89, "M": 89},
    {"title": "Increase of Black Hole Entropy in Higher Curvature Gravity", "intrinsic": 88, "A": 89, "B": 89, "C": 89, "M": 89},
    {"title": "Hawking Radiation, the Stefan-Boltzmann Law, and Unitarization", "intrinsic": 78, "A": 88, "B": 88, "C": 88, "M": 87},
    {"title": "Discreteness of Area and Volume in Quantum Gravity", "intrinsic": 88, "A": 88, "B": 88, "C": 88, "M": 88},
    {"title": "Spin Networks and Quantum Gravity", "intrinsic": 88, "A": 88, "B": 88, "C": 88, "M": 88},
    {"title": "Entanglement Equilibrium and the Einstein Equation", "intrinsic": 88, "A": 88, "B": 86, "C": 88, "M": 88},
    {"title": "First Law of Thermodynamics and Friedmann Equations (Cai-Kim)", "intrinsic": 88, "A": 88, "B": 86, "C": 88, "M": 88, "anchorInAC": 88},
    {"title": "What Hawking Radiation Looks Like as You Fall In", "intrinsic": 87, "A": 86, "B": 86, "C": 86, "M": 84},
    {"title": "Non-equilibrium Thermodynamics of Spacetime", "intrinsic": 90, "A": 86, "B": 84, "C": 86, "M": 86},
    {"title": "Cosmological Event Horizons, Thermodynamics, and Particle Creation", "intrinsic": 100, "A": 85, "B": 85, "C": 85, "M": 86},
    {"title": "A Local First Law for Black Hole Thermodynamics", "intrinsic": 87, "A": 85, "B": 85, "C": 85, "M": 85},
    {"title": "Primordial Non-Gaussianity and the Field-Level Cramer-Rao Bound", "intrinsic": 83, "A": 83, "B": 83, "C": 83, "M": 82, "anchorInABC": 83},
    {"title": "Black Hole Entropy and SU(2) Chern-Simons Theory", "intrinsic": 80, "A": 83, "B": 83, "C": 83, "M": 83},
    {"title": "Black Hole Entropy in Higher Curvature Gravity", "intrinsic": 87, "A": 83, "B": 83, "C": 83, "M": 83},
    {"title": "Notes on Black-Hole Evaporation (Unruh)", "intrinsic": 100, "A": 83, "B": 83, "C": 83, "M": 83},
    {"title": "Cosmological Apparent and Trapping Horizons", "intrinsic": 75, "A": 81, "B": 81, "C": 81, "M": 81},
    {"title": "On the Origin of Gravity and the Laws of Newton (Verlinde)", "intrinsic": 88, "A": 78, "B": 77, "C": 78, "M": 80},
    {"title": "The Black Hole Quantum Atmosphere", "intrinsic": 73, "A": 77, "B": 77, "C": 77, "M": 76},
    {"title": "Black Hole Entropy from Loop Quantum Gravity", "intrinsic": 75, "A": 75, "B": 75, "C": 75, "M": 75},
    {"title": "Emergence and Expansion of Cosmic Space (Padmanabhan 2012)", "intrinsic": 82, "A": 73, "B": 73, "C": 73, "M": 76},
    {"title": "Thermodynamic Behavior of Field Equations for f(R) Gravity", "intrinsic": 68, "A": 68, "B": 68, "C": 68, "M": 72, "anchorInABC": 68},
    {"title": "Black Holes and Entropy (Bekenstein)", "intrinsic": 98, "A": 67, "B": 67, "C": 67, "M": 68, "note": "v1 cluster artifact; resolved to 97 under v2 mapping + surgery + bridges, post-dating this analysis"},
    {"title": "A Maximum Force Perspective on Black Hole Thermodynamics", "intrinsic": 52, "A": 50, "B": 50, "C": 50, "M": 52},
    {"title": "Effective Pressure of the FRW Universe", "intrinsic": 30, "A": 30, "B": 30, "C": 30, "M": 33, "anchorInABC": 30},
    {"title": "Charged Rotating Black Hole and the First Law", "intrinsic": 8, "A": 5, "B": 5, "C": 5, "M": 8}
  ]
} as const;
