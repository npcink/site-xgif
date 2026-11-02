// These phrases describe an AI processing failure, not the collected content.
export function isProcessingReply(value) {
  return /无法按(?:原文|要求)(?:整理|保留|复现)|如需[，,]?我可以|建议改为整理|作为(?:一个)?(?:AI|人工智能)/iu.test(String(value || ""));
}
