export type QualityTier = 'EASY_AUTOLABEL' | 'MEDIUM_AI_ASSIST' | 'HARD_EXPERT_REVIEW' | 'DROP_IMPOSSIBLE';
export type DefectType = 'PCA_COLLAPSE' | 'Z_CUTOFF' | 'DENSITY_ANOMALY' | 'SPARSE_POINT_ANOMALY' | 'NONE';
export type SOTIFRisk = 'SAFE' | 'WARNING' | 'WARNING_BRAKE_CORRIDOR' | 'CRITICAL_COLLISION';

export interface BoundingBox3D {
  id: string;
  track_id?: number;
  label: string;
  x: float;
  y: float;
  z: float;
  dx: float;
  dy: float;
  dz: float;
  rotation_yaw: float;
  rotation_pitch?: float;
  rotation_roll?: float;
  points_count: number;
  raw_points_count: number;
  distance: number;
  quality_tier: QualityTier;
  defect_type?: DefectType;
  sotif_risk?: SOTIFRisk;
  notes?: string;
  cvat_shape_id?: number;
}

export type float = number;

export interface CameraBox2D {
  box_id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  defect?: DefectType;
  color?: string;
}

export interface CameraImageOverlay {
  cam_id: string;
  name: string;
  image_url: string;
  projected_boxes: CameraBox2D[];
}

export interface SOTIFMetrics {
  speed_kmh: number;
  reaction_time_s: number;
  decel_mps2: number;
  stopping_dist_m: number;
  reliable_vision_limit_m: number;
}

export interface FrameDetailResponse {
  frame_id: number;
  pcd_file: string;
  total_frames: number;
  points: [number, number, number, number][]; // [x, y, z, intensity]
  boxes: BoundingBox3D[];
  selected_box_id?: string;
  cameras: CameraImageOverlay[];
  sotif_metrics: SOTIFMetrics;
}

export interface CVATTaskInfo {
  id: string;
  name: string;
  status: string;
  total_frames: number;
  easy_count: number;
  medium_count: number;
  hard_count: number;
  drop_count: number;
  cvat_url: string;
  connected: boolean;
}

export interface AutoApproveResponse {
  success: boolean;
  approved_count: number;
  remaining_hard_count: number;
  time_saved_hours: number;
  cost_saved_usd: number;
  message: string;
}

export interface QCStats {
  total_boxes: number;
  buckets: {
    easy: { count: number; pct: number; name: string };
    medium: { count: number; pct: number; name: string };
    hard: { count: number; pct: number; name: string };
    drop: { count: number; pct: number; name: string };
  };
  sotif_model: {
    speed_50_stop_m: number;
    speed_70_stop_m: number;
    pca_collapse_risk: string;
    safe_speed_at_22m: number;
  };
  roi: {
    manual_cost_usd: number;
    saved_cost_usd: number;
    saved_pct: number;
    speedup: string;
  };
}

export type FlaggedCategory = 'ALL' | 'HARD_REVIEW' | 'PIPELINE_DEFECT' | 'EASY_AUTO';

export interface FlaggedCaseItem {
  id: string;
  track_id?: number;
  label: string;
  frame: number;
  pcd_file: string;
  category: 'HARD_REVIEW' | 'PIPELINE_DEFECT' | 'EASY_AUTO';
  badge_text: string;
  h: number;
  points_count: number;
  raw_points_count: number;
  distance: number;
  flag_reason: string;
  sotif_risk: SOTIFRisk;
  dx: number;
  dy: number;
  dz: number;
  x: number;
  y: number;
  z: number;
  rotation_yaw: number;
}

export interface DatasetSummaryKPI {
  total_boxes: number;
  total_frames: number;
  easy_count: number;
  easy_pct: number;
  hard_count: number;
  hard_pct: number;
  pipeline_count: number;
  pipeline_pct: number;
}

export interface DatasetUploadResponse {
  success: boolean;
  dataset_name: string;
  summary: DatasetSummaryKPI;
  flagged_cases: FlaggedCaseItem[];
  task_info?: CVATTaskInfo;
}

export interface CVATProjectItem {
  id: number;
  name: string;
  owner?: string;
  created_date?: string;
  updated_date?: string;
  tasks_count?: number;
}

export interface CVATTaskListItem {
  id: number;
  name: string;
  project_id?: number;
  status: string;
  size: number;
  dimension?: string;
  owner?: string;
  updated_date?: string;
}

export interface CVATJobItem {
  id: number;
  task_id: number;
  stage: string;
  state: string;
  start_frame: number;
  stop_frame: number;
  assignee?: string;
  dimension?: string;
}

export interface FrameDataStatus {
  job_id: number;
  frame_number: number;
  can_access_pcd: boolean;
  can_access_cameras: boolean;
  can_access_calibration: boolean;
  point_cloud_format?: string;
  points_count: number;
  error?: string;
  details?: Record<string, any>;
}

export interface SyncProposalItem {
  shape_id: number;
  track_id?: number;
  frame: number;
  label: string;
  action: 'KEEP' | 'MODIFY_DIMENSIONS' | 'FLAG_ISSUE' | 'REJECT';
  m45_defect_type?: string;
  quality_tier: string;
  original_points: number[];
  proposed_points?: number[];
  original_values: Record<string, any>;
  proposed_values: Record<string, any>;
  reason: string;
  attributes?: Record<string, any>;
}

export interface SyncPreviewResponse {
  job_id: number;
  task_id?: number;
  total_shapes: number;
  modified_count: number;
  unmodified_count: number;
  flagged_issues_count: number;
  proposals: SyncProposalItem[];
  requires_confirmation: boolean;
  warning_message: string;
}

export interface SyncApplyResponse {
  success: boolean;
  job_id: number;
  applied_count: number;
  failed_count: number;
  skipped_count: number;
  results: Record<string, any>[];
  errors: string[];
  message: string;
}


