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

/** Plain-language labels for saved-camera capture states from the backend. */
export function cameraClipState(state: string) {
  if (state === 'capturing') return 'Recording clips';
  if (state === 'connecting') return 'Connecting to stream';
  if (state === 'reconnecting') return 'Reconnecting to stream';
  if (state === 'stopping') return 'Stopping clip capture';
  if (state === 'stopped' || !state) return 'Not capturing clips';
  if (state === 'capture failed') return 'Clip capture failed — check stream access';
  if (state === 'waiting for analysis capacity') return 'Waiting for the analysis worker';
  if (state.startsWith('storage or source limit')) return 'Storage or source limit reached — archive clips before restarting';
  if (state === 'in use by another operator') return 'In use by another operator';
  return state;
}

/** Plain-language labels for the optional live YOLO preview. */
export function cameraPreviewState(state: string) {
  if (state === 'loading model') return 'Loading detector';
  if (state === 'connecting') return 'Connecting to stream';
  if (state === 'reconnecting') return 'Reconnecting to stream';
  if (state === 'stream unavailable; reconnecting') return 'Stream unavailable — reconnecting';
  if (state === 'preview failed; check model installation and stream access') return 'Preview failed';
  if (state === 'stopping') return 'Stopping preview';
  if (state === 'stopped' || !state) return 'Preview stopped';
  return state;
}
