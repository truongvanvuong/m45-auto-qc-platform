"""
Hệ Thống Kiểm Thử Tích Hợp Toàn Diện (System Integration & Verification Suite) - Phase 5
Kiểm tra toàn bộ luồng hoạt động của FastAPI Router, Health Check, CORS,
Safe Sync Bước 1 & Bước 2, và cơ chế xử lý lỗi khi CVAT offline.
"""

import unittest
from fastapi.testclient import TestClient
from app.main import app

class TestSystemIntegration(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_01_health_check_endpoints(self):
        """Xác minh cả hai endpoint /health và /api/health phản hồi HTTP 200"""
        res1 = self.client.get("/health")
        self.assertEqual(res1.status_code, 200)
        self.assertEqual(res1.json().get("status"), "ok")
        self.assertEqual(res1.json().get("version"), "2.8.0")

        res2 = self.client.get("/api/health")
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(res2.json().get("status"), "ok")

    def test_02_root_endpoint_metadata(self):
        """Xác minh endpoint gốc / trả về metadata hệ thống M45 ENGINE v2.8"""
        res = self.client.get("/")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data.get("engine"), "M45 ENGINE v2.8")
        self.assertEqual(data.get("status"), "operational")

    def test_03_get_current_task_endpoint(self):
        """Xác minh GET /api/qc/task/current trả về thông tin task và phân loại ca"""
        res = self.client.get("/api/qc/task/current?task_id=33")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("id", data)
        self.assertIn("total_frames", data)
        self.assertIn("easy_count", data)
        self.assertIn("hard_count", data)

    def test_04_get_frame_detail_with_points_and_boxes(self):
        """Xác minh GET /api/qc/frame/{id} trả về dữ liệu thật từ Job 14 và không tạo dữ liệu giả cho frame sai"""
        # 1. Real frame 0 in Job 14
        res = self.client.get("/api/qc/frame/0?job_id=14")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data.get("frame_id"), 0)
        self.assertIn("points", data)
        self.assertIn("boxes", data)
        self.assertIn("cameras", data)
        self.assertIn("sotif_metrics", data)

        # 2. Non-existent frame 999 must return empty points/boxes, NOT fake points
        res_empty = self.client.get("/api/qc/frame/999?job_id=14")
        self.assertEqual(res_empty.status_code, 200)
        data_empty = res_empty.json()
        self.assertEqual(len(data_empty.get("points")), 0)
        self.assertEqual(len(data_empty.get("boxes")), 0)

    def test_05_stats_and_sotif_model(self):
        """Xác minh GET /api/qc/stats trả về phân loại Active Learning và mô hình SOTIF"""
        res = self.client.get("/api/qc/stats")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("buckets", data)
        self.assertIn("sotif_model", data)
        self.assertIn("roi", data)

    def test_06_flagged_cases_triage(self):
        """Xác minh GET /api/qc/flagged-cases trả về danh sách ca gán cờ chuẩn"""
        res = self.client.get("/api/qc/flagged-cases")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("summary", data)
        self.assertIn("flagged_cases", data)
        self.assertGreater(len(data.get("flagged_cases")), 0)

    def test_07_safe_sync_preview_read_only(self):
        """Xác minh POST /api/qc/cvat/jobs/12/sync-preview là CHỈ ĐỌC (không ghi)"""
        res = self.client.post("/api/qc/cvat/jobs/12/sync-preview")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data.get("job_id"), 12)
        self.assertTrue(data.get("requires_confirmation"))
        self.assertIn("proposals", data)

    def test_08_safe_sync_apply_unconfirmed_must_reject(self):
        """Xác minh POST /api/qc/cvat/jobs/12/sync-apply BẮT BUỘC từ chối nếu confirm_apply=False"""
        payload = {
            "job_id": 12,
            "confirm_apply": False,  # Chưa xác nhận
            "approved_shape_ids": [1881],
            "include_issue_creation": False
        }
        res = self.client.post("/api/qc/cvat/jobs/12/sync-apply", json=payload)
        self.assertEqual(res.status_code, 400)
        self.assertIn("SAFE_SYNC_REJECTED", res.json().get("detail", ""))

    def test_09_safe_sync_apply_confirmed_execution(self):
        """Xác minh POST /api/qc/cvat/jobs/12/sync-apply khi có confirm_apply=True"""
        payload = {
            "job_id": 12,
            "confirm_apply": True,  # Đã xác nhận rõ ràng
            "approved_shape_ids": [1881],
            "include_issue_creation": False
        }
        res = self.client.post("/api/qc/cvat/jobs/12/sync-apply", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("applied_count", data)
        self.assertIn("failed_count", data)

    def test_10_cvat_offline_ping_graceful_handling(self):
        """Xác minh POST /api/qc/cvat/ping với máy chủ offline trả về connected=False trung thực"""
        payload = {
            "cvat_url": "http://192.0.2.1:9999",  # IP thử nghiệm không tồn tại (RFC 5737 TEST-NET)
            "task_id": "999"
        }
        res = self.client.post("/api/qc/cvat/ping", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertFalse(data.get("connected"))
        self.assertIn("message", data)
        self.assertIn("Không thể kết nối", data.get("message", ""))

if __name__ == "__main__":
    unittest.main()
