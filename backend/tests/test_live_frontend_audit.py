"""
Automated Frontend & Full Stack Integration Verification for M45 ENGINE v2.8
Phase F & G Verification
"""
import unittest
import urllib.request
import urllib.error
import json
import socket
import re

FRONTEND_URL = "http://localhost:3000"
BACKEND_URL = "http://localhost:8088"
CVAT_LOCAL_URL = "http://localhost:8080"


def is_port_open(host: str, port: int, timeout=1.5) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except (socket.timeout, ConnectionRefusedError, OSError):
        return False


class TestFrontendAuditAndLiveIntegration(unittest.TestCase):

    def test_01_frontend_docker_service_serving_production_bundle(self):
        """Kiểm tra Frontend container (:3000) phản hồi HTTP 200 và phục vụ bundle đã tối ưu"""
        if not is_port_open("localhost", 3000):
            self.skipTest("Frontend container (:3000) không lắng nghe trên localhost")

        req = urllib.request.Request(FRONTEND_URL, headers={"User-Agent": "M45-Audit-Runner"})
        with urllib.request.urlopen(req, timeout=3.0) as resp:
            self.assertEqual(resp.status, 200)
            html = resp.read().decode("utf-8")
            self.assertIn("<!doctype html>", html.lower())
            self.assertIn("root", html)
            # Verify built assets are referenced
            self.assertRegex(html, r"/assets/index-[a-zA-Z0-9_\-]+\.js")

    def test_02_backend_health_and_api_contract(self):
        """Kiểm tra Backend container (:8088) /api/health trả về status=ok"""
        if not is_port_open("localhost", 8088):
            self.skipTest("Backend container (:8088) không lắng nghe trên localhost")

        req = urllib.request.Request(f"{BACKEND_URL}/api/health")
        with urllib.request.urlopen(req, timeout=3.0) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertEqual(data.get("status"), "ok")
            self.assertEqual(data.get("version"), "2.8.0")

    def test_03_cvat_ping_live_status(self):
        """Kiểm tra endpoint ping CVAT trả về kết nối trung thực với máy chủ localhost:8080"""
        if not is_port_open("localhost", 8088):
            self.skipTest("Backend container (:8088) không lắng nghe")

        payload = json.dumps({
            "cvat_url": "http://host.docker.internal:8080",
            "auth_method": "token",
            "token": "",
            "username": "auto_annotator",
            "task_id": "14"
        }).encode("utf-8")

        req = urllib.request.Request(
            f"{BACKEND_URL}/api/qc/cvat/ping",
            data=payload,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertIn("connected", data)
            self.assertIn("message", data)
            # Không được để lộ token hay mật khẩu trong response
            self.assertNotIn("3747db8b2c", str(data))

    def test_04_real_lidar_frame_data_contains_no_mock(self):
        """Kiểm tra Frame #0 từ Job 14 trả về point cloud thật (>1000 điểm) và không sinh điểm giả khi frame sai"""
        if not is_port_open("localhost", 8088):
            self.skipTest("Backend container (:8088) không lắng nghe")

        req = urllib.request.Request(f"{BACKEND_URL}/api/qc/frame/0?job_id=14&task_id=14")
        with urllib.request.urlopen(req, timeout=30.0) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode("utf-8"))
            self.assertEqual(data.get("frame_id"), 0)
            points = data.get("points", [])
            boxes = data.get("boxes", [])
            # Dữ liệu nuScenes LiDAR thật có > 30,000 điểm
            self.assertGreater(len(points), 1000, "Point cloud phải chứa điểm thật từ file PCD")
            self.assertIsInstance(boxes, list)

            # Kiểm tra Frame ngoài phạm vi (Frame 999) trả về mảng rỗng, KHÔNG tự chế điểm giả
            req_empty = urllib.request.Request(f"{BACKEND_URL}/api/qc/frame/999?job_id=14&task_id=14")
            with urllib.request.urlopen(req_empty, timeout=6.0) as resp_empty:
                self.assertEqual(resp_empty.status, 200)
                data_empty = json.loads(resp_empty.read().decode("utf-8"))
                self.assertEqual(len(data_empty.get("points", [])), 0)
                self.assertEqual(len(data_empty.get("boxes", [])), 0)

    def test_05_safe_sync_guards_strict_confirmation(self):
        """Kiểm tra Safe Sync: Cấm ghi nếu confirm_apply=False"""
        if not is_port_open("localhost", 8088):
            self.skipTest("Backend container (:8088) không lắng nghe")

        unconfirmed_payload = json.dumps({
            "job_id": 14,
            "task_id": 14,
            "confirm_apply": False,
            "approved_shape_ids": [101]
        }).encode("utf-8")

        req = urllib.request.Request(
            f"{BACKEND_URL}/api/qc/cvat/jobs/14/sync-apply",
            data=unconfirmed_payload,
            headers={"Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(req, timeout=4.0) as resp:
                self.fail("Safe Sync apply unconfirmed must return HTTP 400 Bad Request")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 400, "Phải từ chối với HTTP 400 nếu confirm_apply=False")


if __name__ == "__main__":
    unittest.main(verbosity=2)
