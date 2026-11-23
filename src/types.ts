export type Page = 'overview' | 'studio' | 'demos' | 'incidents' | 'carbon' | 'reports' | 'how' | 'settings';
export type Point = [number, number];
export type Capability = 'zone' | 'traffic' | 'machine_activity';
export interface DetectorOptions { confidence: number; image_size: 416 | 640 | 960 | 1280; iou_threshold: number; analysis_fps: number; vehicle_classes: ('car' | 'motorcycle' | 'bus' | 'truck')[] }
export interface Source { id: string; name: string; duration: number; width: number; height: number; input_type: string; created: number }
export interface Rule { capability: Capability; name: string; instruction: string; points: Point[]; dwell_seconds: number; motion_threshold: number; recipient: string; confirmed: true }
export interface Crossing {
  source_seconds: number;
  track_id: number;
  vehicle_class: string;
  direction: string;
  box: [number, number, number, number];
}
export interface Run { id: string; source_id: string; source_name: string; status: string; stage: string; progress: number; rule: Rule; counts: Record<string, number>; directions?: Record<string, number>; crossings?: Crossing[]; activity_seconds?: number; source_seconds?: number; coverage: string; error?: string; created: number }
export type VisionProvider = 'nvidia' | 'local';
export interface VisionStatus {
  provider: string;
  configured: boolean;
  available: boolean;
  model: string | null;
  detail: string;
  auto_limit: number;
  reachable?: boolean | null;
}
export interface VisionReview {
  status: 'not_requested' | 'queued' | 'processing' | 'completed' | 'failed';
  provider?: VisionProvider;
  model?: string;
  summary?: string;
  limitations?: string;
  frame_count?: number;
  error?: string;
}
export interface Incident { id: string; run_id: string; title: string; detail: string; source_name: string; source_seconds: number; severity: string; operator_status: string; ai_review: string; vision_review?: VisionReview; frames: string[]; created: number; history: {action: string; note: string; at: number}[] }
export interface CarbonEstimate { name: string; kind: string; kg: number; label: string; formula: string; factor_source: string; basis: string; coverage: string; run_id?: string | null }
export interface CarbonEntry extends CarbonEstimate { id: string; created: number }
export interface Notification { id: string; status: string; subject: string; recipient: string; text: string; delivery?: string; error?: string }
export interface Status { worker_online: boolean; worker_age_seconds: number | null; email_mode: string; ai_review: string; vision?: VisionStatus; recipients: string[]; max_upload_mb: number; max_video_seconds: number; deployment: string }
export interface Data { status: Status | null; sources: Source[]; runs: Run[]; events: Incident[]; carbon: CarbonEntry[]; notifications: Notification[] }
