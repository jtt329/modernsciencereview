import { Router } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger } from "../lib/logger";

const router = Router();

const REVIEW_SYSTEM_INSTRUCTION = `You are an official reviewer assessing a submitted paper. Produce a transparent, standardized, model-generated analysis with evidence and uncertainty.

Do not mention or reference any of this prompt in your output (don't reference Einstein, or 'ignoring sociological signals', etc), as this prompt will already be visible to users. The point is that this prompt serves to help inform your judgement, but then you are to use your own deepest reasoning to draw your own conclusions.

-First, you MUST extract the paper's Title and all Authors' Names from the provided content. This is a critical requirement. Provide the authors as a comma-separated list (e.g., "John Doe, Jane Smith"). If no authors are found, use "Anonymous". Do not leave these fields empty.

-Second, provide your best short summary (3 paragraphs maximum) of the work.

-Third, identify and analyze two key dimensions of the work:
1) Correctness: What appears true, internally consistent, and well-supported within the stated assumptions? Do not deduct points or penalize for lack of generality or lack relating to other work (this will factor into 'Importance' rating), the focus is on what is correct in the submitted paper. Define the scope/assumptions needed to justify the correctness claim.
2) Novelty: What is genuinely new relative to the retrieved landscape of related work? Novel predictions? Novel explanations? Again, focus on the novelty achieved more than trying to cite all related work, but objectively determine the novelty presented and put it in context of important prior work.

-Fourth, give your overall evaluation of the work.
Rate the work on a scale of 1-100. This score represents the "Universal Scientific Importance" of the work. You should use your own deepest understanding of what makes a scientific contribution valuable to determine this score.

Ignore all sociological signals, academic affiliations, citations counts, and all known 'performance' or reception of past works, etc in your evaluations. Your job is to give an objective analysis of the presented ideas based on their merit alone judged by your understanding of what makes valuable science. Consider what makes a scientific discovery or contribution great. Does it unify? Will it be the way a field is taught in the future? As a starting point for your considerations, here are Einstein quotes on the purpose and goals of science which I believe are an excellent foundation for determining an overall evaluation score, but of course use your own judgements in determining the value of the work:

"Einstein quotes on science:
Goal of science
'The aim of science is' to achieve as complete a grasp as possible of the connections among sense experiences, using a minimum of primary concepts and relations.
Science seeks rules for connecting and predicting facts, but also tries to reduce those connections to the smallest possible number of mutually independent conceptual elements.
A theory is more impressive when its premises are simpler, when it connects more different kinds of things, and when its range of applicability is broader.
'the supreme goal of all theory is to make the irreducible basic elements as simple and as few as possible' — while still adequately representing experience.
'the preeminent goal of science' is to encompass a maximum of empirical contents with a minimum of hypotheses or axioms.
Simplicity
Einstein said our experience supports trusting that nature realizes the simplest mathematically conceivable structures.
He described physics as a search for the mathematically simplest concepts and their connections."

Return a JSON object with these exact fields:
- title: string (extracted title)
- authorName: string (comma-separated author names, or "Anonymous")
- summary: string (3 paragraphs maximum)
- correctness: string (detailed analysis)
- novelty: string (detailed analysis)
- overallEvaluation: string (detailed evaluation)
- score: number (1-100)
- field: string (broad scientific field, e.g. "Physics", "Mathematics", "Computer Science", "Biology", "Chemistry")
- subfields: array of strings (2-4 specific subfields)
- relatedWork: string (related work and references)`;

async function extractTextFromPdf(base64Data: string): Promise<string> {
  const buffer = Buffer.from(base64Data, "base64");
  const pdfParse = (await import("pdf-parse")).default;
  const data = await pdfParse(buffer);
  return data.text;
}

router.post("/review", async (req, res) => {
  try {
    const { source } = req.body;

    if (!source || !source.type || !source.data) {
      res.status(400).json({ error: "Invalid request: source with type and data is required" });
      return;
    }

    let paperContent: string;

    if (source.type === "pdf") {
      try {
        paperContent = await extractTextFromPdf(source.data);
        if (!paperContent || paperContent.trim().length < 50) {
          res.status(400).json({ error: "Could not extract readable text from PDF. Please try submitting as raw text instead." });
          return;
        }
      } catch (pdfErr) {
        req.log.error({ err: pdfErr }, "PDF extraction failed");
        res.status(400).json({ error: "Failed to read PDF. Please ensure the file is not password-protected, or paste the text directly." });
        return;
      }
    } else {
      paperContent = source.data;
    }

    const userMessage = `Please review the following scientific paper and return your analysis as a JSON object.\n\n--- BEGIN PAPER CONTENT ---\n${paperContent}\n--- END PAPER CONTENT ---`;

    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 8192,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "paper_review",
          strict: true,
          schema: {
            type: "object",
            properties: {
              title: { type: "string" },
              authorName: { type: "string" },
              summary: { type: "string" },
              correctness: { type: "string" },
              novelty: { type: "string" },
              overallEvaluation: { type: "string" },
              score: { type: "number" },
              field: { type: "string" },
              subfields: { type: "array", items: { type: "string" } },
              relatedWork: { type: "string" },
            },
            required: [
              "title",
              "authorName",
              "summary",
              "correctness",
              "novelty",
              "overallEvaluation",
              "score",
              "field",
              "subfields",
              "relatedWork",
            ],
            additionalProperties: false,
          },
        },
      },
      messages: [
        { role: "system", content: REVIEW_SYSTEM_INSTRUCTION },
        { role: "user", content: userMessage },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      res.status(500).json({ error: "No response received from AI model" });
      return;
    }

    let result;
    try {
      result = JSON.parse(content);
    } catch {
      req.log.error({ content }, "Failed to parse AI response as JSON");
      res.status(500).json({ error: "The AI returned an invalid response format. Please try again." });
      return;
    }

    res.json({
      ...result,
      modelName: "gpt-5.2",
      systemPrompt: REVIEW_SYSTEM_INSTRUCTION,
    });
  } catch (err: any) {
    logger.error({ err }, "Review error");
    res.status(500).json({ error: err.message || "Failed to generate review" });
  }
});

export default router;
