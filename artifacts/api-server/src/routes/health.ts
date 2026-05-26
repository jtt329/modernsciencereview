import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { reviewRuntimeInfo } from "../lib/reviewEngineCompat";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/review-runtime", (_req, res) => {
  res.json(reviewRuntimeInfo());
});

export default router;
