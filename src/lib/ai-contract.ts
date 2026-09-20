export type EvidenceFact = { id: string; section: 'Observed Evidence' | 'Analytical Signals'; text: string; hashes: string[]; topics: string[] };
export type EvidenceContext = { facts: EvidenceFact[]; source: string; generatedAt: string; limitations: string[]; label: string };
export type AssistantAnswer = { summary: string; facts: EvidenceFact[]; steps: string[]; limitations: string[]; source: string; generatedAt: string };
export const INSUFFICIENT = 'The available CHAINTRACE evidence is insufficient to determine this.';
export const NOT_CONFIGURED = "AI Assistant is not configured. Investigation evidence remains available through CHAINTRACE's deterministic analytics.";
export const REVIEW_STEPS = {
  receipts: 'Inspect the cited transactions and their receipt status in the block explorer.',
  coverage: 'Review dataset coverage and obtain additional history if the observed window is insufficient.',
  destinations: 'Investigate observed destinations separately before drawing conclusions about subsequent fund movement.',
  attribution: 'Seek independent, reliable attribution evidence before making ownership or service-identity claims.',
  case: 'Compare the cited transfers and shared counterparties in the case analysis workspace.',
  monitoring: 'Review wallet monitoring in CHAINTRACE for subsequent activity; no new monitoring is enabled by this chat.',
} as const;
