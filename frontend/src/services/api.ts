import {
  FrameDetailResponse,
  CVATTaskInfo,
  AutoApproveResponse,
  QCStats,
  BoundingBox3D,
  DatasetUploadResponse,
  FlaggedCaseItem,
  CVATProjectItem,
  CVATTaskListItem,
  CVATJobItem,
  FrameDataStatus,
  SyncPreviewResponse,
  SyncApplyResponse
} from '../types/qc';

const envApiUrl = import.meta.env.VITE_API_URL;
const API_BASE = envApiUrl !== undefined ? envApiUrl : (typeof window !== 'undefined' && window.location.port === '3000' ? '' : 'http://localhost:8088');

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 3500): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

export async function fetchCurrentTask(taskId: string = ''): Promise<CVATTaskInfo> {
  try {
    const q = taskId ? `?task_id=${taskId}` : '';
    const res = await fetchWithTimeout(`${API_BASE}/api/qc/task/current${q}`, {}, 2500);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('Backend or CVAT not responding:', err);
    return {
      id: taskId || '',
      name: taskId ? `CVAT Task #${taskId} (Ngoại tuyến)` : 'Chưa kết nối Task',
      status: 'offline',
      total_frames: 0,
      easy_count: 0,
      medium_count: 0,
      hard_count: 0,
      drop_count: 0,
      cvat_url: taskId ? `http://localhost:8080/tasks/${taskId}` : 'http://localhost:8080/tasks',
      connected: false
    };
  }
}

export async function fetchFrameDetail(frameId: number = 0, jobId?: number, taskId?: number | string): Promise<FrameDetailResponse> {
  const params = new URLSearchParams();
  if (jobId !== undefined && jobId !== null && jobId !== 0) params.append('job_id', jobId.toString());
  if (taskId !== undefined && taskId !== null && taskId !== '') params.append('task_id', taskId.toString());
  const queryString = params.toString() ? `?${params.toString()}` : '';

  const res = await fetchWithTimeout(`${API_BASE}/api/qc/frame/${frameId}${queryString}`, {}, 35000);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: Không thể tải dữ liệu frame ${frameId}`);
  }
  return await res.json();
}

export async function exportClassificationReport(taskId: string = ''): Promise<any> {
  const q = taskId ? `?task_id=${taskId}` : '';
  const res = await fetchWithTimeout(`${API_BASE}/api/qc/export-report${q}`, {
    method: 'GET',
  }, 4000);
  if (!res.ok) throw new Error(`HTTP error ${res.status}`);
  return await res.json();
}

export async function autoApproveEasyCases(taskId: string = ''): Promise<AutoApproveResponse> {
  const res = await fetchWithTimeout(`${API_BASE}/api/qc/auto-approve-easy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id: taskId, tier: 'EASY_AUTOLABEL' }),
  }, 3500);
  if (!res.ok) throw new Error(`HTTP error ${res.status}`);
  return await res.json();
}

export async function sendCVATIssue(payload: {
  job_id?: number;
  box_id: string;
  frame: number;
  title: string;
  description: string;
  severity?: string;
}): Promise<{ status: string; message: string }> {
  const res = await fetchWithTimeout(`${API_BASE}/api/qc/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, 3500);
  if (!res.ok) throw new Error(`HTTP error ${res.status}`);
  return await res.json();
}

export async function patchCuboid(
  boxId: string,
  patch: Partial<BoundingBox3D>,
  jobId?: number,
  shapeId?: number
): Promise<boolean> {
  const params = new URLSearchParams();
  if (jobId) params.append('job_id', jobId.toString());
  if (shapeId) params.append('shape_id', shapeId.toString());
  const q = params.toString() ? `?${params.toString()}` : '';

  const res = await fetchWithTimeout(`${API_BASE}/api/qc/cuboid/${boxId}${q}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }, 3000);
  if (!res.ok) throw new Error(`HTTP error ${res.status}`);
  const data = await res.json();
  return !!data.success;
}

export async function pingCVAT(config: {
  cvatUrl: string;
  cvatPublicUrl?: string;
  authMethod?: string;
  token?: string;
  username?: string;
  password?: string;
  org?: string;
  taskId?: string;
}): Promise<{
  connected: boolean;
  message: string;
  server_version?: string;
  task_id?: string;
  task_name?: string;
  total_frames?: number;
  latency_ms?: number;
}> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/qc/cvat/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cvat_url: config.cvatUrl,
        cvat_public_url: config.cvatPublicUrl,
        auth_method: config.authMethod,
        token: config.token,
        username: config.username,
        password: config.password,
        org: config.org,
        task_id: config.taskId,
      }),
    }, 4000);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('Ping CVAT failed:', err);
    return {
      connected: false,
      message: `Không thể kết nối Backend M45 (:8088) để kiểm tra CVAT (${config.cvatUrl}).`,
    };
  }
}

export async function saveCVATConfig(config: any): Promise<{
  success: boolean;
  config?: any;
  dataset?: DatasetUploadResponse;
}> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/qc/cvat/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cvat_url: config.cvatUrl,
        cvat_public_url: config.cvatPublicUrl,
        auth_method: config.authMethod,
        token: config.token,
        username: config.username,
        password: config.password,
        org: config.org,
        task_id: config.taskId,
      }),
    }, 4000);
    if (res.ok) {
      const data = await res.json();
      return { success: true, config: data.config, dataset: data.dataset };
    }
    return { success: false };
  } catch (err) {
    return { success: false };
  }
}

export async function syncCVATTask(taskId: string = '16'): Promise<DatasetUploadResponse> {
  const res = await fetchWithTimeout(`${API_BASE}/api/qc/cvat/sync-task/${taskId}`, {
    method: 'POST',
  }, 35000);
  if (!res.ok) throw new Error(`HTTP error ${res.status}: Không thể nạp Task #${taskId}`);
  return await res.json();
}

export async function fetchFlaggedCases(taskId?: string): Promise<DatasetUploadResponse> {
  const query = taskId ? `?task_id=${taskId}` : '';
  const res = await fetchWithTimeout(`${API_BASE}/api/qc/flagged-cases${query}`, {}, 4000);
  if (!res.ok) throw new Error(`HTTP error ${res.status}`);
  return await res.json();
}

export async function uploadDataset(fileOrName?: File | string): Promise<DatasetUploadResponse> {
  if (fileOrName && typeof fileOrName !== 'string') {
    const fname = encodeURIComponent(fileOrName.name);
    const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const baseHost = isLocalhost ? `http://${window.location.hostname}:8088` : API_BASE;

    // 1. Fast zero-copy check if the large archive is already mounted in backend storage
    try {
      const fastRes = await fetchWithTimeout(`${baseHost}/api/qc/upload-dataset?filename=${fname}&check_cached_only=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: fileOrName.name }),
      }, 15000);
      if (fastRes.ok) {
        return await fastRes.json();
      }
    } catch (e) {
      // Proceed to full binary upload
    }

    // 2. Full binary stream upload for any new .zip / .pcd / .bin / .json file
    try {
      const res = await fetchWithTimeout(`${baseHost}/api/qc/upload-dataset?filename=${fname}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Filename': fileOrName.name,
        },
        body: fileOrName,
      }, 120000);
      if (res.ok) return await res.json();
    } catch (e) {
      // Fallback to relative proxy path if direct port 8088 is unreachable
    }
    const fallbackRes = await fetchWithTimeout(`${API_BASE}/api/qc/upload-dataset?filename=${fname}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Filename': fileOrName.name,
      },
      body: fileOrName,
    }, 120000);
    if (!fallbackRes.ok) throw new Error(`HTTP error ${fallbackRes.status}`);
    return await fallbackRes.json();
  }

  const filename = typeof fileOrName === 'string' ? fileOrName : undefined;
  const res = await fetchWithTimeout(`${API_BASE}/api/qc/upload-dataset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename }),
  }, 15000);
  if (!res.ok) throw new Error(`HTTP error ${res.status}`);
  return await res.json();
}

// =============================================================================
// CVAT REST API v2 & Safe Sync Client Functions
// =============================================================================

export async function fetchCVATProjects(): Promise<CVATProjectItem[]> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/qc/cvat/projects`, {}, 3000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('Could not fetch CVAT projects:', err);
    return [];
  }
}

export async function fetchCVATTasks(projectId?: number): Promise<CVATTaskListItem[]> {
  try {
    const query = projectId ? `?project_id=${projectId}` : '';
    const res = await fetchWithTimeout(`${API_BASE}/api/qc/cvat/tasks${query}`, {}, 3000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('Could not fetch CVAT tasks:', err);
    return [];
  }
}

export async function fetchCVATJobs(taskId: number): Promise<CVATJobItem[]> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/qc/cvat/tasks/${taskId}/jobs`, {}, 3000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`Could not fetch CVAT jobs for task ${taskId}:`, err);
    return [];
  }
}

export async function checkCVATFrameStatus(jobId: number, frameNumber: number = 0): Promise<FrameDataStatus> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/qc/cvat/jobs/${jobId}/frame-status?frame_number=${frameNumber}`, {}, 3000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    return {
      job_id: jobId,
      frame_number: frameNumber,
      can_access_pcd: false,
      can_access_cameras: false,
      can_access_calibration: false,
      point_cloud_format: 'unavailable',
      points_count: 0,
      error: `Không thể kết nối Backend để kiểm tra dữ liệu frame: ${err}`
    };
  }
}

export async function fetchSafeSyncPreview(jobId: number, taskId?: number): Promise<SyncPreviewResponse> {
  const query = taskId ? `?task_id=${taskId}` : '';
  const res = await fetchWithTimeout(`${API_BASE}/api/qc/cvat/jobs/${jobId}/sync-preview${query}`, {
    method: 'POST'
  }, 5000);
  if (!res.ok) throw new Error(`HTTP ${res.status}: Không thể tạo Safe Sync preview`);
  return await res.json();
}

export async function applySafeSyncChanges(
  jobId: number,
  approvedShapeIds: number[],
  confirmApply: boolean,
  taskId?: number,
  includeIssues: boolean = false
): Promise<SyncApplyResponse> {
  const res = await fetchWithTimeout(`${API_BASE}/api/qc/cvat/jobs/${jobId}/sync-apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      job_id: jobId,
      task_id: taskId,
      confirm_apply: confirmApply,
      approved_shape_ids: approvedShapeIds,
      include_issue_creation: includeIssues
    })
  }, 6000);

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || `HTTP ${res.status}`);
  }
  return await res.json();
}

export async function resetAllData(): Promise<{ status: string; message: string }> {
  const res = await fetchWithTimeout(`${API_BASE}/api/qc/reset-all`, {
    method: 'POST'
  }, 4000);
  if (!res.ok) throw new Error(`HTTP ${res.status}: Không thể xóa dữ liệu`);
  return await res.json();
}

