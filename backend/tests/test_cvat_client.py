import unittest
import numpy as np
from unittest.mock import AsyncMock, patch, MagicMock
import httpx

from app.services.cvat_client import CVATClient, mask_token, parse_pcd_or_bin
from app.models.schemas import BoundingBox3D

class TestCVATClient(unittest.IsolatedAsyncioTestCase):
    """
    Unit tests for CVAT REST Client v2 and Safe Sync mechanism.
    All live CVAT HTTP calls are mocked with deterministic responses.
    """
    def setUp(self):
        self.client = CVATClient()
        self.client.base_url = "http://localhost:8080"
        self.client.token = "test_token_123456789"
        self.client.force_demo = False

    # -------------------------------------------------------------------------
    # 1. Token Masking Security
    # -------------------------------------------------------------------------
    def test_01_token_masking_security(self):
        """Xác nhận token được che giấu an toàn, không hiển thị raw trong log/payload."""
        self.assertEqual(mask_token(""), "")
        self.assertEqual(mask_token("12345"), "***")
        self.assertEqual(mask_token("abcdefghij123456"), "abc...456")
        self.assertNotIn("cdefghij123", mask_token("abcdefghij123456"))

    # -------------------------------------------------------------------------
    # 2. Point Cloud Parser (ASCII PCD, Binary PCD, KITTI .bin)
    # -------------------------------------------------------------------------
    def test_02_parse_pcd_ascii_binary_and_kitti_bin(self):
        """Xác nhận parser đọc được các định dạng point cloud chuẩn."""
        # 2A: ASCII PCD
        ascii_pcd = (
            "# .PCD v0.7 - Point Cloud Data file format\n"
            "VERSION 0.7\n"
            "FIELDS x y z\n"
            "SIZE 4 4 4\n"
            "TYPE F F F\n"
            "COUNT 1 1 1\n"
            "WIDTH 3\n"
            "HEIGHT 1\n"
            "POINTS 3\n"
            "DATA ascii\n"
            "1.0 2.0 3.0\n"
            "4.0 5.0 6.0\n"
            "7.0 8.0 9.0\n"
        ).encode("ascii")
        pts_ascii, fmt_ascii = parse_pcd_or_bin(ascii_pcd)
        self.assertEqual(fmt_ascii, "pcd_ascii")
        self.assertEqual(pts_ascii.shape, (3, 3))
        self.assertAlmostEqual(pts_ascii[0, 0], 1.0)
        self.assertAlmostEqual(pts_ascii[2, 2], 9.0)

        # 2B: Binary PCD (4 points x 3 floats x 4 bytes = 48 bytes)
        raw_coords = np.array([
            [0.5, 1.5, 2.5],
            [3.5, 4.5, 5.5],
            [6.5, 7.5, 8.5],
            [9.5, 10.5, 11.5]
        ], dtype=np.float32)
        binary_pcd_header = (
            "# .PCD v0.7\n"
            "VERSION 0.7\n"
            "FIELDS x y z\n"
            "SIZE 4 4 4\n"
            "TYPE F F F\n"
            "COUNT 1 1 1\n"
            "WIDTH 4\n"
            "HEIGHT 1\n"
            "POINTS 4\n"
            "DATA binary\n"
        ).encode("ascii")
        binary_pcd = binary_pcd_header + raw_coords.tobytes()
        pts_bin_pcd, fmt_bin_pcd = parse_pcd_or_bin(binary_pcd)
        self.assertEqual(fmt_bin_pcd, "pcd_binary")
        self.assertEqual(pts_bin_pcd.shape, (4, 3))
        self.assertAlmostEqual(pts_bin_pcd[0, 0], 0.5)

        # 2C: KITTI .bin format (4 floats: x, y, z, intensity)
        kitti_data = np.array([
            [10.0, 20.0, -1.0, 0.5],
            [11.0, 21.0, -0.9, 0.6]
        ], dtype=np.float32).tobytes()
        pts_kitti, fmt_kitti = parse_pcd_or_bin(kitti_data)
        self.assertEqual(fmt_kitti, "bin_kitti")
        self.assertEqual(pts_kitti.shape, (2, 3))
        self.assertAlmostEqual(pts_kitti[0, 0], 10.0)

        # 2D: Dữ liệu rỗng / hỏng
        pts_empty, fmt_empty = parse_pcd_or_bin(b"")
        self.assertEqual(pts_empty.shape, (0, 3))
        self.assertEqual(fmt_empty, "empty")

    # -------------------------------------------------------------------------
    # 3. List Projects, Tasks, Jobs
    # -------------------------------------------------------------------------
    async def test_03_list_projects_tasks_jobs_mocked(self):
        """Kiểm tra gọi API GET /api/projects, /api/tasks, /api/jobs với mock response."""
        with patch.object(self.client, "check_health", return_value=True):
            # Mock projects
            mock_proj_res = MagicMock()
            mock_proj_res.status_code = 200
            mock_proj_res.json.return_value = {
                "results": [
                    {"id": 101, "name": "Autonomous 3D LiDAR", "owner": {"username": "lead_annotator"}, "tasks": {"count": 5}}
                ]
            }

            # Mock tasks
            mock_task_res = MagicMock()
            mock_task_res.status_code = 200
            mock_task_res.json.return_value = {
                "results": [
                    {"id": 12, "name": "nuScenes-v1.0-mini", "project_id": 101, "size": 240, "dimension": "3d"}
                ]
            }

            # Mock jobs
            mock_job_res = MagicMock()
            mock_job_res.status_code = 200
            mock_job_res.json.return_value = {
                "results": [
                    {"id": 55, "task_id": 12, "stage": "annotation", "state": "in progress", "start_frame": 0, "stop_frame": 239}
                ]
            }

            async def mock_get(client_self, url, *args, **kwargs):
                if "/api/projects" in url:
                    return mock_proj_res
                elif "/api/tasks" in url:
                    return mock_task_res
                elif "/api/jobs" in url:
                    return mock_job_res
                return MagicMock(status_code=404)

            with patch.object(httpx.AsyncClient, "get", new=mock_get):
                projects = await self.client.list_projects()
                self.assertEqual(len(projects), 1)
                self.assertEqual(projects[0]["id"], 101)
                self.assertEqual(projects[0]["name"], "Autonomous 3D LiDAR")

                tasks = await self.client.list_tasks(project_id=101)
                self.assertEqual(len(tasks), 1)
                self.assertEqual(tasks[0]["id"], 12)
                self.assertEqual(tasks[0]["dimension"], "3d")

                jobs = await self.client.list_jobs(task_id=12)
                self.assertEqual(len(jobs), 1)
                self.assertEqual(jobs[0]["id"], 55)
                self.assertEqual(jobs[0]["stop_frame"], 239)

    # -------------------------------------------------------------------------
    # 4. Check Frame Data Access & Error Handling
    # -------------------------------------------------------------------------
    async def test_04_check_frame_data_access_and_error(self):
        """Xác nhận kiểm tra quyền truy cập point cloud, context images và xử lý lỗi 403."""
        with patch.object(self.client, "check_health", return_value=True):
            # Ca 1: Lỗi 403 Forbidden khi truy cập meta
            mock_403_res = MagicMock(status_code=403, text="Forbidden")
            with patch.object(httpx.AsyncClient, "get", return_value=mock_403_res):
                status_403 = await self.client.check_frame_data_access(job_id=99, frame_number=0)
                self.assertFalse(status_403["can_access_pcd"])
                self.assertIn("403", str(status_403["error"]))

            # Ca 2: Thành công với point cloud PCD
            mock_meta = MagicMock(status_code=200)
            mock_meta.json.return_value = {"size": 240, "chunk_size": 1}
            mock_cam = MagicMock(status_code=200)
            
            ascii_pcd = (
                "# .PCD v0.7\nVERSION 0.7\nFIELDS x y z\nSIZE 4 4 4\nTYPE F F F\n"
                "COUNT 1 1 1\nWIDTH 2\nHEIGHT 1\nPOINTS 2\nDATA ascii\n"
                "1.0 2.0 3.0\n4.0 5.0 6.0\n"
            ).encode("ascii")
            mock_pcd = MagicMock(status_code=200, content=ascii_pcd, headers={"content-type": "application/octet-stream"})

            async def mock_get_success(client_self, url, *args, **kwargs):
                if "/data/meta" in url:
                    return mock_meta
                elif "context_image" in str(kwargs.get("params", {})):
                    return mock_cam
                elif "type" in str(kwargs.get("params", {})):
                    return mock_pcd
                return MagicMock(status_code=404)

            with patch.object(httpx.AsyncClient, "get", new=mock_get_success):
                status_ok = await self.client.check_frame_data_access(job_id=55, frame_number=10)
                self.assertTrue(status_ok["can_access_pcd"])
                self.assertTrue(status_ok["can_access_cameras"])
                self.assertEqual(status_ok["point_cloud_format"], "pcd_ascii")
                self.assertEqual(status_ok["points_count"], 2)

    # -------------------------------------------------------------------------
    # 5. Safe Sync Step 1: Preview Generation (Read-Only)
    # -------------------------------------------------------------------------
    async def test_05_safe_sync_preview_generation_read_only(self):
        """Xác nhận bước Preview chỉ đọc: tạo đề xuất sửa dz khi PCA collapse, KHÔNG ghi lên CVAT."""
        with patch.object(self.client, "check_health", return_value=True):
            # Mock annotations: 1 hộp bình thường (dz=1.55) và 1 hộp PCA collapse (dz=0.002)
            mock_ann = {
                "shapes": [
                    {
                        "id": 1001,
                        "frame": 10,
                        "label_id": 1,
                        "type": "cuboid",
                        "points": [10.0, 15.0, -0.5, 0.0, 0.0, 0.2, 4.5, 1.9, 1.55] # Normal
                    },
                    {
                        "id": 1002,
                        "frame": 10,
                        "label_id": 1,
                        "type": "cuboid",
                        "points": [38.2, 39.4, -0.8, 0.0, 0.0, 0.45, 4.6, 1.9, 0.002] # PCA collapse (<0.05m)
                    }
                ]
            }
            with patch.object(self.client, "get_job_annotations", return_value=mock_ann), \
                 patch.object(self.client, "get_task_labels", return_value={1: "Vehicle.Car"}), \
                 patch.object(self.client, "fetch_frame_point_cloud", return_value=(np.empty((0, 3)), "none")):

                preview = await self.client.generate_sync_proposal(job_id=55, task_id=12)

                self.assertTrue(preview["requires_confirmation"])
                self.assertEqual(preview["total_shapes"], 2)
                self.assertEqual(preview["modified_count"], 1)
                self.assertEqual(preview["unmodified_count"], 1)

                proposals = preview["proposals"]
                # Hộp 1001: KEEP
                p1001 = next(p for p in proposals if p["shape_id"] == 1001)
                self.assertEqual(p1001["action"], "KEEP")

                # Hộp 1002: MODIFY_DIMENSIONS
                p1002 = next(p for p in proposals if p["shape_id"] == 1002)
                self.assertEqual(p1002["action"], "MODIFY_DIMENSIONS")
                self.assertEqual(p1002["m45_defect_type"], "PCA_COLLAPSE")
                self.assertEqual(p1002["original_values"]["dz"], 0.002)
                self.assertEqual(p1002["proposed_values"]["dz"], 1.55)
                self.assertEqual(p1002["proposed_points"][8], 1.55)

    # -------------------------------------------------------------------------
    # 6. Safe Sync Step 2: Rejection When Unconfirmed
    # -------------------------------------------------------------------------
    async def test_06_safe_sync_apply_rejection_when_unconfirmed(self):
        """BẮT BUỘC: Từ chối ghi dữ liệu nếu confirm_apply=False."""
        sample_proposals = [
            {
                "shape_id": 1002,
                "action": "MODIFY_DIMENSIONS",
                "proposed_points": [38.2, 39.4, -0.8, 0.0, 0.0, 0.45, 4.6, 1.9, 1.55]
            }
        ]

        # Gọi apply với confirm_apply=False
        result = await self.client.apply_sync_changes(
            job_id=55,
            approved_shape_ids=[1002],
            proposals=sample_proposals,
            confirm_apply=False
        )

        self.assertFalse(result["success"])
        self.assertEqual(result["applied_count"], 0)
        self.assertIn("SAFE_SYNC_REJECTED", result["errors"][0])

    # -------------------------------------------------------------------------
    # 7. Safe Sync Step 2: Confirmed Apply With Valid Schema
    # -------------------------------------------------------------------------
    async def test_07_safe_sync_apply_confirmed_success(self):
        """Xác nhận khi confirm_apply=True và CVAT phản hồi 200/204 thì ghi thành công."""
        sample_proposals = [
            {
                "shape_id": 1002,
                "action": "MODIFY_DIMENSIONS",
                "proposed_points": [38.2, 39.4, -0.8, 0.0, 0.0, 0.45, 4.6, 1.9, 1.55]
            }
        ]

        with patch.object(self.client, "check_health", return_value=True):
            mock_patch_res = MagicMock(status_code=200)

            sent_payload = {}
            async def mock_patch(client_self, url, *args, **kwargs):
                nonlocal sent_payload
                sent_payload = kwargs.get("json", {})
                return mock_patch_res

            with patch.object(httpx.AsyncClient, "patch", new=mock_patch):
                result = await self.client.apply_sync_changes(
                    job_id=55,
                    approved_shape_ids=[1002],
                    proposals=sample_proposals,
                    confirm_apply=True
                )

                self.assertTrue(result["success"])
                self.assertEqual(result["applied_count"], 1)
                self.assertEqual(result["failed_count"], 0)
                # Kiểm tra cấu trúc payload gửi lên CVAT
                self.assertIn("shapes", sent_payload)
                self.assertEqual(sent_payload["shapes"][0]["id"], 1002)
                self.assertEqual(sent_payload["shapes"][0]["points"][8], 1.55)

    # -------------------------------------------------------------------------
    # 8. Safe Sync Error Handling (CVAT returns HTTP 500)
    # -------------------------------------------------------------------------
    async def test_08_safe_sync_apply_cvat_error_handling(self):
        """Xác nhận khi CVAT gặp lỗi HTTP 500, hệ thống báo lỗi rõ ràng, KHÔNG tự báo thành công."""
        sample_proposals = [
            {
                "shape_id": 1002,
                "action": "MODIFY_DIMENSIONS",
                "proposed_points": [38.2, 39.4, -0.8, 0.0, 0.0, 0.45, 4.6, 1.9, 1.55]
            }
        ]

        with patch.object(self.client, "check_health", return_value=True):
            mock_500_res = MagicMock(status_code=500, text="Internal Server Error: Database Lock")
            with patch.object(httpx.AsyncClient, "patch", return_value=mock_500_res):
                result = await self.client.apply_sync_changes(
                    job_id=55,
                    approved_shape_ids=[1002],
                    proposals=sample_proposals,
                    confirm_apply=True
                )

                self.assertFalse(result["success"])
                self.assertEqual(result["applied_count"], 0)
                self.assertEqual(result["failed_count"], 1)
                self.assertIn("HTTP 500", result["errors"][0])

    # -------------------------------------------------------------------------
    # 9. Issue Creation with Verified CVAT Schema
    # -------------------------------------------------------------------------
    async def test_09_create_issue_real_schema_and_failure(self):
        """Xác nhận tạo Issue gửi đúng cấu trúc schema CVAT và xử lý lỗi trung thực."""
        with patch.object(self.client, "check_health", return_value=True):
            # 9A: Thành công HTTP 201
            mock_201_res = MagicMock(status_code=201)
            mock_201_res.json.return_value = {"id": 9901, "job": 55, "frame": 108}

            sent_body = {}
            async def mock_post_issue(client_self, url, *args, **kwargs):
                nonlocal sent_body
                sent_body = kwargs.get("json", {})
                return mock_201_res

            with patch.object(httpx.AsyncClient, "post", new=mock_post_issue):
                res_ok = await self.client.create_issue(
                    job_id=55,
                    frame=108,
                    position=[150.0, 200.0],
                    title="PCA Collapse",
                    description="Hộp xe bị ép dẹt dz=0.002m",
                    severity="error"
                )
                self.assertTrue(res_ok["success"])
                self.assertEqual(res_ok["issue_id"], 9901)
                self.assertEqual(sent_body["job"], 55)
                self.assertEqual(sent_body["frame"], 108)
                self.assertEqual(sent_body["position"], [150.0, 200.0])

            # 9B: Thất bại HTTP 403 Forbidden
            mock_403_res = MagicMock(status_code=403, text="User does not have permission to create issues.")
            with patch.object(httpx.AsyncClient, "post", return_value=mock_403_res):
                res_fail = await self.client.create_issue(
                    job_id=55,
                    frame=108,
                    position=[0.0, 0.0],
                    title="Z-Cutoff",
                    description="Bị xén mặt đường",
                    severity="error"
                )
                self.assertFalse(res_fail["success"])
                self.assertIsNone(res_fail["issue_id"])
                self.assertEqual(res_fail["status"], "FAILED")
                self.assertIn("403", res_fail["message"])


if __name__ == "__main__":
    unittest.main()
