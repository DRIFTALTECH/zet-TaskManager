/** Plain-language condition from internal 0–100 score. Never show the numeric score to users. */
export type HealthCondition = 'Doing well' | 'On track' | 'Needs attention' | 'At risk';

export function healthScoreToCondition(score: number): HealthCondition {
  if (score >= 85) return 'Doing well';
  if (score >= 70) return 'On track';
  if (score >= 50) return 'Needs attention';
  return 'At risk';
}
