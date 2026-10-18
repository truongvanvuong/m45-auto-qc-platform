from typing import List, Optional, Dict, Any, Union
from pydantic import BaseModel, Field

class BoundingBox3D(BaseModel):
    id: str
    track_id: Optional[Union[int, str]] = None
    label: str = "Vehicle.Car"
    x: float
    y: float
    z: float
    dx: float
    dy: float
    dz: float
    rotation_yaw: float = 0.0
    rotation_pitch: float = 0.0
    rotation_roll: float = 0.0
    points_count: int = 0
    raw_points_count: int = 0
    distance: float = 0.0
    quality_tier: str = "EASY" # EASY_AUTOLABEL, MEDIUM_AI_ASSIST, HARD_EXPERT_REVIEW, DROP_IMPOSSIBLE
    defect_type: Optional[str] = None # PCA_COLLAPSE, Z_CUTOFF, DENSITY_ANOMALY, SOTIF_RISK, NONE
    sotif_risk: Optional[str] = "SAFE" # SAFE, WARNING, CRITICAL_COLLISION
    notes: Optional[str] = ""
    cvat_shape_id: Optional[Union[int, str]] = None
    attributes: Dict[str, Any] = Field(default_factory=dict)

class PointCloudFrame(BaseModel):
    frame_id: int
    filename: str
    total_points: int
    points_xyz: List[List[float]] # [[x, y, z, intensity], ...]
    boxes: List[BoundingBox3D]
    timestamp: Optional[float] = None

class CameraImageOverlay(BaseModel):
    cam_id: str
    name: str
    image_url: str
    projected_boxes: List[Dict[str, Any]] # 2D box [x1, y1, x2, y2, label, color]

class FrameDetailResponse(BaseModel):
    frame_id: int
    pcd_file: str
    total_frames: int = 240
    points: List[List[float]]
    boxes: List[BoundingBox3D]
    selected_box_id: Optional[str] = None
    cameras: List[CameraImageOverlay]
    sotif_metrics: Dict[str, Any]

class CVATIssuePayload(BaseModel):
    job_id: Optional[int] = None
    box_id: str
    frame: int
    title: str
    description: Optional[str] = ""
    comment: Optional[str] = None
    severity: str = "error" # warning, error, info
    suggested_correction: Optional[Dict[str, Any]] = None

class CVATTaskInfo(BaseModel):
    id: str
    name: str
    status: str
    total_frames: int
    easy_count: int
    medium_count: int
    hard_count: int
    drop_count: int
    cvat_url: str
    connected: bool

class AutoApprovePayload(BaseModel):
    task_id: str
    tier: str = "EASY_AUTOLABEL"
    confidence_threshold: float = 0.95

class AutoApproveResponse(BaseModel):
    success: bool
    approved_count: int
    remaining_hard_count: int
    time_saved_hours: float
    cost_saved_usd: float
    message: str

class FlaggedCaseItem(BaseModel):
    id: str
    track_id: Optional[int] = None
    label: str = "Vehicle.Car"
    frame: int = 108
    pcd_file: str = "PIM_108.PCD"
    category: str = "HARD_REVIEW" # HARD_REVIEW, PIPELINE_DEFECT, EASY_AUTO
    badge_text: str = "HARD • PCA Collapse"
    h: float = 0.002
    points_count: int = 4
    raw_points_count: int = 4
    distance: float = 54.9
    flag_reason: str = "Suy biến ma trận PCA: Chiều cao h = 0.002m (< 0.05m)"
    sotif_risk: str = "CRITICAL_COLLISION" # SAFE, WARNING, CRITICAL_COLLISION
    # 3D Box geometry for loading into workstation
    dx: float = 4.6
    dy: float = 1.9
    dz: float = 0.002
    x: float = 38.2
    y: float = 39.4
    z: float = -0.8
    rotation_yaw: float = 0.45

class DatasetUploadResponse(BaseModel):
    success: bool
    dataset_name: str
    summary: Dict[str, Any]
    flagged_cases: List[FlaggedCaseItem]
    task_info: Optional[Dict[str, Any]] = None

class CVATPingRequest(BaseModel):
    cvat_url: str = "http://localhost:8080"
    cvat_public_url: Optional[str] = "http://localhost:8080"
    auth_method: str = "token" # "token" or "basic"
    token: Optional[str] = ""
    username: Optional[str] = ""
    password: Optional[str] = ""
    org: Optional[str] = ""
    task_id: Optional[str] = "16"

class CVATPingResponse(BaseModel):
    connected: bool
    message: str
    server_version: Optional[str] = None
    task_id: Optional[str] = None
    task_name: Optional[str] = None
    total_frames: Optional[int] = None
    latency_ms: Optional[float] = None
    token: Optional[str] = None
    token_masked: Optional[str] = None

class CVATProjectItem(BaseModel):
    id: int
    name: str
    owner: Optional[str] = None
    created_date: Optional[str] = None
    updated_date: Optional[str] = None
    tasks_count: Optional[int] = 0

class CVATTaskListItem(BaseModel):
    id: int
    name: str
    project_id: Optional[int] = None
    status: str = "annotation"
    size: int = 0
    dimension: Optional[str] = "3d"
    owner: Optional[str] = None
    updated_date: Optional[str] = None

class CVATJobItem(BaseModel):
    id: int
    task_id: int
    stage: str = "annotation"
    state: str = "in progress"
    start_frame: int = 0
    stop_frame: int = 0
    assignee: Optional[str] = None
    dimension: Optional[str] = "3d"

class FrameDataStatus(BaseModel):
    job_id: int
    frame_number: int
    can_access_pcd: bool
    can_access_cameras: bool
    can_access_calibration: bool
    point_cloud_format: Optional[str] = None # "pcd_ascii", "pcd_binary", "bin_kitti", "unavailable"
    points_count: int = 0
    error: Optional[str] = None
    details: Dict[str, Any] = Field(default_factory=dict)

class SyncProposalItem(BaseModel):
    shape_id: int
    track_id: Optional[int] = None
    frame: int
    label: str
    action: str # "KEEP", "MODIFY_DIMENSIONS", "FLAG_ISSUE", "REJECT"
    m45_defect_type: Optional[str] = None # "PCA_COLLAPSE", "Z_CUTOFF", "SPARSE", "NONE"
    quality_tier: str = "EASY"
    original_points: List[float] # [x, y, z, rx, ry, rz, dx, dy, dz]
    proposed_points: Optional[List[float]] = None
    original_values: Dict[str, Any] = Field(default_factory=dict)
    proposed_values: Dict[str, Any] = Field(default_factory=dict)
    reason: str = ""
    attributes: Dict[str, Any] = Field(default_factory=dict)

class SyncPreviewResponse(BaseModel):
    job_id: int
    task_id: Optional[int] = None
    total_shapes: int
    modified_count: int
    unmodified_count: int
    flagged_issues_count: int
    proposals: List[SyncProposalItem]
    requires_confirmation: bool = True
    warning_message: str = "Xem trước các thay đổi đề xuất. Dữ liệu CHƯA được ghi lên CVAT. Cần xác nhận rõ ràng trước khi áp dụng."

class SyncApplyRequest(BaseModel):
    job_id: int
    task_id: Optional[int] = None
    confirm_apply: bool = False # Bắt buộc phải là True từ người dùng
    approved_shape_ids: List[int] = Field(default_factory=list)
    include_issue_creation: bool = False

class SyncApplyResponse(BaseModel):
    success: bool
    job_id: int
    applied_count: int
    failed_count: int
    skipped_count: int
    results: List[Dict[str, Any]] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)
    message: str

class CVATIssueRequest(BaseModel):
    job_id: int
    frame: int
    position: List[float] = Field(default_factory=lambda: [0.0, 0.0])
    title: str
    description: str
    severity: str = "error" # "warning", "error", "info"
    box_id: Optional[str] = None

class CVATIssueResponse(BaseModel):
    success: bool
    issue_id: Optional[int] = None
    status: str
    message: str
    details: Optional[Dict[str, Any]] = None


