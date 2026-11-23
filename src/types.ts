export type Page = 'overview' | 'studio' | 'cameras' | 'videos' | 'demos' | 'incidents' | 'carbon' | 'reports' | 'how' | 'settings';
export type Point = [number, number];
export type Capability = 'zone' | 'traffic' | 'machine_activity' | 'action';
export interface DetectorOptions { confidence: number; image_size: 416 | 640 | 960 | 1280; iou_threshold: number; analysis_fps: number; vehicle_classes: ('car' | 'motorcycle' | 'bus' | 'truck')[] }
export interface Source { id: string; name: string; duration: number; width: number; height: number; input_type: string; example_id?: string; camera_id?: string; camera_name?: string; created: number }
export interface Rule { capability: Capability; name: string; instruction: string; points: Point[]; segment_metres?: number | null; action_confidence?: number; dwell_seconds: number; motion_threshold: number; recipients: string[]; alert_cooldown_seconds: number; recipient?: string; confirmed: true }
export interface Crossing {
  source_seconds: number;
  track_id: number;
  vehicle_class: string;
  direction: string;
  box: [number, number, number, number];
}
export interface Run { analysis_settings?: {engine:string; checkpoint?:string|null; classifier?:string; action_confidence?:number; requested_fps?:number}; id: string; source_id: string; source_name: string; status: string; stage: string; progress: number; rule: Rule; counts: Record<string, number>; directions?: Record<string, number>; crossings?: Crossing[]; crossing_reviews?: Record<string, {action:'valid'|'false_positive'; note:string; reviewed_at:number}>; activity_seconds?: number; findings?: {summary:string; limitations:string; basis:string; incident_count:number}; vision_summary?: VisionReview; source_seconds?: number; coverage: string; error?: string; created: number }
export type VisionProvider = 'nvidia' | 'local' | 'typesafe';
export interface VisionStatus {
  provider: string;
  configured: boolean;
  available: boolean;
  model: string | null;
  detail: string;
  auto_limit: number;
  reachable?: boolean | null;
  model_access?: boolean;
}
export interface VisionReview {
  status: 'not_requested' | 'queued' | 'processing' | 'completed' | 'failed';
  provider?: VisionProvider;
  model?: string;
  summary?: string;
  limitations?: string;
  frame_count?: number;
  decision?: 'visible' | 'contradicted' | 'unclear';
  confidence?: number;
  probabilities?: Record<string, number>;
  error?: string;
}
export interface IncidentAlert { status: 'not_requested' | 'queued' | 'suppressed'; reason?: string; rule_key?: string; recipients?: string[]; cooldown_seconds?: number; last_alert_at?: number; suppressed_until?: number; notification_ids?: string[] }
export interface Incident { id: string; run_id: string; title: string; detail: string; source_name: string; source_seconds: number; severity: string; operator_status: string; ai_review: string; vision_review?: VisionReview; frames: string[]; created: number; history: {action: string; note: string; at: number}[]; alert?: IncidentAlert }
export interface CarbonEstimate { name: string; kind: string; kg: number; label: string; formula: string; factor_source: string; basis: string; coverage: string; run_id?: string | null }
export interface CarbonEntry extends CarbonEstimate { id: string; created: number }
export interface Notification { id: string; status: string; subject: string; recipient: string; text: string; delivery?: string; error?: string }
export interface AnalysisModels { traffic: {detector: string; tracker: string}; action: {detector: string; classifier: string; checkpoint_present: boolean; upload_enabled: boolean} }
export interface Status {
  models?: AnalysisModels;
  database?: {ready: boolean; engine: string; detail: string};
  camera?: {configured:boolean; state:string; last_clip_at:number|null; protocol?:string; clip_seconds?:number; mode:string};
  camera_inputs_supported?: boolean;
  saved_cameras?: {id:string; name:string; state:string; active:boolean}[];
  is_admin?: boolean;
  storage_used_mb?: number;
  storage_limit_mb?: number;
  worker_online: boolean;
  worker_age_seconds: number | null;
  email_mode: string;
  channels?: {email: string; telegram: {configured: boolean; chats: number; evidence?: boolean}};
  ai_review: string;
  vision?: VisionStatus;
  recipients: string[];
  max_upload_mb: number;
  max_video_seconds: number;
  deployment: string;
}
export interface Data { status: Status | null; sources: Source[]; runs: Run[]; events: Incident[]; carbon: CarbonEntry[]; notifications: Notification[] }
export type CameraHealth = NonNullable<Status['camera']> & {active?: boolean};
export interface LivePreviewStatus {state: string; active: boolean; captured_at?: number | null; predicted_at?: number | null; detections?: number; model?: string; max_fps?: number}
export interface SavedCamera {id: string; name: string; url: string; health: CameraHealth; live: LivePreviewStatus; last_rule?: Rule & DetectorOptions}
