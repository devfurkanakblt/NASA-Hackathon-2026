import type { SearchResult, FailureCode } from '../sim/search.ts'

const FAILURE_LABELS: Record<FailureCode, string> = {
  reserve: 'Battery below reserve', unmet: 'Energy demand not served', earthOutage: 'Earth contact outage exceeds limit',
  coverage: 'Mission outside source coverage', data: 'Missing or invalid data', research: 'Research objective not supported',
}

export function plannerDiagnostics(result: SearchResult) {
  const screening = result.durationScreening
  return {
    explanation: screening
      ? screening.coveredStarts === 0
        ? 'No sampled start has usable data for a full 1-day mission. Adjust the date range to the source coverage.'
        : `None of the ${screening.coveredStarts} simulated 1-day missions meets every limit. Extending a failed mission cannot remove its earlier violations. The tie breaker applies only after feasible missions are found.`
      : 'No tested candidate meets every limit. The rejected examples below show the specific causes.',
    denominator: screening?.startsTested ?? result.tested,
    failures: (Object.entries(result.failureCounts) as [FailureCode, number][])
      .filter(([, count]) => count > 0)
      .map(([code, count]) => ({ code, count, label: FAILURE_LABELS[code] })),
  }
}
