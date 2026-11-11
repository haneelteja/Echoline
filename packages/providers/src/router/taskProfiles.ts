export type TaskType = "template_generate" | "template_rewrite" | "insights" | "image_generate" | "copilot_chat" | "reply_classify";

export interface TaskProfile {
  outputModality: "text" | "image";
  /** Hard floor — see qualityTiers.ts. */
  minQualityTier: number;
  minContextLength: number;
  /** Prefer a model whose catalog row says it supports real JSON mode. */
  requiresJsonMode: boolean;
}

export const TASK_PROFILES: Record<TaskType, TaskProfile> = {
  // Customer-facing copy — quality matters most, worth paying for a frontier model.
  template_generate: { outputModality: "text", minQualityTier: 3, minContextLength: 8000, requiresJsonMode: true },
  template_rewrite: { outputModality: "text", minQualityTier: 3, minContextLength: 8000, requiresJsonMode: true },
  // Internal analyst commentary — a cheaper tier reads the same stats fine.
  insights: { outputModality: "text", minQualityTier: 2, minContextLength: 4000, requiresJsonMode: false },
  image_generate: { outputModality: "image", minQualityTier: 1, minContextLength: 0, requiresJsonMode: false },
  // Needs headroom for conversation history, not just one prompt.
  copilot_chat: { outputModality: "text", minQualityTier: 2, minContextLength: 16000, requiresJsonMode: false },
  // A short, structured yes/no-shaped classification of an inbound reply —
  // the cheapest tier reads one email fine, no need to pay frontier prices.
  reply_classify: { outputModality: "text", minQualityTier: 1, minContextLength: 2000, requiresJsonMode: true },
};
