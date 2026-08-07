export function canRequestSummary(authenticated: boolean, rank: number) {
  return Number.isInteger(rank) && rank >= 1 && (authenticated || rank <= 3);
}
