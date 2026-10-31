/**
 * The one action worth taking on each case study, in the reader's words. The
 * hub card and the case-study header render the same label for the same slug so
 * the two surfaces cannot drift. The destination always comes from the
 * committed manifest's `live.url`.
 */
const PRIMARY_ACTION_LABELS: Record<string, string> = {
  "ecommerce-platform": "Open the live demo",
  "docqa-assistant": "Try it with your own PDF",
  "cicd-pipeline": "Open the demo page",
};

export function primaryActionLabel(slug: string): string {
  return PRIMARY_ACTION_LABELS[slug] ?? "Open the live demo";
}
