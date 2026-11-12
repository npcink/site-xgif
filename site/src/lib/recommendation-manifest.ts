import manifest from "../data/recommendations.json";
import { manifestRecommendationOptions } from "./recommendations.mjs";

type RecommendationKind = "articles" | "images";
type RecommendationRecord = {
  articles?: string[];
  images?: string[];
};

const recommendations = (
  manifest as { recommendations?: Record<string, RecommendationRecord> }
).recommendations || {};

export function staticRecommendationIds(contentId: string, kind: RecommendationKind) {
  const values = recommendations[String(contentId || "").trim()]?.[kind];
  return Array.isArray(values) ? values.filter((value) => typeof value === "string") : [];
}

export function staticRecommendationOptions(contentId: string, kind: RecommendationKind) {
  return manifestRecommendationOptions(manifest, contentId, kind);
}
