import manifest from "../data/recommendations.json";

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
