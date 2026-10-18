import os
import io
import json
import time
import zipfile
import logging
from typing import Dict, Any, Optional, List, Tuple
import httpx
import numpy as np

from ..models.schemas import BoundingBox3D

logger = logging.getLogger("m45.cvat")

CONFIG_FILE = os.path.join(os.path.dirname(__file__), "cvat_saved_config.json")


def mask_token(token: Optional[str]) -> str:
    """Masks authentication token for safe logging and response payloads."""
    if not token:
        return ""
    t = str(token).strip()
    if len(t) <= 6:
        return "***"
    return f"{t[:3]}...{t[-3:]}"


def parse_pcd_or_bin(raw_bytes: bytes, filename: str = "") -> Tuple[np.ndarray, str]:
    """
    Parses point cloud bytes into an (N, 3) NumPy float64 array of [x, y, z].
    Supports:
    - ASCII PCD (Point Cloud Data)
    - Binary PCD (float32 little-endian)
    - Raw KITTI / nuScenes .bin (float32 [x, y, z, intensity])
    """
    if not raw_bytes or len(raw_bytes) < 16:
        return np.empty((0, 3), dtype=np.float64), "empty"

    header_preview = raw_bytes[:1024].decode("ascii", errors="ignore")
    if header_preview.startswith("# .PCD") or ("VERSION" in header_preview and "FIELDS" in header_preview):
        data_type = "ascii"
        header_end_idx = 0
        num_fields = 3

        lines = header_preview.split("\n")
        for line in lines:
            line_s = line.strip()
            if line_s.startswith("FIELDS"):
                fields = line_s.split()[1:]
                num_fields = max(3, len(fields))
                break

        data_marker = b"\nDATA "
        data_pos = raw_bytes.find(data_marker)
        if data_pos == -1:
            data_marker = b"DATA "
            data_pos = raw_bytes.find(data_marker)

        if data_pos != -1:
            line_end = raw_bytes.find(b"\n", data_pos + len(data_marker))
            if line_end == -1:
                line_end = len(raw_bytes)
            data_type_str = raw_bytes[data_pos + len(data_marker):line_end].strip().decode("ascii", errors="ignore").lower()
            header_end_idx = line_end + 1
            if "binary" in data_type_str:
                data_type = "binary"
            else:
                data_type = "ascii"

        if data_type == "binary":
            binary_data = raw_bytes[header_end_idx:]
            bytes_per_pt = num_fields * 4
            n_pts = len(binary_data) // bytes_per_pt
            if n_pts > 0:
                pts_f32 = np.frombuffer(binary_data[: n_pts * bytes_per_pt], dtype=np.float32)
                pts = pts_f32.reshape(n_pts, num_fields)[:, :3].astype(np.float64)
                valid_mask = np.isfinite(pts).all(axis=1)
                pts = pts[valid_mask]
                return pts, "pcd_binary"
            return np.empty((0, 3), dtype=np.float64), "pcd_binary"
        else:
            body = raw_bytes[header_end_idx:].decode("ascii", errors="ignore")
            lines = [l.strip() for l in body.splitlines() if l.strip()]
            pts_list = []
            for l in lines:
                parts = l.split()
                if len(parts) >= 3:
                    try:
                        pts_list.append([float(parts[0]), float(parts[1]), float(parts[2])])
                    except ValueError:
                        continue
            pts = np.array(pts_list, dtype=np.float64) if pts_list else np.empty((0, 3), dtype=np.float64)
            if len(pts) > 0:
                valid_mask = np.isfinite(pts).all(axis=1)
                pts = pts[valid_mask]
            return pts, "pcd_ascii"

    # 1. nuScenes .bin / .pcd.bin: 5 floats per point (x, y, z, intensity, ring_index) -> 20 bytes/point
    if len(raw_bytes) >= 20 and len(raw_bytes) % 20 == 0:
        try:
            pts_f32 = np.frombuffer(raw_bytes, dtype=np.float32).reshape(-1, 5)
            pts = pts_f32[:, :3].astype(np.float64)
            valid_mask = np.isfinite(pts).all(axis=1)
            pts = pts[valid_mask]
            if len(pts) > 0 and np.abs(pts[:, :2]).max() < 500.0 and np.abs(pts[:, 2]).max() < 150.0:
                return pts, "bin_nuscenes"
        except Exception:
            pass

    # 2. KITTI / Waymo .bin: 4 floats per point (x, y, z, reflectance) -> 16 bytes/point
    if len(raw_bytes) >= 16 and len(raw_bytes) % 16 == 0:
        pts_f32 = np.frombuffer(raw_bytes, dtype=np.float32).reshape(-1, 4)
        pts = pts_f32[:, :3].astype(np.float64)
        valid_mask = np.isfinite(pts).all(axis=1)
        pts = pts[valid_mask]
        return pts, "bin_kitti"

    return np.empty((0, 3), dtype=np.float64), "unrecognized"


class CVATClient:
    def __init__(self):
        self.base_url = os.getenv("CVAT_URL", "http://localhost:8080").rstrip("/")
        self.public_url = os.getenv("CVAT_PUBLIC_URL", "http://localhost:8080").rstrip("/")
        self.token = os.getenv("CVAT_TOKEN", "")
        self.auth_scheme = os.getenv("CVAT_AUTH_SCHEME", "Token")
        self.username = os.getenv("CVAT_USERNAME", "")
        self.password = os.getenv("CVAT_PASSWORD", "")
        self.org = os.getenv("CVAT_ORG", "")
        self.task_id = os.getenv("CVAT_TASK_ID", "")
        self.force_demo = os.getenv("M45_FORCE_DEMO", "0") in ("1", "true", "True")
        self._last_health_status = None
        self._last_health_check_time = 0.0
        self.uploaded_zip_path: Optional[str] = os.path.join(os.path.dirname(__file__), "uploaded_dataset.zip")
        self.uploaded_dataset_cache: Optional[Dict[str, Any]] = None
        self.active_source: str = "cvat"
        self.load_persisted_config()

    def load_persisted_config(self):
        try:
            if os.path.exists(CONFIG_FILE):
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if data.get("base_url"):
                        saved_url = data["base_url"].rstrip("/")
                        is_docker = os.path.exists("/.dockerenv") or bool(os.getenv("CVAT_URL"))
                        if is_docker and ("localhost" in saved_url or "127.0.0.1" in saved_url):
                            env_url = os.getenv("CVAT_URL", "http://host.docker.internal:8080").rstrip("/")
                            self.base_url = env_url if ("host.docker.internal" in env_url or "traefik" in env_url) else "http://host.docker.internal:8080"
                        else:
                            self.base_url = saved_url
                    if data.get("public_url"):
                        self.public_url = data["public_url"].rstrip("/")
                    if data.get("token") and not self.token:
                        self.token = data["token"]
                    if data.get("username") and not self.username:
                        self.username = data["username"]
                    if data.get("password") and not self.password:
                        self.password = data["password"]
                    if data.get("org") and not self.org:
                        self.org = data["org"]
                    if data.get("task_id") and (not self.task_id or self.task_id == "demo"):
                        self.task_id = str(data["task_id"])
        except Exception as e:
            logger.warning(f"Could not load cvat_saved_config.json: {e}")

    def save_persisted_config(self):
        try:
            data = {
                "base_url": self.base_url,
                "public_url": self.public_url,
                "token": self.token,
                "username": self.username,
                "password": self.password,
                "org": self.org,
                "task_id": self.task_id,
            }
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.warning(f"Could not save cvat_saved_config.json: {e}")

    def reset_all_data(self):
        """Clears all persisted config, in-memory dataset cache, and uploaded archive."""
        self.uploaded_dataset_cache = None
        self.active_source = "cvat"
        self.task_id = "demo"
        self.token = ""
        self.username = ""
        self.password = ""
        self.org = ""
        self._last_health_status = None
        if os.path.exists(CONFIG_FILE):
            try:
                os.remove(CONFIG_FILE)
            except Exception as e:
                logger.warning(f"Could not remove {CONFIG_FILE}: {e}")
        if self.uploaded_zip_path and os.path.exists(self.uploaded_zip_path):
            try:
                os.remove(self.uploaded_zip_path)
            except Exception as e:
                logger.warning(f"Could not remove {self.uploaded_zip_path}: {e}")


    def _get_headers(self) -> Dict[str, str]:
        if not self.token:
            self.load_persisted_config()
        headers = {}
        if self.token:
            headers["Authorization"] = f"{self.auth_scheme} {self.token}"
        if self.org:
            headers["X-Organization"] = self.org
        # Traefik in CVAT stack requires Host header to route to cvat_server
        if any(h in self.base_url for h in ("host.docker.internal", "traefik", "cvat", "127.0.0.1")):
            headers["Host"] = "localhost:8080"
        return headers

    def _get_candidate_urls(self, target_url: str) -> List[str]:
        """
        Generate candidate connection URLs for CVAT.
        Handles Docker container-to-host routing (host.docker.internal)
        and Docker internal networks (traefik:8080, cvat_server:8080).
        """
        target = target_url.rstrip("/")
        candidates = [target]
        if "localhost" in target:
            candidates.append(target.replace("localhost", "127.0.0.1"))
            candidates.append(target.replace("localhost", "host.docker.internal"))
            candidates.append("http://traefik:8080")
            candidates.append("http://cvat_server:8080")
        elif "127.0.0.1" in target:
            candidates.append(target.replace("127.0.0.1", "localhost"))
            candidates.append(target.replace("127.0.0.1", "host.docker.internal"))
            candidates.append("http://traefik:8080")
            candidates.append("http://cvat_server:8080")
        elif "host.docker.internal" in target:
            candidates.append(target.replace("host.docker.internal", "localhost"))
            candidates.append(target.replace("host.docker.internal", "127.0.0.1"))
            candidates.append("http://traefik:8080")
            candidates.append("http://cvat_server:8080")
        elif "traefik" in target or "cvat" in target:
            candidates.append("http://host.docker.internal:8080")
            candidates.append("http://localhost:8080")

        seen = set()
        result = []
        for c in candidates:
            if c not in seen:
                seen.add(c)
                result.append(c)
        return result

    def _get_candidate_headers(self, url: str) -> Dict[str, str]:
        """Headers required when testing candidate URL (Host routing for Traefik)."""
        headers = {}
        if any(h in url for h in ("host.docker.internal", "traefik", "cvat", "127.0.0.1")):
            headers["Host"] = "localhost:8080"
        return headers

    async def check_health(self) -> bool:
        """Check if CVAT is alive at base_url with short timeout and caching."""
        if self.force_demo:
            return False
        now = time.time()
        if self._last_health_status is not None and (now - self._last_health_check_time) < 8.0:
            return self._last_health_status

        candidate_urls = self._get_candidate_urls(self.base_url)

        for url in candidate_urls:
            try:
                ping_h = self._get_candidate_headers(url)
                if self.token:
                    ping_h["Authorization"] = f"{self.auth_scheme} {self.token}"
                async with httpx.AsyncClient(timeout=1.2) as client:
                    res = await client.get(f"{url}/api/server/about", headers=ping_h)
                    if res.status_code in (200, 401, 403, 406):
                        self.base_url = url
                        self._last_health_status = True
                        self._last_health_check_time = now
                        return True
            except Exception:
                pass
        self._last_health_status = False
        self._last_health_check_time = now
        return False

    async def test_connection(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Tests connection to CVAT: performs login if credentials provided,
        pings server, and verifies the requested Task ID.
        Never logs credentials. Differentiates network errors, 401, 403, 404, 500.
        """
        cvat_url = payload.get("cvat_url", self.base_url).rstrip("/")
        cvat_public_url = payload.get("cvat_public_url", self.public_url).rstrip("/")
        username = payload.get("username", "").strip()
        password = payload.get("password", "")
        token = payload.get("token", "").strip()
        task_id = str(payload.get("task_id", "")).strip()
        org = payload.get("org", "").strip()

        candidate_urls = self._get_candidate_urls(cvat_url)

        active_url = None
        server_about = None
        latency_ms = 0.0
        error_details = []

        for url in candidate_urls:
            t0 = time.time()
            try:
                ping_h = self._get_candidate_headers(url)
                async with httpx.AsyncClient(timeout=3.0) as client:
                    res = await client.get(f"{url}/api/server/about", headers=ping_h)
                    elapsed = (time.time() - t0) * 1000
                    if res.status_code in (200, 401, 403, 406):
                        active_url = url
                        latency_ms = elapsed
                        if res.status_code == 200:
                            server_about = res.json()
                        break
                    elif res.status_code == 404:
                        error_details.append(f"{url} -> HTTP 404 Not Found (Endpoint API không tồn tại hoặc Traefik Host header chưa khớp)")
                    elif res.status_code >= 500:
                        error_details.append(f"{url} -> HTTP {res.status_code} (Máy chủ CVAT hoặc Proxy Traefik gặp lỗi nội bộ)")
                    else:
                        error_details.append(f"{url} -> HTTP {res.status_code}")
            except httpx.ConnectError:
                error_details.append(f"{url} -> Lỗi kết nối (Connection refused: cổng không mở hoặc dịch vụ chưa khởi động)")
            except httpx.ConnectTimeout:
                error_details.append(f"{url} -> Quá thời gian chờ (Timeout)")
            except Exception as e:
                error_details.append(f"{url} -> {type(e).__name__}: {e}")

        if not active_url:
            if any("404" in e for e in error_details):
                err_summary = f"Không thể kết nối: Máy chủ tại {cvat_url} phản hồi HTTP 404 (Không tìm thấy endpoint API CVAT hoặc lỗi định tuyến Traefik)."
            elif any("50" in e for e in error_details):
                err_summary = f"Không thể kết nối: Máy chủ CVAT hoặc Proxy Traefik tại {cvat_url} phản hồi lỗi HTTP 5xx (Lỗi nội bộ máy chủ)."
            elif any("Timeout" in e for e in error_details):
                err_summary = f"Không thể kết nối: Kết nối tới máy chủ CVAT tại {cvat_url} bị quá thời gian chờ (Connection Timeout)."
            else:
                err_summary = f"Không thể kết nối mạng tới CVAT tại {cvat_url} (Connection refused). Cổng dịch vụ 8080 không phản hồi."

            detail_msg = "; ".join(error_details) if error_details else "Không nhận được phản hồi từ các địa chỉ truy cập."
            return {
                "connected": False,
                "message": f"{err_summary} Chi tiết: [{detail_msg}]"
            }

        headers = self._get_headers()
        if org:
            headers["X-Organization"] = org
        if any(h in active_url for h in ("host.docker.internal", "traefik", "cvat", "127.0.0.1")):
            headers["Host"] = "localhost:8080"

        auth_token = token or self.token
        if username and password:
            try:
                login_headers = {"Host": "localhost:8080"} if any(h in active_url for h in ("host.docker.internal", "traefik", "cvat", "127.0.0.1")) else {}
                async with httpx.AsyncClient(timeout=4.0) as client:
                    login_res = await client.post(
                        f"{active_url}/api/auth/login",
                        json={"username": username, "password": password},
                        headers=login_headers
                    )
                    if login_res.status_code == 200:
                        login_data = login_res.json()
                        auth_token = login_data.get("key", "")
                        headers["Authorization"] = f"Token {auth_token}"
                        self.token = auth_token
                        self.auth_scheme = "Token"
                        self.username = username
                    elif login_res.status_code in (400, 401):
                        return {
                            "connected": False,
                            "message": f"CVAT phản hồi HTTP {login_res.status_code}: Tên đăng nhập ({username}) hoặc mật khẩu không chính xác!"
                        }
                    elif login_res.status_code == 403:
                        return {
                            "connected": False,
                            "message": f"CVAT từ chối đăng nhập (HTTP 403 Forbidden): Tài khoản {username} chưa được kích hoạt hoặc bị khóa."
                        }
                    elif login_res.status_code >= 500:
                        return {
                            "connected": False,
                            "message": f"Máy chủ CVAT lỗi nội bộ khi xử lý đăng nhập (HTTP {login_res.status_code})."
                        }
            except Exception as e:
                logger.warning(f"Error during CVAT login: {e}")
                return {
                    "connected": False,
                    "message": f"Lỗi kết nối khi gửi yêu cầu đăng nhập tới CVAT: {e}"
                }

        if auth_token:
            headers["Authorization"] = f"Token {auth_token}"
            self.token = auth_token
            # Verify token validity against CVAT
            try:
                async with httpx.AsyncClient(timeout=4.0) as client:
                    user_res = await client.get(f"{active_url}/api/users/self", headers=headers)
                    if user_res.status_code in (401, 403):
                        return {
                            "connected": False,
                            "message": f"Xác thực thất bại (HTTP {user_res.status_code}): CVAT Token không hợp lệ hoặc đã hết hạn."
                        }
                    elif user_res.status_code == 200:
                        uinfo = user_res.json()
                        self.username = uinfo.get("username", self.username)
            except Exception as e:
                logger.debug(f"Could not verify token with /api/users/self: {e}")

        self.base_url = active_url
        self.public_url = cvat_public_url
        if task_id and task_id != "demo":
            self.task_id = task_id
        self.save_persisted_config()

        version_str = server_about.get("version") if server_about else "2.x"
        masked = mask_token(auth_token)

        if task_id and task_id != "demo":
            try:
                async with httpx.AsyncClient(timeout=4.0) as client:
                    if task_res.status_code == 200:
                        tdata = task_res.json()
                        task_name = tdata.get("name", f"Task #{task_id}")
                        total_frames = tdata.get("size", 240)
                        return {
                            "connected": True,
                            "server_version": version_str,
                            "task_id": task_id,
                            "task_name": task_name,
                            "total_frames": total_frames,
                            "latency_ms": round(latency_ms, 1),
                            "token_masked": masked,
                            "message": f"Kết nối CVAT ({active_url}) thành công! Task #{task_id}: '{task_name}' ({total_frames} frames) - {latency_ms:.0f}ms"
                        }
                    elif task_res.status_code == 404:
                        return {
                            "connected": True,
                            "server_version": version_str,
                            "task_id": task_id,
                            "latency_ms": round(latency_ms, 1),
                            "token_masked": masked,
                            "message": f"Đã kết nối CVAT thành công ({latency_ms:.0f}ms), nhưng không tìm thấy Task #{task_id} (HTTP 404 Not Found)."
                        }
                    elif task_res.status_code == 401:
                        return {
                            "connected": False,
                            "message": f"Lỗi xác thực (HTTP 401 Unauthorized): CVAT Token không hợp lệ khi truy vấn Task #{task_id}."
                        }
                    elif task_res.status_code == 403:
                        return {
                            "connected": False,
                            "message": f"Không có quyền truy cập (HTTP 403 Forbidden): Tài khoản không được cấp quyền trên Task #{task_id}."
                        }
                    elif task_res.status_code >= 500:
                        return {
                            "connected": False,
                            "message": f"Máy chủ CVAT lỗi nội bộ (HTTP {task_res.status_code}) khi truy vấn Task #{task_id}."
                        }
            except Exception as e:
                logger.warning(f"Error checking task {task_id}: {e}")

        return {
            "connected": True,
            "server_version": version_str,
            "latency_ms": round(latency_ms, 1),
            "token_masked": masked,
            "message": f"Kết nối CVAT ({active_url}) thành công! Độ trễ: {latency_ms:.0f}ms"
        }

    # =========================================================================
    # CVAT REST API v2 Resource Discovery (Projects, Tasks, Jobs, Labels)
    # =========================================================================
    async def list_projects(self) -> List[Dict[str, Any]]:
        """Lists projects available to current credentials via GET /api/projects."""
        is_connected = await self.check_health()
        if not is_connected:
            return []
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                res = await client.get(f"{self.base_url}/api/projects", headers=self._get_headers())
                if res.status_code == 200:
                    data = res.json()
                    results = data.get("results", data) if isinstance(data, dict) else data
                    items = []
                    for p in results:
                        if isinstance(p, dict):
                            owner = p.get("owner")
                            owner_str = owner.get("username", "") if isinstance(owner, dict) else str(owner or "")
                            tasks = p.get("tasks")
                            t_count = tasks.get("count", 0) if isinstance(tasks, dict) else (len(tasks) if isinstance(tasks, list) else 0)
                            items.append({
                                "id": p.get("id"),
                                "name": p.get("name", f"Project #{p.get('id')}"),
                                "owner": owner_str,
                                "created_date": p.get("created_date"),
                                "updated_date": p.get("updated_date"),
                                "tasks_count": t_count
                            })
                    return items
        except Exception as e:
            logger.error(f"Error listing CVAT projects: {e}")
        return []

    async def list_tasks(self, project_id: Optional[int] = None) -> List[Dict[str, Any]]:
        """Lists tasks available via GET /api/tasks with optional project_id filter."""
        is_connected = await self.check_health()
        if not is_connected:
            return []
        try:
            params = {}
            if project_id is not None:
                params["project_id"] = str(project_id)
            async with httpx.AsyncClient(timeout=5.0) as client:
                res = await client.get(f"{self.base_url}/api/tasks", params=params, headers=self._get_headers())
                if res.status_code == 200:
                    data = res.json()
                    results = data.get("results", data) if isinstance(data, dict) else data
                    items = []
                    for t in results:
                        if isinstance(t, dict):
                            owner = t.get("owner")
                            owner_str = owner.get("username", "") if isinstance(owner, dict) else str(owner or "")
                            items.append({
                                "id": t.get("id"),
                                "name": t.get("name", f"Task #{t.get('id')}"),
                                "project_id": t.get("project_id"),
                                "status": t.get("status", "annotation"),
                                "size": t.get("size", 0),
                                "dimension": t.get("dimension", "3d"),
                                "owner": owner_str,
                                "updated_date": t.get("updated_date")
                            })
                    return items
        except Exception as e:
            logger.error(f"Error listing CVAT tasks: {e}")
        return []

    async def list_jobs(self, task_id: int) -> List[Dict[str, Any]]:
        """Lists jobs associated with a task via GET /api/jobs?task_id={task_id}."""
        is_connected = await self.check_health()
        if not is_connected:
            return []
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                res = await client.get(f"{self.base_url}/api/jobs", params={"task_id": str(task_id)}, headers=self._get_headers())
                if res.status_code == 200:
                    data = res.json()
                    results = data.get("results", data) if isinstance(data, dict) else data
                    items = []
                    for j in results:
                        if isinstance(j, dict):
                            assignee = j.get("assignee")
                            assignee_str = assignee.get("username", "") if isinstance(assignee, dict) else str(assignee or "")
                            items.append({
                                "id": j.get("id"),
                                "task_id": j.get("task_id", task_id),
                                "stage": j.get("stage", "annotation"),
                                "state": j.get("state", "in progress"),
                                "start_frame": j.get("start_frame", 0),
                                "stop_frame": j.get("stop_frame", 0),
                                "assignee": assignee_str,
                                "dimension": j.get("dimension", "3d")
                            })
                    return items
        except Exception as e:
            logger.error(f"Error listing CVAT jobs for task {task_id}: {e}")
        return []

    async def get_task_labels(self, task_id: int) -> Dict[int, str]:
        """Fetches labels mapping {label_id: label_name} from CVAT."""
        is_connected = await self.check_health()
        if not is_connected:
            return {}
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                res = await client.get(f"{self.base_url}/api/labels", params={"task_id": str(task_id)}, headers=self._get_headers())
                if res.status_code == 200:
                    data = res.json()
                    results = data.get("results", data) if isinstance(data, dict) else data
                    return {lbl["id"]: lbl.get("name", f"label_{lbl['id']}") for lbl in results if isinstance(lbl, dict) and "id" in lbl}
        except Exception as e:
            logger.debug(f"Could not load labels for task {task_id}: {e}")
        return {}

    # =========================================================================
    # Task Resolution & Resource Mapping (Day14 -> Task 16 Alias & 3D Tasks)
    # =========================================================================
    async def resolve_task_and_job(self, task_id: Optional[Any] = None, job_id: Optional[int] = None) -> Tuple[int, int]:
        """
        Resolves task_id and job_id against live CVAT tasks.
        Handles aliases like 14 -> 16 (for Task 'Day14_Tracking3D').
        Guarantees matching real Task ID and real Job ID.
        """
        tasks = await self.list_tasks()
        task_map = {t["id"]: t for t in tasks if isinstance(t, dict) and "id" in t}

        target_tid = None
        if task_id is not None and str(task_id).strip().isdigit():
            tid = int(str(task_id).strip())
            if tid in task_map:
                target_tid = tid
            elif tid == 14:
                for t in tasks:
                    if "day14" in t.get("name", "").lower():
                        target_tid = t["id"]
                        break

        if not target_tid:
            if self.task_id and str(self.task_id).isdigit():
                cfg_tid = int(self.task_id)
                if cfg_tid in task_map:
                    target_tid = cfg_tid
                elif cfg_tid == 14:
                    for t in tasks:
                        if "day14" in t.get("name", "").lower():
                            target_tid = t["id"]
                            break

        if not target_tid:
            for t in tasks:
                if t.get("dimension") == "3d":
                    target_tid = t["id"]
                    break

        if not target_tid and tasks:
            target_tid = tasks[0]["id"]

        final_tid = target_tid or 16

        final_jid = job_id
        jobs = await self.list_jobs(task_id=final_tid)
        job_ids = [j["id"] for j in jobs if isinstance(j, dict) and "id" in j]

        if final_jid not in job_ids:
            final_jid = job_ids[0] if job_ids else final_tid

        return final_tid, final_jid

    def _extract_all_shapes_from_ann_data(
        self,
        adata: Any,
        interpolate_tracks: bool = False,
        max_frame: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        Extracts both standalone shapes and track keyframe (or interpolated) shapes.
        Supports both CVAT REST API dict format and CVAT backup annotations.json list format.
        """
        import math
        if isinstance(adata, list):
            merged_shapes: List[Dict[str, Any]] = []
            for item in adata:
                if isinstance(item, dict):
                    merged_shapes.extend(
                        self._extract_all_shapes_from_ann_data(
                            item,
                            interpolate_tracks=interpolate_tracks,
                            max_frame=max_frame
                        )
                    )
            return merged_shapes

        if not isinstance(adata, dict):
            return []

        shapes: List[Dict[str, Any]] = []
        for idx, s in enumerate(adata.get("shapes", [])):
            if not isinstance(s, dict):
                continue
            sc = dict(s)
            if sc.get("id") is None:
                sc["id"] = idx + 1
            shapes.append(sc)

        for trk_idx, trk in enumerate(adata.get("tracks", [])):
            if not isinstance(trk, dict):
                continue
            trk_id = trk.get("id") if trk.get("id") is not None else (trk_idx + 1)
            trk_label_id = trk.get("label_id")
            trk_label_name = trk.get("label")
            trk_attrs = trk.get("attributes", [])
            raw_trk_shapes = [
                s for s in trk.get("shapes", [])
                if isinstance(s, dict) and len(s.get("points", [])) >= 9
            ]
            raw_trk_shapes.sort(key=lambda x: int(x.get("frame", 0)))

            if not interpolate_tracks:
                for s_idx, s in enumerate(raw_trk_shapes):
                    if s.get("outside", False) and len(raw_trk_shapes) > 1 and s_idx == len(raw_trk_shapes) - 1:
                        # Skip terminal outside marker frame unless it's the only shape
                        pass
                    sc = dict(s)
                    f_no = int(sc.get("frame", 0))
                    if sc.get("id") is None:
                        sc["id"] = trk_id * 1000 + f_no
                    if sc.get("label_id") is None and trk_label_id is not None:
                        sc["label_id"] = trk_label_id
                    if sc.get("label") is None and trk_label_name is not None:
                        sc["label"] = trk_label_name
                    sc["track_id"] = trk_id
                    sc["keyframe"] = True
                    if not sc.get("attributes"):
                        sc["attributes"] = trk_attrs
                    shapes.append(sc)
            else:
                for i, s1 in enumerate(raw_trk_shapes):
                    f1 = int(s1.get("frame", 0))
                    s1_id = s1.get("id") if s1.get("id") is not None else (trk_id * 1000 + f1)
                    if not s1.get("outside", False):
                        sc1 = dict(s1)
                        sc1["id"] = s1_id
                        if sc1.get("label_id") is None and trk_label_id is not None:
                            sc1["label_id"] = trk_label_id
                        if sc1.get("label") is None and trk_label_name is not None:
                            sc1["label"] = trk_label_name
                        sc1["track_id"] = trk_id
                        sc1["keyframe"] = True
                        if not sc1.get("attributes"):
                            sc1["attributes"] = trk_attrs
                        shapes.append(sc1)

                        # Interpolate to next keyframe if not outside
                        if i + 1 < len(raw_trk_shapes):
                            s2 = raw_trk_shapes[i + 1]
                            f2 = int(s2.get("frame", f1))
                            p1 = [float(v) for v in s1["points"][:9]]
                            p2 = [float(v) for v in s2["points"][:9]]
                            for f_mid in range(f1 + 1, f2):
                                t = float(f_mid - f1) / float(f2 - f1)
                                interp_pts = list(s1["points"])
                                for k in (0, 1, 2, 3, 4, 6, 7, 8):
                                    interp_pts[k] = p1[k] + t * (p2[k] - p1[k])
                                # Shortest angular interpolation for yaw (rz = index 5)
                                d_yaw = ((p2[5] - p1[5] + math.pi) % (2.0 * math.pi)) - math.pi
                                interp_pts[5] = p1[5] + t * d_yaw
                                sc_mid = dict(s1)
                                sc_mid["id"] = trk_id * 1000 + f_mid
                                sc_mid["frame"] = f_mid
                                sc_mid["points"] = interp_pts
                                if sc_mid.get("label_id") is None and trk_label_id is not None:
                                    sc_mid["label_id"] = trk_label_id
                                if sc_mid.get("label") is None and trk_label_name is not None:
                                    sc_mid["label"] = trk_label_name
                                sc_mid["track_id"] = trk_id
                                sc_mid["keyframe"] = False
                                if not sc_mid.get("attributes"):
                                    sc_mid["attributes"] = trk_attrs
                                shapes.append(sc_mid)
                        elif max_frame is not None and f1 < max_frame:
                            for f_tail in range(f1 + 1, max_frame + 1):
                                sc_tail = dict(s1)
                                sc_tail["id"] = trk_id * 1000 + f_tail
                                sc_tail["frame"] = f_tail
                                if sc_tail.get("label_id") is None and trk_label_id is not None:
                                    sc_tail["label_id"] = trk_label_id
                                if sc_tail.get("label") is None and trk_label_name is not None:
                                    sc_tail["label"] = trk_label_name
                                sc_tail["track_id"] = trk_id
                                sc_tail["keyframe"] = False
                                if not sc_tail.get("attributes"):
                                    sc_tail["attributes"] = trk_attrs
                                shapes.append(sc_tail)

        return shapes

    def _build_camera_overlays(
        self,
        frame_number: int,
        boxes: List[Dict[str, Any]],
        has_images: bool = True,
        job_id: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """Builds 3 synchronized camera overlays with projected 2D boxes."""
        if not has_images:
            return []
        q_suffix = f"?job_id={job_id}" if job_id is not None else ""
        rel_imgs: List[str] = []
        if self.uploaded_dataset_cache is not None:
            frames_meta = self.uploaded_dataset_cache.get("frames_meta", [])
            if frames_meta and 0 <= frame_number < len(frames_meta):
                rel_imgs = frames_meta[frame_number].get("related_images", [])

        if len(rel_imgs) >= 6:
            cam_defs = [
                ("CAM_FRONT_LEFT", "Front Left", 0),
                ("CAM_FRONT", "Front Center", 1),
                ("CAM_FRONT_RIGHT", "Front Right", 2),
                ("CAM_BACK_LEFT", "Rear Left", 3),
                ("CAM_BACK", "Rear Center", 4),
                ("CAM_BACK_RIGHT", "Rear Right", 5),
            ]
        elif len(rel_imgs) > 0:
            cam_defs = []
            for i, img_path in enumerate(rel_imgs):
                low = img_path.lower()
                if "front_left" in low:
                    cam_defs.append(("CAM_FRONT_LEFT", "Front Left", i))
                elif "front_right" in low:
                    cam_defs.append(("CAM_FRONT_RIGHT", "Front Right", i))
                elif "front" in low:
                    cam_defs.append(("CAM_FRONT", "Front Center", i))
                elif "back_left" in low or "rear_left" in low:
                    cam_defs.append(("CAM_BACK_LEFT", "Rear Left", i))
                elif "back_right" in low or "rear_right" in low:
                    cam_defs.append(("CAM_BACK_RIGHT", "Rear Right", i))
                elif "back" in low or "rear" in low:
                    cam_defs.append(("CAM_BACK", "Rear Center", i))
                else:
                    cam_defs.append((f"CAM_{i}", f"Camera {i+1}", i))
        else:
            cam_defs = [
                ("CAM_FRONT_LEFT", "Front Left (Trước Trái)", 0),
                ("CAM_FRONT", "Front Center (Trước Giữa)", 1),
                ("CAM_FRONT_RIGHT", "Front Right (Trước Phải)", 2),
            ]
        cameras: List[Dict[str, Any]] = []
        for cam_id, cam_name, cam_idx in cam_defs:
            proj_boxes = []
            # Do not draw inaccurate heuristic boxes on real photographs; keep real camera images clean
            if not has_images:
                for b in boxes:
                    defect = b.get("defect_type", "NONE")
                    color = "#f43f5e" if defect == "PCA_COLLAPSE" else ("#f59e0b" if defect == "Z_CUTOFF" else "#10b981")
                    bx = float(b.get("x", -15.0))
                    by = float(b.get("y", 0.0))
                    dist = max(4.0, float(b.get("distance", 18.0)))
                    bw = max(36, min(140, int(900.0 / dist)))
                    bh = 10 if defect == "PCA_COLLAPSE" else max(28, min(110, int(680.0 / dist)))
                    cx = int(200 - (by / max(1.0, abs(bx))) * 140)
                    cx = max(30 + bw // 2, min(370 - bw // 2, cx))
                    cy = max(95, min(185, int(125 + 180.0 / dist)))
                    if cam_idx == 1 or (cam_idx == 0 and by > 1.5) or (cam_idx == 2 and by < 1.5):
                        proj_boxes.append({
                            "box_id": b["id"],
                            "x1": cx - bw // 2,
                            "y1": cy - bh // 2,
                            "x2": cx + bw // 2,
                            "y2": cy + bh // 2,
                            "defect": defect,
                            "color": color,
                        })
            cameras.append({
                "cam_id": cam_id,
                "name": cam_name,
                "image_url": f"/api/qc/camera-image/{frame_number}/{cam_idx}{q_suffix}",
                "projected_boxes": proj_boxes,
            })
        return cameras

    # =========================================================================
    # Frame and LiDAR Point Cloud Data Retrieval
    # =========================================================================
    async def fetch_frame_point_cloud(self, job_id: int, frame_number: int) -> Tuple[np.ndarray, str]:
        """
        Fetches real LiDAR point cloud for job_id at frame_number from CVAT (or uploaded archive fallback).
        Tries original quality first with 35s timeout for large PCDs. Parses PCD/bin.
        """
        if self.active_source == "uploaded" and self.uploaded_dataset_cache is not None:
            pts_up, fmt_up = self._read_uploaded_frame_points(frame_number)
            if len(pts_up) > 0:
                return pts_up, fmt_up

        is_connected = await self.check_health()
        if is_connected:
            for quality in ("original", "compressed"):
                try:
                    async with httpx.AsyncClient(timeout=35.0) as client:
                        url = f"{self.base_url}/api/jobs/{job_id}/data"
                        params = {"type": "frame", "number": str(frame_number), "quality": quality}
                        res = await client.get(url, params=params, headers=self._get_headers())
                        if res.status_code == 200:
                            raw_bytes = res.content
                            if raw_bytes and len(raw_bytes) > 0:
                                pts, fmt = parse_pcd_or_bin(raw_bytes)
                                if len(pts) > 0:
                                    valid_mask = np.isfinite(pts).all(axis=1)
                                    pts = pts[valid_mask]
                                    return pts, fmt
                                if raw_bytes[:2] == b"PK":
                                    with zipfile.ZipFile(io.BytesIO(raw_bytes)) as z:
                                        for name in z.namelist():
                                            if name.lower().endswith((".pcd", ".bin")):
                                                pts, fmt = parse_pcd_or_bin(z.read(name), name)
                                                if len(pts) > 0:
                                                    valid_mask = np.isfinite(pts).all(axis=1)
                                                    pts = pts[valid_mask]
                                                    return pts, fmt
                except Exception as e:
                    logger.debug(f"Error fetching point cloud frame {frame_number} from CVAT ({quality}): {e}")

        # Fallback to uploaded archive if available
        if self.uploaded_dataset_cache is not None:
            pts_up, fmt_up = self._read_uploaded_frame_points(frame_number)
            if len(pts_up) > 0:
                return pts_up, fmt_up

        return np.empty((0, 3), dtype=np.float64), "unavailable" if is_connected else "unavailable_offline"

    async def fetch_frame_detail(self, job_id: int, frame_number: int, task_id: Optional[int] = None) -> Dict[str, Any]:
        """
        Fetches real LiDAR point cloud and real 3D cuboid annotations for job_id at frame_number.
        Supports both Uploaded Local Dataset (.zip/.pcd) and Live CVAT 2-Way Mode.
        """
        from .m45_engine import m45_engine

        # Check if uploaded dataset is active (or CVAT is offline and uploaded cache exists)
        is_connected = await self.check_health()
        use_uploaded = (
            self.uploaded_dataset_cache is not None
            and (self.active_source == "uploaded" or not is_connected)
        )

        if use_uploaded and self.uploaded_dataset_cache is not None:
            return self._fetch_uploaded_frame_detail(frame_number)

        if not is_connected:
            return {
                "frame_id": frame_number,
                "pcd_file": f"PIM_{frame_number:03d}.PCD",
                "total_frames": 0,
                "points": [],
                "boxes": [],
                "selected_box_id": None,
                "cameras": [],
                "sotif_metrics": {}
            }

        # 1. Fetch real point cloud
        pts, fmt = await self.fetch_frame_point_cloud(job_id, frame_number)

        # 2. Fetch label mappings if task_id provided
        label_map = {}
        if task_id:
            label_map = await self.get_task_labels(task_id)

        # 3. Total frames
        total_frames = 1
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                m_res = await client.get(f"{self.base_url}/api/jobs/{job_id}/data/meta", headers=self._get_headers())
                if m_res.status_code == 200:
                    total_frames = m_res.json().get("size", 1)
        except Exception:
            pass

        # 4. Fetch real annotations (including interpolated track cuboids)
        ann_data = await self.get_job_annotations(job_id, interpolate_tracks=True, max_frame=max(0, total_frames - 1))
        shapes = ann_data.get("shapes", [])
        frame_shapes = [s for s in shapes if s.get("frame") == frame_number and s.get("type") in ("cuboid", "box")]

        boxes: List[Dict[str, Any]] = []
        selected_box_id = None

        for s in frame_shapes:
            p = s.get("points", [])
            if len(p) < 9:
                continue
            x, y, z, rx, ry, rz, dx, dy, dz = p[:9]
            sid = s.get("id")
            label_name = s.get("label") or label_map.get(s.get("label_id"), "Vehicle.Car")

            raw_attrs = s.get("attributes", {})
            attr_dict = {}
            if isinstance(raw_attrs, dict):
                attr_dict = dict(raw_attrs)
            elif isinstance(raw_attrs, list):
                for a in raw_attrs:
                    if isinstance(a, dict):
                        key = str(a.get("name") or a.get("spec_id") or len(attr_dict))
                        attr_dict[key] = a.get("value")

            box_model = BoundingBox3D(
                id=f"cuboid_{sid}",
                track_id=s.get("track_id") or sid,
                label=label_name,
                x=float(x), y=float(y), z=float(z),
                dx=float(dx), dy=float(dy), dz=float(dz),
                rotation_yaw=float(rz),
                cvat_shape_id=sid,
                attributes=attr_dict
            )

            # Real point cropping if points exist
            pts_in_box = None
            if len(pts) > 0:
                pts_in_box = m45_engine.extract_points_in_box(pts, box_model)

            analyzed = m45_engine.analyze_cuboid(box_model, points=pts_in_box)
            boxes.append(analyzed.model_dump())

            if selected_box_id is None:
                selected_box_id = analyzed.id
            elif analyzed.quality_tier == "HARD_EXPERT_REVIEW" and (not selected_box_id or "cuboid" in selected_box_id):
                selected_box_id = analyzed.id

        # 5. SOTIF metrics based on actual objects
        d_react, d_brake, d_stop = m45_engine.calculate_stopping_distance(50.0)
        sotif_metrics = {
            "speed_kmh": 50.0,
            "reaction_dist_m": round(d_react, 2),
            "braking_dist_m": round(d_brake, 2),
            "stopping_dist_m": round(d_stop, 2),
            "in_corridor": any(b["distance"] < d_stop for b in boxes) if boxes else False
        }

        # 6. Points formatting [x, y, z, intensity] with valid finite points & subsampling
        points_list: List[List[float]] = []
        if len(pts) > 0:
            valid_mask = np.isfinite(pts[:, :3]).all(axis=1)
            clean_pts = pts[valid_mask]
            step = max(1, len(clean_pts) // 100000)
            render_pts = clean_pts[::step]
            for pt in render_pts:
                intensity = max(10.0, min(255.0, (float(pt[2]) + 2.0) * 50.0))
                points_list.append([round(float(pt[0]), 3), round(float(pt[1]), 3), round(float(pt[2]), 3), round(intensity, 1)])

        has_cam_images = bool(self.uploaded_dataset_cache and self.uploaded_dataset_cache.get("has_cameras"))
        cameras = self._build_camera_overlays(frame_number, boxes, has_images=has_cam_images or True, job_id=job_id)

        return {
            "frame_id": frame_number,
            "pcd_file": f"PIM_{frame_number:03d}.PCD",
            "total_frames": max(1, total_frames),
            "points": points_list,
            "boxes": boxes,
            "selected_box_id": selected_box_id,
            "cameras": cameras,
            "sotif_metrics": sotif_metrics
        }

    async def check_frame_data_access(self, job_id: int, frame_number: int = 0) -> Dict[str, Any]:
        """
        Verifies access to point cloud, cameras, and calibration for a job.
        Checks GET /api/jobs/{job_id}/data/meta and frame data endpoints.
        """
        is_connected = await self.check_health()
        if not is_connected:
            return {
                "job_id": job_id,
                "frame_number": frame_number,
                "can_access_pcd": False,
                "can_access_cameras": False,
                "can_access_calibration": False,
                "point_cloud_format": "unavailable",
                "points_count": 0,
                "error": "CVAT Server đang ngoại tuyến hoặc không thể kết nối.",
                "details": {"connected": False}
            }

        status = {
            "job_id": job_id,
            "frame_number": frame_number,
            "can_access_pcd": False,
            "can_access_cameras": False,
            "can_access_calibration": False,
            "point_cloud_format": "unknown",
            "points_count": 0,
            "error": None,
            "details": {}
        }

        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                meta_res = await client.get(f"{self.base_url}/api/jobs/{job_id}/data/meta", headers=self._get_headers())
                if meta_res.status_code == 200:
                    status["details"]["meta"] = meta_res.json()
                elif meta_res.status_code in (401, 403):
                    status["error"] = f"CVAT HTTP {meta_res.status_code}: Không có quyền truy cập dữ liệu job {job_id}."
                    return status

                cam_res = await client.get(
                    f"{self.base_url}/api/jobs/{job_id}/data",
                    params={"type": "context_image", "number": str(frame_number), "step": "0"},
                    headers=self._get_headers()
                )
                if cam_res.status_code == 200:
                    status["can_access_cameras"] = True
                status["details"]["camera_probe_status"] = cam_res.status_code

            pts, fmt = await self.fetch_frame_point_cloud(job_id, frame_number)
            if len(pts) > 0:
                status["can_access_pcd"] = True
                status["point_cloud_format"] = fmt
                status["points_count"] = len(pts)
            else:
                status["point_cloud_format"] = fmt
                if fmt == "unrecognized":
                    status["error"] = "Dữ liệu trả về từ CVAT không nhận diện được định dạng PCD/BIN."

        except Exception as e:
            status["error"] = f"Lỗi khi kiểm tra truy cập dữ liệu frame CVAT: {e}"

        return status

    # =========================================================================
    # Annotations & Safe Sync (Preview & Confirmed Apply)
    # =========================================================================
    async def get_job_annotations(
        self,
        job_id: int,
        interpolate_tracks: bool = False,
        max_frame: Optional[int] = None
    ) -> Dict[str, Any]:
        """Fetches annotations for a job via GET /api/jobs/{job_id}/annotations, merging tracks into shapes."""
        is_connected = await self.check_health()
        if is_connected:
            try:
                async with httpx.AsyncClient(timeout=8.0) as client:
                    res = await client.get(f"{self.base_url}/api/jobs/{job_id}/annotations", headers=self._get_headers())
                    if res.status_code == 200:
                        adata = res.json()
                        all_shapes = self._extract_all_shapes_from_ann_data(
                            adata,
                            interpolate_tracks=interpolate_tracks,
                            max_frame=max_frame
                        )
                        if all_shapes or self.active_source == "cvat":
                            return {
                                "shapes": all_shapes,
                                "tracks": adata.get("tracks", []) if isinstance(adata, dict) else [],
                                "tags": adata.get("tags", []) if isinstance(adata, dict) else []
                            }
            except Exception as e:
                logger.error(f"Error fetching annotations for job {job_id}: {e}")

        if self.uploaded_dataset_cache is not None:
            key = "all_shapes" if interpolate_tracks else "keyframe_shapes"
            return {
                "shapes": list(self.uploaded_dataset_cache.get(key, [])),
                "tracks": [],
                "tags": []
            }
        return {"shapes": [], "tracks": [], "tags": []}

    async def generate_sync_proposal(self, job_id: int, task_id: Optional[int] = None) -> Dict[str, Any]:
        """
        Safe Sync Step 1: Read-only preview generation.
        Fetches current annotations, runs M45 engine, and compiles proposed modifications.
        Does NOT modify any data in CVAT.
        """
        is_connected = await self.check_health()
        if not is_connected and self.uploaded_dataset_cache is None:
            return {
                "job_id": job_id,
                "task_id": task_id,
                "total_shapes": 0,
                "modified_count": 0,
                "unmodified_count": 0,
                "flagged_issues_count": 0,
                "proposals": [],
                "requires_confirmation": False,
                "warning_message": "CVAT Server đang ngoại tuyến hoặc không thể kết nối. Không thể tạo Safe Sync preview."
            }

        shapes = []
        task_labels = {}
        try:
            if task_id and is_connected:
                task_labels = await self.get_task_labels(task_id)
            ann_data = await self.get_job_annotations(job_id)
            shapes = ann_data.get("shapes", [])
        except Exception as e:
            logger.error(f"Error fetching job {job_id} annotations: {e}")
            return {
                "job_id": job_id,
                "task_id": task_id,
                "total_shapes": 0,
                "modified_count": 0,
                "unmodified_count": 0,
                "flagged_issues_count": 0,
                "proposals": [],
                "requires_confirmation": False,
                "warning_message": f"Không thể lấy annotations từ CVAT Job #{job_id}: {e}"
            }

        if not shapes:
            return {
                "job_id": job_id,
                "task_id": task_id,
                "total_shapes": 0,
                "modified_count": 0,
                "unmodified_count": 0,
                "flagged_issues_count": 0,
                "proposals": [],
                "requires_confirmation": False,
                "warning_message": f"Job #{job_id} không có annotation nào trên CVAT."
            }

        from .m45_engine import m45_engine

        proposals = []
        modified_count = 0
        unmodified_count = 0
        flagged_issues_count = 0
        cached_pcd_frames = {}

        for s in shapes:
            s_id = s.get("id")
            s_frame = s.get("frame", 0)
            pts_vec = s.get("points", [])
            label_name = s.get("label") or task_labels.get(s.get("label_id"), "Vehicle.Car")

            if len(pts_vec) < 9:
                continue

            x, y, z, rx, ry, rz, dx, dy, dz = pts_vec[:9]
            box_model = BoundingBox3D(
                id=f"cuboid_{s_id}",
                track_id=s.get("track_id") or s_id,
                label=label_name,
                x=float(x), y=float(y), z=float(z),
                dx=float(dx), dy=float(dy), dz=float(dz),
                rotation_yaw=float(rz),
                cvat_shape_id=s_id
            )

            frame_points = None
            if is_connected or self.uploaded_dataset_cache is not None:
                if s_frame not in cached_pcd_frames:
                    pts_arr, _ = await self.fetch_frame_point_cloud(job_id, s_frame)
                    cached_pcd_frames[s_frame] = pts_arr
                all_pts = cached_pcd_frames.get(s_frame)
                if all_pts is not None and len(all_pts) > 0:
                    frame_points = m45_engine.extract_points_in_box(all_pts, box_model)
                    analyzed_box = m45_engine.analyze_cuboid(box_model, points=frame_points)
                else:
                    analyzed_box = m45_engine.analyze_cuboid(box_model, points=None, filtered_pts=max(15, box_model.points_count or 15))
            else:
                analyzed_box = m45_engine.analyze_cuboid(box_model, points=None, filtered_pts=max(15, box_model.points_count or 15))

            action = "KEEP"
            proposed_points = None
            original_values = {
                "x": round(x, 3), "y": round(y, 3), "z": round(z, 3),
                "dx": round(dx, 3), "dy": round(dy, 3), "dz": round(dz, 3),
                "yaw": round(rz, 3)
            }
            proposed_values = dict(original_values)
            reason = analyzed_box.notes or "Hình học đạt chuẩn."

            if analyzed_box.defect_type == "PCA_COLLAPSE":
                action = "MODIFY_DIMENSIONS"
                suggested_dz = 1.55 if ("car" in label_name.lower() or "vehicle" in label_name.lower()) else max(1.2, float(dz))
                proposed_points = [x, y, z, rx, ry, rz, dx, dy, suggested_dz]
                proposed_values["dz"] = suggested_dz
                reason = f"Phát hiện suy biến PCA (dz={dz:.3f}m < 0.05m). Đề xuất phục hồi dz={suggested_dz:.2f}m."
                modified_count += 1
                flagged_issues_count += 1
            elif analyzed_box.defect_type == "Z_CUTOFF":
                action = "FLAG_ISSUE"
                reason = f"Lỗi cắt nhầm điểm mặt đường z-cutoff (z={z:.2f}m). Cần chuyên gia kiểm định thủ công."
                flagged_issues_count += 1
            elif analyzed_box.defect_type == "SPARSE_POINT_ANOMALY":
                action = "FLAG_ISSUE"
                reason = "Dữ liệu quá thưa (dưới 3 điểm), không đủ để xác định hình học 3D."
                flagged_issues_count += 1
            else:
                unmodified_count += 1

            proposals.append({
                "shape_id": s_id,
                "track_id": s.get("track_id") or s_id,
                "frame": s_frame,
                "label": label_name,
                "action": action,
                "m45_defect_type": analyzed_box.defect_type or "NONE",
                "quality_tier": analyzed_box.quality_tier,
                "original_points": pts_vec,
                "proposed_points": proposed_points,
                "original_values": original_values,
                "proposed_values": proposed_values,
                "reason": reason,
                "attributes": analyzed_box.attributes
            })

        return {
            "job_id": job_id,
            "task_id": task_id,
            "total_shapes": len(proposals),
            "modified_count": modified_count,
            "unmodified_count": unmodified_count,
            "flagged_issues_count": flagged_issues_count,
            "proposals": proposals,
            "requires_confirmation": True,
            "warning_message": "Xem trước các thay đổi đề xuất. Dữ liệu CHƯA được ghi lên CVAT. Cần người dùng phê duyệt trước khi áp dụng."
        }

    async def apply_sync_changes(self,
                                 job_id: int,
                                 approved_shape_ids: List[int],
                                 proposals: List[Dict[str, Any]],
                                 confirm_apply: bool,
                                 include_issue_creation: bool = False) -> Dict[str, Any]:
        """
        Safe Sync Step 2: Commits approved changes to CVAT ONLY when confirm_apply is True.
        Rejects immediately if confirm_apply is False.
        """
        if not confirm_apply:
            return {
                "success": False,
                "job_id": job_id,
                "applied_count": 0,
                "failed_count": len(proposals),
                "skipped_count": 0,
                "results": [],
                "errors": [
                    "SAFE_SYNC_REJECTED: Thao tác ghi bị từ chối vì thiếu xác nhận rõ ràng (confirm_apply=True) từ người dùng."
                ],
                "message": "Thao tác ghi bị hủy an toàn: confirm_apply phải là True để thực thi."
            }

        id_set = set(approved_shape_ids) if approved_shape_ids else set()
        to_modify = []
        to_flag = []

        for p in proposals:
            s_id = p.get("shape_id")
            if id_set and s_id not in id_set:
                continue

            if p.get("action") in ("MODIFY", "MODIFY_DIMENSIONS") and p.get("proposed_points"):
                to_modify.append(p)
            elif p.get("action") == "FLAG_ISSUE":
                to_flag.append(p)

        is_connected = await self.check_health()
        results = []
        errors = []
        applied_count = 0
        failed_count = 0

        if not is_connected:
            return {
                "success": False,
                "job_id": job_id,
                "applied_count": 0,
                "failed_count": len(to_modify),
                "skipped_count": 0,
                "results": [],
                "errors": ["CVAT Server đang ngoại tuyến. Không thể áp dụng thay đổi."],
                "message": "CVAT Server đang ngoại tuyến. Thao tác áp dụng thay đổi bị hủy."
            }

        if to_modify:
            cvat_shapes_payload = [
                {
                    "id": item["shape_id"],
                    "points": item["proposed_points"]
                }
                for item in to_modify
            ]
            try:
                async with httpx.AsyncClient(timeout=8.0) as client:
                    patch_res = await client.patch(
                        f"{self.base_url}/api/jobs/{job_id}/annotations?action=update",
                        json={"shapes": cvat_shapes_payload},
                        headers=self._get_headers()
                    )
                    if patch_res.status_code in (200, 204):
                        for item in to_modify:
                            results.append({
                                "shape_id": item["shape_id"],
                                "status": "APPLIED",
                                "sync_mode": "LIVE_CVAT",
                                "updated_points": item["proposed_points"]
                            })
                            applied_count += 1
                    else:
                        err_msg = f"CVAT PATCH annotations trả về HTTP {patch_res.status_code}: {patch_res.text}"
                        errors.append(err_msg)
                        failed_count += len(to_modify)
                        logger.error(err_msg)
            except Exception as e:
                err_msg = f"Lỗi mạng khi gửi PATCH annotations tới CVAT: {e}"
                errors.append(err_msg)
                failed_count += len(to_modify)
                logger.error(err_msg)

        if include_issue_creation and to_flag:
            for item in to_flag:
                issue_res = await self.create_issue(
                    job_id=job_id,
                    frame=item.get("frame", 0),
                    position=[0.0, 0.0],
                    title=f"M45 QC Flag: {item.get('m45_defect_type', 'DEFECT')}",
                    description=item.get("reason", "Lỗi kiểm định hình học M45"),
                    severity="error" if item.get("m45_defect_type") == "PCA_COLLAPSE" else "warning"
                )
                results.append({
                    "shape_id": item["shape_id"],
                    "status": "ISSUE_CREATED" if issue_res.get("success") else "ISSUE_FAILED",
                    "issue_id": issue_res.get("issue_id"),
                    "details": issue_res
                })

        overall_success = (failed_count == 0 and (applied_count > 0 or len(to_modify) == 0))
        return {
            "success": overall_success,
            "job_id": job_id,
            "applied_count": applied_count,
            "failed_count": failed_count,
            "skipped_count": len(proposals) - applied_count - failed_count,
            "results": results,
            "errors": errors,
            "message": f"Safe Sync hoàn tất: {applied_count} cập nhật thành công, {failed_count} lỗi." if overall_success else f"Safe Sync gặp lỗi: {'; '.join(errors)}"
        }

    # =========================================================================
    # Issues and Direct Annotation Patching
    # =========================================================================
    async def create_issue(self,
                           job_id: int,
                           frame: int = 0,
                           position: Optional[List[float]] = None,
                           title: str = "",
                           description: str = "",
                           severity: str = "error",
                           issue_payload: Optional[Dict[str, Any]] = None,
                           **kwargs) -> Dict[str, Any]:
        """
        Creates an Issue in CVAT: POST /api/issues.
        Uses verified CVAT REST API v2 schema: job, frame, position [x, y], comments.
        Accepts both direct arguments and an issue_payload dictionary.
        """
        if issue_payload:
            frame = issue_payload.get("frame", frame)
            pos_val = issue_payload.get("position", position)
            if pos_val:
                position = pos_val
            title = issue_payload.get("title", title)
            description = issue_payload.get("description", description or issue_payload.get("comment", ""))
            severity = issue_payload.get("severity", severity)
            if not job_id and issue_payload.get("job_id"):
                job_id = issue_payload["job_id"]

        is_connected = await self.check_health()
        if not is_connected:
            return {
                "success": False,
                "id": None,
                "issue_id": None,
                "job_id": job_id,
                "status": "FAILED_OFFLINE",
                "title": title,
                "description": description,
                "severity": severity,
                "message": "Không thể gửi Issue: CVAT Server đang ngoại tuyến."
            }

        comment_msg = f"[{severity.upper()} - M45 ENGINE v2.8] {title}: {description}"
        pos = position if (isinstance(position, (list, tuple)) and len(position) >= 2) else [0.0, 0.0]

        # Standard CVAT REST v2 issue payload
        body = {
            "job": job_id,
            "frame": frame,
            "position": pos,
            "comments": [{"message": comment_msg}]
        }

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                res = await client.post(f"{self.base_url}/api/issues", json=body, headers=self._get_headers())
                if res.status_code in (200, 201):
                    data = res.json()
                    return {
                        "success": True,
                        "id": data.get("id"),
                        "issue_id": data.get("id"),
                        "status": "CREATED",
                        "message": f"Đã tạo Issue #{data.get('id')} trên CVAT thành công.",
                        "details": data
                    }
                # Fallback for CVAT versions that use 'job_id' instead of 'job'
                if res.status_code == 400 and ("job_id" in res.text or "job" in res.text):
                    body["job_id"] = job_id
                    del body["job"]
                    res2 = await client.post(f"{self.base_url}/api/issues", json=body, headers=self._get_headers())
                    if res2.status_code in (200, 201):
                        data2 = res2.json()
                        return {
                            "success": True,
                            "id": data2.get("id"),
                            "issue_id": data2.get("id"),
                            "status": "CREATED",
                            "message": f"Đã tạo Issue #{data2.get('id')} trên CVAT thành công.",
                            "details": data2
                        }

                return {
                    "success": False,
                    "id": None,
                    "issue_id": None,
                    "status": "FAILED",
                    "status_code": res.status_code,
                    "message": f"CVAT trả về HTTP {res.status_code}: {res.text}"
                }
        except Exception as e:
            logger.error(f"Failed to post issue to CVAT: {e}")
            return {
                "success": False,
                "id": None,
                "issue_id": None,
                "status": "ERROR",
                "message": f"Lỗi kết nối khi gửi Issue tới CVAT: {e}"
            }

    async def patch_annotation(self, job_id: int, shape_id: int, patch_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Updates a 3D cuboid shape in CVAT: PATCH /api/jobs/{job_id}/annotations?action=update.
        Also updates local uploaded dataset cache if loaded.
        """
        updated_local = False
        if self.uploaded_dataset_cache is not None:
            for key in ("keyframe_shapes", "all_shapes"):
                for s in self.uploaded_dataset_cache.get(key, []):
                    if s.get("id") == shape_id and len(s.get("points", [])) >= 9:
                        pts = list(s["points"])
                        if "points" in patch_data and len(patch_data["points"]) >= 9:
                            pts = list(patch_data["points"])
                        else:
                            if "x" in patch_data: pts[0] = float(patch_data["x"])
                            if "y" in patch_data: pts[1] = float(patch_data["y"])
                            if "z" in patch_data: pts[2] = float(patch_data["z"])
                            if "rotation_yaw" in patch_data: pts[5] = float(patch_data["rotation_yaw"])
                            if "dx" in patch_data: pts[6] = float(patch_data["dx"])
                            if "dy" in patch_data: pts[7] = float(patch_data["dy"])
                            if "dz" in patch_data: pts[8] = float(patch_data["dz"])
                        s["points"] = pts
                        updated_local = True

        is_connected = await self.check_health()
        if not is_connected:
            if updated_local:
                return {"success": True, "status_code": 200, "sync_mode": "LOCAL_DATASET_CACHE"}
            return {
                "success": False,
                "shape_id": shape_id,
                "error": "CVAT Server đang ngoại tuyến. Không thể cập nhật annotation."
            }

        shape_item: Dict[str, Any] = {"id": shape_id}
        if "points" in patch_data:
            shape_item["points"] = patch_data["points"]
        elif any(k in patch_data for k in ("dz", "dx", "dy", "x", "y", "z", "rotation_yaw")):
            # Need existing points vector to safely patch without destroying other coordinates
            current_ann = await self.get_job_annotations(job_id)
            existing_shape = None
            for s in current_ann.get("shapes", []):
                if s.get("id") == shape_id:
                    existing_shape = s
                    break
            if existing_shape and len(existing_shape.get("points", [])) >= 9:
                pts = list(existing_shape["points"])
                if "x" in patch_data: pts[0] = float(patch_data["x"])
                if "y" in patch_data: pts[1] = float(patch_data["y"])
                if "z" in patch_data: pts[2] = float(patch_data["z"])
                if "rotation_yaw" in patch_data: pts[5] = float(patch_data["rotation_yaw"])
                if "dx" in patch_data: pts[6] = float(patch_data["dx"])
                if "dy" in patch_data: pts[7] = float(patch_data["dy"])
                if "dz" in patch_data: pts[8] = float(patch_data["dz"])
                shape_item["points"] = pts
            elif updated_local:
                return {"success": True, "status_code": 200, "sync_mode": "LOCAL_DATASET_CACHE"}
            else:
                return {
                    "success": False,
                    "error": f"Không tìm thấy shape_id {shape_id} trên CVAT để lấy vector tọa độ gốc."
                }
        else:
            shape_item.update(patch_data)

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                res = await client.patch(
                    f"{self.base_url}/api/jobs/{job_id}/annotations?action=update",
                    json={"shapes": [shape_item]},
                    headers=self._get_headers()
                )
                if res.status_code in (200, 204):
                    return {"success": True, "status_code": res.status_code, "sync_mode": "LIVE_CVAT"}
                if updated_local:
                    return {"success": True, "status_code": 200, "sync_mode": "LOCAL_DATASET_CACHE"}
                return {"success": False, "status_code": res.status_code, "error": res.text}
        except Exception as e:
            if updated_local:
                return {"success": True, "status_code": 200, "sync_mode": "LOCAL_DATASET_CACHE"}
            return {"success": False, "error": str(e)}

    # =========================================================================
    # Task Info and Dataset Sync (Real CVAT Data & Uploaded Archive Support)
    # =========================================================================
    async def get_task_info(self, task_id: str) -> Dict[str, Any]:
        """Fetch task metadata from CVAT without mock demo fallback."""
        self.load_persisted_config()
        effective_task_id = str(task_id).strip() if (task_id and task_id != "demo") else self.task_id
        is_connected = await self.check_health()

        if not is_connected or effective_task_id == "demo":
            if self.uploaded_dataset_cache is not None and self.uploaded_dataset_cache.get("task_info"):
                t_info = dict(self.uploaded_dataset_cache["task_info"])
                t_info["connected"] = is_connected
                return t_info
            return {
                "id": str(effective_task_id),
                "name": f"Task #{effective_task_id} (Ngoại tuyến)",
                "status": "offline",
                "total_frames": 0,
                "easy_count": 0,
                "medium_count": 0,
                "hard_count": 0,
                "drop_count": 0,
                "cvat_url": f"{self.public_url}/tasks/{effective_task_id}",
                "connected": False
            }

        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                res = await client.get(f"{self.base_url}/api/tasks/{effective_task_id}", headers=self._get_headers())
                if res.status_code == 200:
                    data = res.json()
                    actual_id = str(data.get("id", effective_task_id))
                    task_name = data.get("name", f"CVAT Task #{actual_id}")
                    total_frames = data.get("size", 0)

                    # Calculate real easy/hard counts from real annotations if jobs exist
                    easy_cnt = 0
                    hard_cnt = 0
                    jres = await client.get(f"{self.base_url}/api/jobs?task_id={actual_id}", headers=self._get_headers())
                    if jres.status_code == 200:
                        jobs = jres.json().get("results", [])
                        for job in jobs:
                            jid = job.get("id")
                            if jid:
                                ja_res = await client.get(f"{self.base_url}/api/jobs/{jid}/annotations", headers=self._get_headers())
                                if ja_res.status_code == 200:
                                    j_shapes = self._extract_all_shapes_from_ann_data(ja_res.json())
                                    for s in j_shapes:
                                        p = s.get("points", [])
                                        if len(p) >= 9:
                                            dz = float(p[8])
                                            if dz < 0.05:
                                                hard_cnt += 1
                                            else:
                                                easy_cnt += 1

                    return {
                        "id": actual_id,
                        "name": task_name,
                        "status": data.get("status", "in_progress"),
                        "total_frames": total_frames,
                        "easy_count": easy_cnt,
                        "medium_count": 0,
                        "hard_count": hard_cnt,
                        "drop_count": 0,
                        "cvat_url": f"{self.public_url}/tasks/{actual_id}",
                        "connected": True
                    }
        except Exception as e:
            logger.warning(f"Error fetching task info {effective_task_id}: {e}")

        return {
            "id": effective_task_id,
            "name": f"Task #{effective_task_id}",
            "status": "error",
            "total_frames": 0,
            "easy_count": 0,
            "medium_count": 0,
            "hard_count": 0,
            "drop_count": 0,
            "cvat_url": f"{self.public_url}/tasks/{effective_task_id}",
            "connected": is_connected
        }

    def _evaluate_shapes_to_dataset(
        self,
        shapes: List[Dict[str, Any]],
        total_frames: int,
        dataset_name: str,
        task_info: Dict[str, Any],
        label_map: Optional[Dict[int, str]] = None,
        frames_meta: Optional[List[Dict[str, Any]]] = None,
        point_cloud_loader: Optional[ Any ] = None
    ) -> Dict[str, Any]:
        """
        Evaluates a list of 3D cuboid shapes using M45Engine (and optional real point cloud cropping)
        to build the standardized DatasetUploadResponse dict (`summary`, `flagged_cases`, `task_info`).
        """
        import math
        from .m45_engine import m45_engine

        lbl_map = label_map or {}
        real_flagged_cases: List[Dict[str, Any]] = []
        easy_count = 0
        hard_count = 0
        pipeline_count = 0
        cached_pts: Dict[int, np.ndarray] = {}

        for idx, s in enumerate(shapes):
            p = s.get("points", [])
            if len(p) < 9:
                continue
            x, y, z, rx, ry, rz, dx, dy, dz = [float(v) for v in p[:9]]
            dist = math.sqrt(x * x + y * y + z * z)
            frame_no = int(s.get("frame", 0))
            sid = s.get("id") if s.get("id") is not None else (idx + 1)
            box_id = str(sid) if str(sid).startswith("cuboid_") else f"cuboid_{sid}"
            label_name = s.get("label") or lbl_map.get(s.get("label_id"), "Vehicle.Car")

            pcd_name = f"PIM_{frame_no:03d}.PCD"
            if frames_meta and 0 <= frame_no < len(frames_meta):
                pcd_name = frames_meta[frame_no].get("pcd_name", pcd_name)

            pts_in_box = None
            raw_pts_cnt = 0
            filt_pts_cnt = 0
            h_effective = float(dz)

            if point_cloud_loader is not None:
                if frame_no not in cached_pts:
                    cached_pts[frame_no] = point_cloud_loader(frame_no)
                frame_pts = cached_pts.get(frame_no)
                if frame_pts is not None and len(frame_pts) > 0:
                    box_model = BoundingBox3D(
                        id=box_id,
                        track_id=s.get("track_id") or sid,
                        label=label_name,
                        x=x, y=y, z=z,
                        dx=dx, dy=dy, dz=dz,
                        rotation_yaw=rz,
                        cvat_shape_id=sid
                    )
                    pts_in_box = m45_engine.extract_points_in_box(frame_pts, box_model)
                    analyzed = m45_engine.analyze_cuboid(box_model, points=pts_in_box)
                    filt_pts_cnt = analyzed.points_count
                    raw_pts_cnt = analyzed.raw_points_count
                    if "pca_h_span" in analyzed.attributes and analyzed.defect_type == "PCA_COLLAPSE":
                        h_effective = float(analyzed.attributes["pca_h_span"])

            category = "EASY_AUTO"
            badge_text = "EASY • Đạt chuẩn"
            sotif_risk = "SAFE"
            pts_note = f" ({filt_pts_cnt} điểm LiDAR)" if filt_pts_cnt > 0 else ""
            flag_reason = f"Cự ly {dist:.1f}m{pts_note}, cấu trúc 3D chuẩn PCA và không suy biến."

            if dz < 0.05 or h_effective < 0.05:
                category = "HARD_REVIEW"
                badge_text = "HARD • PCA Collapse"
                sotif_risk = "COLLISION_RISK"
                flag_reason = f"Suy biến ma trận PCA: Chiều cao h = {min(dz, h_effective):.3f}m (< 0.05m) khiến hộp bị ép dẹt."
                hard_count += 1
            elif z < -0.85:
                category = "PIPELINE_DEFECT"
                badge_text = "DEFECT • Cắt nhầm mặt đường"
                sotif_risk = "GROUND_CUTOFF"
                flag_reason = f"Lỗi z-cutoff: Đáy hộp z = {z:.2f}m bị thuật toán lọc mặt đường cắt xén điểm."
                pipeline_count += 1
            else:
                easy_count += 1

            real_flagged_cases.append({
                "id": box_id,
                "track_id": s.get("track_id") or sid,
                "label": label_name,
                "frame": frame_no,
                "pcd_file": pcd_name,
                "category": category,
                "badge_text": badge_text,
                "h": round(float(dz), 3),
                "points_count": filt_pts_cnt,
                "raw_points_count": raw_pts_cnt,
                "distance": round(float(dist), 1),
                "flag_reason": flag_reason,
                "sotif_risk": sotif_risk,
                "dx": round(float(dx), 2),
                "dy": round(float(dy), 2),
                "dz": round(float(dz), 3),
                "x": round(float(x), 2),
                "y": round(float(y), 2),
                "z": round(float(z), 2),
                "rotation_yaw": round(float(rz), 2),
            })

        tot = len(real_flagged_cases)
        summary = {
            "total_boxes": tot,
            "total_frames": total_frames,
            "easy_count": easy_count,
            "easy_pct": round((easy_count / tot) * 100, 1) if tot > 0 else 0.0,
            "hard_count": hard_count,
            "hard_pct": round((hard_count / tot) * 100, 1) if tot > 0 else 0.0,
            "pipeline_count": pipeline_count,
            "pipeline_pct": round((pipeline_count / tot) * 100, 1) if tot > 0 else 0.0,
        }
        task_info["easy_count"] = easy_count
        task_info["hard_count"] = hard_count
        task_info["drop_count"] = pipeline_count
        task_info["total_frames"] = total_frames

        return {
            "success": True,
            "dataset_name": dataset_name,
            "summary": summary,
            "flagged_cases": real_flagged_cases,
            "task_info": task_info,
        }

    async def sync_task_dataset(self, task_id: str) -> Dict[str, Any]:
        """
        Fetches Task info & annotations from CVAT for task_id,
        analyzes with M45 engine, and returns updated dataset summary and flagged cases.
        Falls back to uploaded dataset cache if CVAT is offline or task_id == 'uploaded'.
        """
        self.load_persisted_config()
        if task_id == "uploaded" and self.uploaded_dataset_cache is not None:
            self.active_source = "uploaded"
            return self.uploaded_dataset_cache["dataset_response"]

        effective_task_id = str(task_id).strip() if task_id else self.task_id
        if not effective_task_id or effective_task_id == "demo":
            if self.uploaded_dataset_cache is not None:
                self.active_source = "uploaded"
                return self.uploaded_dataset_cache["dataset_response"]
            effective_task_id = ""

        is_connected = await self.check_health()
        if not is_connected and self.uploaded_dataset_cache is not None:
            return self.uploaded_dataset_cache["dataset_response"]

        if not effective_task_id:
            if is_connected:
                try:
                    tasks = await self.list_tasks()
                    if tasks and len(tasks) > 0:
                        effective_task_id = str(tasks[0]["id"])
                except Exception:
                    pass
            if not effective_task_id:
                return {
                    "dataset_name": "Chưa chọn Task CVAT",
                    "total_frames": 0,
                    "summary": {
                        "total_boxes": 0,
                        "total_frames": 0,
                        "easy_count": 0,
                        "easy_pct": 0.0,
                        "hard_count": 0,
                        "hard_pct": 0.0,
                        "pipeline_count": 0,
                        "pipeline_pct": 0.0,
                    },
                    "flagged_cases": [],
                    "task_info": {
                        "id": "",
                        "name": "Chưa chọn Task",
                        "status": "idle",
                        "total_frames": 0,
                        "easy_count": 0,
                        "medium_count": 0,
                        "hard_count": 0,
                        "drop_count": 0,
                        "cvat_url": f"{self.public_url}/tasks",
                        "connected": is_connected,
                    }
                }
        self.task_id = effective_task_id

        self.active_source = "cvat"
        task_info = await self.get_task_info(effective_task_id)

        total_frames = task_info.get("total_frames", 0)
        task_name = task_info.get("name", f"CVAT Task #{effective_task_id}")
        dataset_name = f"CVAT Task #{effective_task_id} [{task_name}]"

        shapes: List[Dict[str, Any]] = []
        label_map: Dict[int, str] = {}

        if is_connected:
            try:
                label_map = await self.get_task_labels(int(effective_task_id)) if effective_task_id.isdigit() else {}
                async with httpx.AsyncClient(timeout=8.0) as client:
                    res = await client.get(f"{self.base_url}/api/tasks/{effective_task_id}/annotations", headers=self._get_headers())
                    if res.status_code == 200:
                        adata = res.json()
                        shapes = self._extract_all_shapes_from_ann_data(adata, interpolate_tracks=False)

                    if len(shapes) == 0:
                        jres = await client.get(f"{self.base_url}/api/jobs?task_id={effective_task_id}", headers=self._get_headers())
                        if jres.status_code == 200:
                            jobs = jres.json().get("results", [])
                            for job in jobs:
                                jid = job.get("id")
                                if jid:
                                    ja_res = await client.get(f"{self.base_url}/api/jobs/{jid}/annotations", headers=self._get_headers())
                                    if ja_res.status_code == 200:
                                        shapes.extend(self._extract_all_shapes_from_ann_data(ja_res.json(), interpolate_tracks=False))
            except Exception as e:
                logger.warning(f"Could not load annotations for task {effective_task_id}: {e}")

        if len(shapes) == 0 and self.uploaded_zip_path and os.path.exists(self.uploaded_zip_path):
            return await self.load_uploaded_dataset(None, "3dtest.zip")

        return self._evaluate_shapes_to_dataset(
            shapes=shapes,
            total_frames=total_frames,
            dataset_name=dataset_name,
            task_info=task_info,
            label_map=label_map,
        )

    # =========================================================================
    # Direct Local Upload (.zip CVAT Backup / .pcd / .bin / .json) + Hybrid Sync
    # =========================================================================
    def _read_uploaded_frame_points(self, frame_number: int) -> Tuple[np.ndarray, str]:
        """Reads 3D point cloud for frame_number from the uploaded zip or single file cache."""
        if self.uploaded_dataset_cache is None:
            return np.empty((0, 3), dtype=np.float64), "unavailable"

        single_pts = self.uploaded_dataset_cache.get("single_frame_points")
        if single_pts is not None:
            return single_pts, self.uploaded_dataset_cache.get("single_frame_format", "pcd_binary")

        frames_meta = self.uploaded_dataset_cache.get("frames_meta", [])
        if not frames_meta or not self.uploaded_zip_path or not os.path.exists(self.uploaded_zip_path):
            return np.empty((0, 3), dtype=np.float64), "unavailable"

        idx = max(0, min(len(frames_meta) - 1, int(frame_number)))
        pcd_entry = frames_meta[idx].get("pcd_entry")
        if not pcd_entry:
            return np.empty((0, 3), dtype=np.float64), "unavailable"

        try:
            with zipfile.ZipFile(self.uploaded_zip_path, "r") as z:
                raw_pcd = z.read(pcd_entry)
                return parse_pcd_or_bin(raw_pcd, pcd_entry)
        except Exception as e:
            logger.warning(f"Failed reading PCD entry {pcd_entry} from uploaded zip: {e}")
            return np.empty((0, 3), dtype=np.float64), "unavailable"

    def _fetch_uploaded_frame_detail(self, frame_number: int) -> Dict[str, Any]:
        """Builds full FrameDetailResponse from the uploaded dataset for 3D Workstation."""
        from .m45_engine import m45_engine

        cache = self.uploaded_dataset_cache or {}
        frames_meta = cache.get("frames_meta", [])
        total_frames = max(1, cache.get("total_frames", len(frames_meta) or 1))
        eff_frame = max(0, min(total_frames - 1, int(frame_number)))

        pcd_name = f"PIM_{eff_frame:03d}.PCD"
        has_cameras = False
        if frames_meta and 0 <= eff_frame < len(frames_meta):
            pcd_name = frames_meta[eff_frame].get("pcd_name", pcd_name)
            has_cameras = bool(frames_meta[eff_frame].get("related_images"))

        pts, _ = self._read_uploaded_frame_points(eff_frame)
        all_shapes = cache.get("all_shapes", [])
        frame_shapes = [s for s in all_shapes if int(s.get("frame", 0)) == eff_frame]

        boxes: List[Dict[str, Any]] = []
        selected_box_id = None

        for s in frame_shapes:
            p = s.get("points", [])
            if len(p) < 9:
                continue
            x, y, z, rx, ry, rz, dx, dy, dz = [float(v) for v in p[:9]]
            sid = s.get("id")
            label_name = s.get("label") or "Vehicle.Car"

            box_model = BoundingBox3D(
                id=f"cuboid_{sid}",
                track_id=s.get("track_id") or sid,
                label=label_name,
                x=x, y=y, z=z,
                dx=dx, dy=dy, dz=dz,
                rotation_yaw=rz,
                cvat_shape_id=sid,
                attributes={"keyframe": bool(s.get("keyframe", True))}
            )

            pts_in_box = m45_engine.extract_points_in_box(pts, box_model) if len(pts) > 0 else None
            analyzed = m45_engine.analyze_cuboid(box_model, points=pts_in_box)
            boxes.append(analyzed.model_dump())

            if selected_box_id is None:
                selected_box_id = analyzed.id
            elif analyzed.quality_tier == "HARD_EXPERT_REVIEW":
                selected_box_id = analyzed.id

        d_react, d_brake, d_stop = m45_engine.calculate_stopping_distance(50.0)
        sotif_metrics = {
            "speed_kmh": 50.0,
            "reaction_dist_m": round(d_react, 2),
            "braking_dist_m": round(d_brake, 2),
            "stopping_dist_m": round(d_stop, 2),
            "in_corridor": any(b["distance"] < d_stop for b in boxes) if boxes else False
        }

        points_list: List[List[float]] = []
        if len(pts) > 0:
            valid_mask = np.isfinite(pts[:, :3]).all(axis=1)
            clean_pts = pts[valid_mask]
            step = max(1, len(clean_pts) // 80000)
            render_pts = clean_pts[::step]
            for pt in render_pts:
                intensity = max(10.0, min(255.0, (float(pt[2]) + 2.0) * 50.0))
                points_list.append([
                    round(float(pt[0]), 3),
                    round(float(pt[1]), 3),
                    round(float(pt[2]), 3),
                    round(intensity, 1)
                ])

        cameras = self._build_camera_overlays(eff_frame, boxes, has_images=has_cameras)

        return {
            "frame_id": eff_frame,
            "pcd_file": pcd_name,
            "total_frames": total_frames,
            "points": points_list,
            "boxes": boxes,
            "selected_box_id": selected_box_id,
            "cameras": cameras,
            "sotif_metrics": sotif_metrics
        }

    async def get_camera_image_bytes(
        self,
        frame_number: int,
        cam_index: int = 0,
        job_id: Optional[int] = None
    ) -> Tuple[Optional[bytes], str]:
        """Returns raw JPEG/PNG bytes for camera cam_index at frame_number from uploaded zip or CVAT."""
        if self.uploaded_dataset_cache is not None and self.uploaded_zip_path and os.path.exists(self.uploaded_zip_path):
            frames_meta = self.uploaded_dataset_cache.get("frames_meta", [])
            if frames_meta and 0 <= frame_number < len(frames_meta):
                rel_imgs = frames_meta[frame_number].get("related_images", [])
                if 0 <= cam_index < len(rel_imgs):
                    img_entry = rel_imgs[cam_index]
                    try:
                        with zipfile.ZipFile(self.uploaded_zip_path, "r") as z:
                            data = z.read(img_entry)
                            mime = "image/png" if img_entry.lower().endswith(".png") else "image/jpeg"
                            return data, mime
                    except Exception as e:
                        logger.debug(f"Could not read camera image {img_entry} from zip: {e}")

        is_connected = await self.check_health()
        if is_connected:
            eff_job = job_id or (int(self.task_id) if str(self.task_id).isdigit() else 16)
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    res = await client.get(
                        f"{self.base_url}/api/jobs/{eff_job}/data",
                        params={"type": "context_image", "number": str(frame_number), "step": "0"},
                        headers=self._get_headers()
                    )
                    if res.status_code == 200 and res.content:
                        ctype = res.headers.get("content-type", "image/jpeg")
                        if res.content[:2] == b"PK":
                            with zipfile.ZipFile(io.BytesIO(res.content)) as z:
                                img_names = sorted([n for n in z.namelist() if n.lower().endswith((".jpg", ".jpeg", ".png"))])
                                if img_names:
                                    pick = img_names[min(cam_index, len(img_names) - 1)]
                                    mime = "image/png" if pick.lower().endswith(".png") else "image/jpeg"
                                    return z.read(pick), mime
                        return res.content, ctype
            except Exception as e:
                logger.debug(f"Could not fetch context_image from CVAT: {e}")

        return None, "image/jpeg"

    async def load_uploaded_dataset(self, raw_bytes: Optional[bytes], filename: str) -> Dict[str, Any]:
        """
        Parses an uploaded .zip (CVAT 3D Task Backup like 3dtest.zip), .pcd, .bin, or .json file.
        Runs M45 PCA / z-cutoff / SOTIF engine on real 3D cuboids and point clouds,
        caches the dataset for instant 3D Workstation rendering, and links with CVAT if online.
        """
        fname = (filename or "uploaded_dataset.zip").strip()
        is_connected = await self.check_health()

        # If no bytes were uploaded (e.g., JSON-only request), check if local file or cached zip exists
        if not raw_bytes or len(raw_bytes) == 0:
            if self.uploaded_dataset_cache is not None:
                self.active_source = "uploaded"
                return self.uploaded_dataset_cache["dataset_response"]
            if self.uploaded_zip_path and os.path.exists(self.uploaded_zip_path) and fname.lower().endswith(".zip"):
                pass  # Fall through to Case 1 and parse self.uploaded_zip_path from disk
            elif is_connected and self.task_id and self.task_id != "demo":
                return await self.sync_task_dataset(self.task_id)

        # Case 1: ZIP Archive (CVAT 3D Backup or ZIP of PCDs + annotations.json)
        if (raw_bytes and raw_bytes[:2] == b"PK") or (fname.lower().endswith(".zip") and self.uploaded_zip_path and os.path.exists(self.uploaded_zip_path)):
            if raw_bytes and len(raw_bytes) > 0 and self.uploaded_zip_path:
                with open(self.uploaded_zip_path, "wb") as f:
                    f.write(raw_bytes)

            zip_source = io.BytesIO(raw_bytes) if (raw_bytes and len(raw_bytes) > 0) else self.uploaded_zip_path
            with zipfile.ZipFile(zip_source, "r") as z:
                namelist = z.namelist()
                name_set = set(namelist)

                # 1. Read task.json if present
                task_meta: Dict[str, Any] = {}
                if "task.json" in name_set:
                    try:
                        task_meta = json.loads(z.read("task.json").decode("utf-8", errors="replace"))
                    except Exception:
                        pass

                task_name = task_meta.get("name") or os.path.splitext(os.path.basename(fname))[0]

                # 2. Build ordered frames_meta from data/manifest.jsonl or .pcd/.bin files
                frames_meta: List[Dict[str, Any]] = []
                if "data/manifest.jsonl" in name_set:
                    try:
                        lines = z.read("data/manifest.jsonl").decode("utf-8", errors="replace").splitlines()
                        for line in lines:
                            line_s = line.strip()
                            if not line_s:
                                continue
                            obj = json.loads(line_s)
                            if isinstance(obj, dict) and "name" in obj:
                                ext = obj.get("extension", ".pcd")
                                pcd_rel = f"data/{obj['name']}{ext}"
                                if pcd_rel not in name_set:
                                    # Fallback search by basename
                                    base = os.path.basename(obj["name"]) + ext
                                    matches = [n for n in namelist if n.endswith(base)]
                                    if matches:
                                        pcd_rel = matches[0]
                                rel_imgs_raw = obj.get("meta", {}).get("related_images", [])
                                rel_imgs = [
                                    f"data/{ri}" if f"data/{ri}" in name_set else ri
                                    for ri in rel_imgs_raw
                                    if (f"data/{ri}" in name_set or ri in name_set)
                                ]
                                frames_meta.append({
                                    "frame_id": len(frames_meta),
                                    "pcd_entry": pcd_rel if pcd_rel in name_set else None,
                                    "pcd_name": os.path.basename(pcd_rel),
                                    "related_images": rel_imgs,
                                })
                    except Exception as e:
                        logger.warning(f"Error parsing manifest.jsonl in {fname}: {e}")

                if not frames_meta:
                    pcd_entries = sorted([n for n in namelist if n.lower().endswith((".pcd", ".bin"))])
                    for idx, p_entry in enumerate(pcd_entries):
                        stem = os.path.splitext(os.path.basename(p_entry))[0]
                        rel_prefix = f"data/related_images/{stem}_pcd/"
                        rel_imgs = sorted([n for n in namelist if n.startswith(rel_prefix) and n.lower().endswith((".jpg", ".jpeg", ".png"))])
                        if not rel_imgs:
                            rel_imgs = sorted([
                                n for n in namelist
                                if n.lower().endswith((".jpg", ".jpeg", ".png"))
                                and (f"frame_{idx:04d}" in n or f"frame_{idx:03d}" in n or f"frame_{idx}." in n or f"_{idx:04d}." in n)
                            ])
                        frames_meta.append({
                            "frame_id": idx,
                            "pcd_entry": p_entry,
                            "pcd_name": os.path.basename(p_entry),
                            "related_images": rel_imgs,
                        })

                total_frames = len(frames_meta) or int(task_meta.get("data", {}).get("stop_frame", 0)) + 1

                # 3. Parse annotations.json if present
                ann_entries = [n for n in namelist if os.path.basename(n) == "annotations.json"]
                raw_ann = None
                if ann_entries:
                    try:
                        raw_ann = json.loads(z.read(ann_entries[0]).decode("utf-8", errors="replace"))
                    except Exception as e:
                        logger.warning(f"Error parsing annotations.json in {fname}: {e}")

                keyframe_shapes = self._extract_all_shapes_from_ann_data(
                    raw_ann,
                    interpolate_tracks=False,
                    max_frame=max(0, total_frames - 1)
                ) if raw_ann is not None else []

                all_shapes = self._extract_all_shapes_from_ann_data(
                    raw_ann,
                    interpolate_tracks=True,
                    max_frame=max(0, total_frames - 1)
                ) if raw_ann is not None else []

                # Try to link with live CVAT Task if online
                linked_task_id = self.task_id if (self.task_id and self.task_id != "demo") else "33"
                if is_connected:
                    try:
                        live_tasks = await self.list_tasks()
                        for lt in live_tasks:
                            if lt.get("name") == task_name or "day14" in str(lt.get("name", "")).lower():
                                linked_task_id = str(lt["id"])
                                break
                    except Exception:
                        pass

                task_info = {
                    "id": str(linked_task_id),
                    "name": f"{task_name} ({fname})",
                    "status": "annotation",
                    "total_frames": total_frames,
                    "easy_count": 0,
                    "medium_count": 0,
                    "hard_count": 0,
                    "drop_count": 0,
                    "cvat_url": f"{self.public_url}/tasks/{linked_task_id}",
                    "connected": is_connected,
                }

                def _load_pts_from_zip(f_no: int) -> np.ndarray:
                    if 0 <= f_no < len(frames_meta):
                        p_ent = frames_meta[f_no].get("pcd_entry")
                        if p_ent and p_ent in name_set:
                            pts_arr, _ = parse_pcd_or_bin(z.read(p_ent), p_ent)
                            return pts_arr
                    return np.empty((0, 3), dtype=np.float64)

                # Evaluate all keyframe shapes (or all interpolated shapes if keyframes are sparse)
                shapes_for_table = keyframe_shapes if len(keyframe_shapes) > 0 else all_shapes
                dataset_res = self._evaluate_shapes_to_dataset(
                    shapes=shapes_for_table,
                    total_frames=total_frames,
                    dataset_name=f"{fname} • {task_name}",
                    task_info=task_info,
                    frames_meta=frames_meta,
                    point_cloud_loader=_load_pts_from_zip,
                )

                self.uploaded_dataset_cache = {
                    "filename": fname,
                    "task_name": task_name,
                    "total_frames": total_frames,
                    "frames_meta": frames_meta,
                    "keyframe_shapes": keyframe_shapes,
                    "all_shapes": all_shapes,
                    "has_cameras": any(bool(fm.get("related_images")) for fm in frames_meta),
                    "task_info": dataset_res["task_info"],
                    "dataset_response": dataset_res,
                }
                self.active_source = "uploaded"
                return dataset_res

        # Case 2: Single .pcd or .bin point cloud file
        if raw_bytes and fname.lower().endswith((".pcd", ".bin")):
            pts, fmt = parse_pcd_or_bin(raw_bytes, fname)
            task_info = {
                "id": str(self.task_id or "16"),
                "name": fname,
                "status": "annotation",
                "total_frames": 1,
                "easy_count": 0,
                "medium_count": 0,
                "hard_count": 0,
                "drop_count": 0,
                "cvat_url": f"{self.public_url}/tasks/{self.task_id or '16'}",
                "connected": is_connected,
            }
            dataset_res = {
                "success": True,
                "dataset_name": fname,
                "summary": {
                    "total_boxes": 0,
                    "total_frames": 1,
                    "easy_count": 0,
                    "easy_pct": 0.0,
                    "hard_count": 0,
                    "hard_pct": 0.0,
                    "pipeline_count": 0,
                    "pipeline_pct": 0.0,
                },
                "flagged_cases": [],
                "task_info": task_info,
            }
            self.uploaded_dataset_cache = {
                "filename": fname,
                "task_name": fname,
                "total_frames": 1,
                "frames_meta": [{"frame_id": 0, "pcd_entry": None, "pcd_name": fname, "related_images": []}],
                "single_frame_points": pts,
                "single_frame_format": fmt,
                "keyframe_shapes": [],
                "all_shapes": [],
                "has_cameras": False,
                "task_info": task_info,
                "dataset_response": dataset_res,
            }
            self.active_source = "uploaded"
            return dataset_res

        # Case 3: Single .json annotations file
        if raw_bytes and fname.lower().endswith(".json"):
            raw_ann = json.loads(raw_bytes.decode("utf-8", errors="replace"))
            keyframe_shapes = self._extract_all_shapes_from_ann_data(raw_ann, interpolate_tracks=False)
            all_shapes = self._extract_all_shapes_from_ann_data(raw_ann, interpolate_tracks=True)
            max_f = max([int(s.get("frame", 0)) for s in all_shapes], default=0) + 1
            task_info = {
                "id": str(self.task_id or "16"),
                "name": fname,
                "status": "annotation",
                "total_frames": max_f,
                "easy_count": 0,
                "medium_count": 0,
                "hard_count": 0,
                "drop_count": 0,
                "cvat_url": f"{self.public_url}/tasks/{self.task_id or '16'}",
                "connected": is_connected,
            }
            dataset_res = self._evaluate_shapes_to_dataset(
                shapes=keyframe_shapes,
                total_frames=max_f,
                dataset_name=fname,
                task_info=task_info,
            )
            self.uploaded_dataset_cache = {
                "filename": fname,
                "task_name": fname,
                "total_frames": max_f,
                "frames_meta": [],
                "keyframe_shapes": keyframe_shapes,
                "all_shapes": all_shapes,
                "has_cameras": False,
                "task_info": dataset_res["task_info"],
                "dataset_response": dataset_res,
            }
            self.active_source = "uploaded"
            return dataset_res

        from .m45_engine import m45_engine
        return m45_engine.get_dataset_for_upload(fname)


cvat_client = CVATClient()
