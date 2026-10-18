import math
import unittest
import numpy as np
from app.services.m45_engine import M45Engine
from app.models.schemas import BoundingBox3D

class TestM45Engine(unittest.TestCase):
    def setUp(self):
        self.engine = M45Engine(
            z_cutoff=-1.0,
            height_collapse_threshold=0.05,
            zcut_defect_ratio=0.6,
            sotif_speed_kmh=50.0,
            sotif_reaction_s=0.8,
            sotif_decel_mps2=6.0
        )

    # -------------------------------------------------------------
    # 1. Point cloud tổng hợp có mặt phẳng rõ ràng (Planar Flat)
    # -------------------------------------------------------------
    def test_01_planar_flat_point_cloud_pca_collapse(self):
        """
        Tập điểm 3D nằm hoàn toàn trên mặt phẳng z = -0.8 (độ dày lý thuyết = 0).
        Kỳ vọng: Trị riêng nhỏ nhất lambda_3 ~ 0, h_span ~ 0 < 0.05m -> is_collapsed = True.
        """
        # Tạo lưới điểm 5x5 trên mặt phẳng ngang tại z = -0.8
        x_grid, y_grid = np.meshgrid(np.linspace(10, 14, 5), np.linspace(20, 24, 5))
        pts_planar = np.column_stack([x_grid.ravel(), y_grid.ravel(), np.full(25, -0.8)])

        res = self.engine.compute_pca_covariance(pts_planar)

        self.assertEqual(res["status"], "SUCCESS")
        self.assertEqual(res["points_count"], 25)
        # Trị riêng nhỏ nhất lambda_3 phải xấp xỉ 0 (sai số số học < 1e-12)
        self.assertAlmostEqual(res["lambda_3"], 0.0, delta=1e-10)
        # Chiều cao h_span đo dọc trục riêng thứ 3 phải < 0.05m
        self.assertLess(res["h_span"], 0.05)
        self.assertTrue(res["is_collapsed"])
        # Hệ số phẳng (planarity) phải rất cao (> 0.9)
        self.assertGreater(res["planarity"], 0.9)

    # -------------------------------------------------------------
    # 2. Point cloud có chiều cao và hình học hợp lệ (Valid 3D)
    # -------------------------------------------------------------
    def test_02_valid_3d_geometry_non_collapsed(self):
        """
        Tập điểm 3D của ô tô có kích thước chuẩn: dx=4.4m, dy=1.85m, dz=1.55m.
        Kỳ vọng: lambda_3 > 0, h_span ~ 1.55m >= 0.05m -> is_collapsed = False.
        """
        np.random.seed(42)
        # 100 điểm phân bố trong khối hộp [-2.2, 2.2] x [-0.92, 0.92] x [-0.775, 0.775]
        N = 100
        x = np.random.uniform(-2.2, 2.2, N)
        y = np.random.uniform(-0.92, 0.92, N)
        # Đảm bảo có điểm tại đáy và đỉnh để span chiều cao chính xác
        z = np.random.uniform(-0.775, 0.775, N)
        z[0] = -0.775
        z[1] = 0.775
        pts_3d = np.column_stack([x, y, z])

        res = self.engine.compute_pca_covariance(pts_3d)

        self.assertEqual(res["status"], "SUCCESS")
        self.assertEqual(res["points_count"], N)
        # lambda_3 tương ứng trục Z phải đáng kể (> 0.05)
        self.assertGreater(res["lambda_3"], 0.05)
        # h_span phải lớn hơn nhiều so với ngưỡng 0.05m
        self.assertGreater(res["h_span"], 1.0)
        self.assertFalse(res["is_collapsed"])

    # -------------------------------------------------------------
    # 3. Point cloud rỗng hoặc không đủ điểm (N < 3)
    # -------------------------------------------------------------
    def test_03_empty_and_insufficient_points(self):
        """
        Kiểm tra các trường hợp biên: None, rỗng (N=0), N=1, N=2.
        Kỳ vọng: Trả về trạng thái INSUFFICIENT_POINTS một cách an toàn, không crash.
        """
        # None
        res_none = self.engine.compute_pca_covariance(None)
        self.assertEqual(res_none["status"], "INSUFFICIENT_POINTS")
        self.assertEqual(res_none["points_count"], 0)
        self.assertTrue(res_none["is_collapsed"])

        # Mảng rỗng []
        res_empty = self.engine.compute_pca_covariance([])
        self.assertEqual(res_empty["status"], "INSUFFICIENT_POINTS")
        self.assertEqual(res_empty["points_count"], 0)

        # 1 điểm
        res_1pt = self.engine.compute_pca_covariance([[1.0, 2.0, 3.0]])
        self.assertEqual(res_1pt["status"], "INSUFFICIENT_POINTS")
        self.assertEqual(res_1pt["points_count"], 1)
        self.assertTrue(res_1pt["is_collapsed"])

        # 2 điểm (chỉ tạo được đoạn thẳng 1D, không tạo được ma trận 3D)
        res_2pts = self.engine.compute_pca_covariance([[1.0, 2.0, 3.0], [2.0, 3.0, 4.0]])
        self.assertEqual(res_2pts["status"], "INSUFFICIENT_POINTS")
        self.assertEqual(res_2pts["points_count"], 2)
        self.assertTrue(res_2pts["is_collapsed"])

    # -------------------------------------------------------------
    # 4. Dữ liệu chứa NaN/Inf hoặc sai định dạng
    # -------------------------------------------------------------
    def test_04_nan_inf_and_malformed_data(self):
        """
        Dữ liệu chứa NaN, Inf, hoặc shape không đúng chuẩn 3D.
        Kỳ vọng: Lọc bỏ dòng lỗi, xử lý điểm hợp lệ còn lại; nếu sai cấu trúc trả về INVALID_DATA an toàn.
        """
        # 10 điểm hợp lệ + 3 điểm bị nhiễm NaN và Inf
        valid_pts = np.array([
            [1.0, 1.0, 1.0], [1.5, 1.2, 1.1], [2.0, 1.8, 1.3],
            [1.2, 2.0, 1.2], [2.2, 2.2, 1.4], [1.8, 1.5, 1.0],
            [1.1, 1.9, 1.5], [2.1, 1.1, 1.2], [1.9, 2.1, 1.4], [1.4, 1.7, 1.1]
        ])
        corrupted_pts = np.vstack([
            valid_pts,
            [np.nan, 2.0, 1.0],
            [1.0, np.inf, 2.0],
            [-np.inf, 1.0, 0.0]
        ])

        res = self.engine.compute_pca_covariance(corrupted_pts)
        self.assertEqual(res["status"], "SUCCESS")
        # Phải lọc bỏ chính xác 3 điểm NaN/Inf, chỉ giữ lại 10 điểm hợp lệ
        self.assertEqual(res["points_count"], 10)

        # Dữ liệu 2D (shape thiếu cột Z)
        pts_2d = np.array([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]])
        res_malformed = self.engine.compute_pca_covariance(pts_2d)
        self.assertEqual(res_malformed["status"], "INVALID_DATA")

    # -------------------------------------------------------------
    # 5. Trường hợp biên ngay dưới, đúng tại và ngay trên ngưỡng 0.05m
    # -------------------------------------------------------------
    def test_05_threshold_boundary_cases(self):
        """
        Đặc tả MD45.md quy định suy biến khi: h < 0.05m.
        Kiểm tra 3 trường hợp biên:
        - 5A: h = 0.049m (< 0.05m) -> is_collapsed = True
        - 5B: h = 0.050m (== 0.05m) -> is_collapsed = False
        - 5C: h = 0.051m (> 0.05m) -> is_collapsed = False
        """
        # Mặt phẳng cơ sở 4 điểm góc XY
        base_xy = np.array([[-1.0, -1.0], [1.0, -1.0], [-1.0, 1.0], [1.0, 1.0]])

        # 5A: h = 0.049m
        pts_049 = np.vstack([
            np.column_stack([base_xy, np.full(4, -0.0245)]),
            np.column_stack([base_xy, np.full(4, +0.0245)])
        ])
        res_049 = self.engine.compute_pca_covariance(pts_049)
        self.assertAlmostEqual(res_049["h_span"], 0.049, delta=1e-4)
        self.assertTrue(res_049["is_collapsed"], "h = 0.049m < 0.05m phải được xác định là suy biến!")

        # 5B: h = 0.050m (Đúng tại ngưỡng)
        pts_050 = np.vstack([
            np.column_stack([base_xy, np.full(4, -0.0250)]),
            np.column_stack([base_xy, np.full(4, +0.0250)])
        ])
        res_050 = self.engine.compute_pca_covariance(pts_050)
        self.assertAlmostEqual(res_050["h_span"], 0.050, delta=1e-4)
        self.assertFalse(res_050["is_collapsed"], "h = 0.050m không nhỏ hơn 0.05m, không suy biến!")

        # 5C: h = 0.051m
        pts_051 = np.vstack([
            np.column_stack([base_xy, np.full(4, -0.0255)]),
            np.column_stack([base_xy, np.full(4, +0.0255)])
        ])
        res_051 = self.engine.compute_pca_covariance(pts_051)
        self.assertAlmostEqual(res_051["h_span"], 0.051, delta=1e-4)
        self.assertFalse(res_051["is_collapsed"], "h = 0.051m > 0.05m, không suy biến!")

    # -------------------------------------------------------------
    # 6. Kiểm tra z-cutoff và ranh giới phanh an toàn SOTIF
    # -------------------------------------------------------------
    def test_06_zcutoff_defect_evaluation(self):
        """
        Kiểm tra lỗi cắt nhầm điểm mặt đường z-cutoff:
        - Điều kiện 1: Tỷ lệ N_filtered / N_raw < 0.6
        - Điều kiện 2: Đáy hộp z_bottom = z - dz/2 <= z_cutoff + 0.3m (-1.0 + 0.3 = -0.7m)
        """
        # Ca 1: Bị cắt bánh xe (raw=50, filtered=15 -> ratio=0.3 < 0.6; z=-0.5, dz=1.6 -> z_bottom=-1.3 <= -0.7)
        is_defect, note = self.engine.evaluate_zcutoff_defect(
            raw_points_count=50, filtered_points_count=15, box_z=-0.5, box_dz=1.6
        )
        self.assertTrue(is_defect)
        self.assertIn("Lỗi z-cutoff", note)

        # Ca 2: Đủ điểm, không bị cắt (raw=50, filtered=45 -> ratio=0.9 >= 0.6)
        is_defect_good, _ = self.engine.evaluate_zcutoff_defect(
            raw_points_count=50, filtered_points_count=45, box_z=-0.5, box_dz=1.6
        )
        self.assertFalse(is_defect_good)

        # Ca 3: Hộp trên cao không tiếp xúc mặt đường (z=3.0, dz=1.0 -> z_bottom=2.5 > -0.7), mất điểm do che khuất
        is_defect_high, _ = self.engine.evaluate_zcutoff_defect(
            raw_points_count=50, filtered_points_count=10, box_z=3.0, box_dz=1.0
        )
        self.assertFalse(is_defect_high, "Hộp trên cao không thể gán lỗi cắt mặt đường z-cutoff!")

    def test_07_sotif_stopping_distance_and_risk(self):
        """
        Kiểm tra công thức động học phanh dừng xe:
        v = 50 km/h = 13.889 m/s
        d_react = 13.889 * 0.8 = 11.11m
        d_brake = 13.889^2 / (2 * 6.0) = 16.08m
        d_stop = 11.11 + 16.08 + 2.0 = 29.19m
        """
        d_react, d_brake, d_stop = self.engine.calculate_stopping_distance(50.0, a_brake=6.0, t_reaction=0.8, d_buffer=2.0)
        self.assertAlmostEqual(d_react, 11.11, delta=0.05)
        self.assertAlmostEqual(d_brake, 16.08, delta=0.05)
        self.assertAlmostEqual(d_stop, 29.19, delta=0.05)

        # Kiểm tra phân loại rủi ro:
        # Cự ly 20m (< 29.19m) kèm lỗi PCA_COLLAPSE -> CRITICAL_COLLISION
        risk_crit, _ = self.engine.evaluate_sotif_risk(distance=20.0, defect_type="PCA_COLLAPSE", filtered_pts=4)
        self.assertEqual(risk_crit, "CRITICAL_COLLISION")

        # Cự ly 35m (thuộc [29.19m, 44.19m)) -> WARNING
        risk_warn, _ = self.engine.evaluate_sotif_risk(distance=35.0, defect_type="PCA_COLLAPSE", filtered_pts=4)
        self.assertEqual(risk_warn, "WARNING")

        # Cự ly 54.8m (> 44.19m) -> SAFE
        risk_safe, _ = self.engine.evaluate_sotif_risk(distance=54.8, defect_type="PCA_COLLAPSE", filtered_pts=4)
        self.assertEqual(risk_safe, "SAFE")

    # -------------------------------------------------------------
    # 7. Kiểm tra tính cự ly D(r) và mật độ tia
    # -------------------------------------------------------------
    def test_08_distance_and_ray_density(self):
        """
        D(r) = sqrt(x^2 + y^2 + z^2)
        Với cuboid-881: x=38.2, y=39.4, z=-0.8 -> D(r) ~ 54.88m
        """
        dist = self.engine.calculate_distance(38.2, 39.4, -0.8)
        self.assertAlmostEqual(dist, 54.88, delta=0.05)

        # Mật độ tia tại 10m phải cao hơn gấp 4 lần tại 20m (tỷ lệ nghịch với r^2)
        rho_10 = self.engine.calculate_ray_density(10.0)
        rho_20 = self.engine.calculate_ray_density(20.0)
        self.assertAlmostEqual(rho_10 / rho_20, 4.0, delta=0.01)

    # -------------------------------------------------------------
    # 8. Kiểm thử tích hợp hàm analyze_cuboid với cuboid-881
    # -------------------------------------------------------------
    def test_09_analyze_cuboid_with_pca_points(self):
        """
        Kiểm tra hàm analyze_cuboid khi nạp đối tượng cuboid-881 kèm tập điểm phẳng thực tế.
        """
        box = BoundingBox3D(
            id="cuboid-881",
            track_id=881,
            label="Vehicle.Car",
            x=38.2,
            y=39.4,
            z=-0.8,
            dx=4.6,
            dy=1.9,
            dz=0.002,
            rotation_yaw=0.45
        )
        pts_c881 = np.array([
            [37.8, 39.1, -0.8],
            [38.5, 39.2, -0.8],
            [37.9, 39.7, -0.8],
            [38.4, 39.6, -0.8]
        ])

        analyzed_box = self.engine.analyze_cuboid(box, points=pts_c881)

        self.assertEqual(analyzed_box.defect_type, "PCA_COLLAPSE")
        self.assertEqual(analyzed_box.quality_tier, "HARD_EXPERT_REVIEW")
        self.assertIn("pca", analyzed_box.attributes)
        self.assertEqual(analyzed_box.attributes["pca"]["status"], "SUCCESS")
        self.assertLess(analyzed_box.attributes["pca_h_span"], 0.05)
        # Khẳng định box.dz không bị ghi đè, h_span được lưu riêng biệt
        self.assertEqual(analyzed_box.dz, 0.002)
        self.assertIn("h_span", analyzed_box.notes)

if __name__ == "__main__":
    unittest.main()
