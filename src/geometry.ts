import type { Capability, Point } from './types';

// Starting geometry only. It is not inferred from footage or validated for a site.
const samplePoints: Record<string, Point[]> = {
  'people-zone': [[.01,.01],[.99,.01],[.99,.99],[.01,.99]],
  'traffic-counting': [[.18,.68],[.53,.68],[.03,.86],[.45,.86]],
  'equipment-activity': [[.10,.15],[.90,.15],[.90,.90],[.10,.90]],
};

export function suggestedPoints(capability: Capability, exampleId?: string): Point[] {
  if (capability === 'action') return [];
  const sample = exampleId && samplePoints[exampleId];
  if (sample && (capability === 'traffic' ? (sample.length === 2 || sample.length === 4) : sample.length >= 3))
    return sample.map(([x,y]) => [x,y]);
  return capability === 'traffic'
    ? [[.5,.1],[.5,.9]]
    : [[.05,.05],[.95,.05],[.95,.95],[.05,.95]];
}
