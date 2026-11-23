import type { Capability, Run } from './types';

export const analysisModes: Record<Capability, { label: string; description: string }> = {
  zone: {label: 'Zone monitoring', description: 'Review people who stay inside a drawn zone.'},
  traffic: {label: 'Traffic & CO₂', description: 'Count vehicles and estimate tailpipe CO₂ for a road segment.'},
  action: {label: 'Fight & fall review', description: 'Flag possible fights and falls for an operator to check.'},
  machine_activity: {label: 'Equipment activity', description: 'Estimate time with visible motion inside a region.'},
};

export function runLink(run: Pick<Run, 'id' | 'source_id'>) {
  return '#videos/' + encodeURIComponent(run.source_id) + '/' + encodeURIComponent(run.id);
}

export function runStatus(run: Run) {
  if (run.status === 'queued') return 'Queued';
  if (run.status === 'processing') return 'Analyzing';
  if (run.status === 'completed') return 'Completed';
  if (run.status === 'failed') return 'Failed';
  return run.status;
}
