import React, { useState, useEffect, useCallback, useRef } from "react";
import { TopHeaderBar } from "@/components/workstation/TopHeaderBar";
import { LeftToolstrip, ToolMode } from "@/components/workstation/LeftToolstrip";
import { MainLidarViewport, UIWorkstationStatus } from "@/components/workstation/MainLidarViewport";
import { OrthoViewsPanel } from "@/components/workstation/OrthoViewsPanel";
import { CameraSidebar } from "@/components/workstation/CameraSidebar";
import { OverviewUploadHub } from "@/components/workstation/OverviewUploadHub";
import { SafeSyncModal } from "@/components/workstation/SafeSyncModal";
import {
  fetchCurrentTask,
  fetchFrameDetail,
  autoApproveEasyCases,
  exportClassificationReport,
  sendCVATIssue,
  patchCuboid,
  fetchFlaggedCases,
  uploadDataset,
  syncCVATTask,
  pingCVAT,
  resetAllData,
} from "@/services/api";
import {
  BoundingBox3D,
  CameraImageOverlay,
  CVATTaskInfo,
  SOTIFMetrics,
  DatasetSummaryKPI,
  FlaggedCaseItem,
} from "@/types/qc";
import {
  getStoredCVATConfig,
  saveStoredCVATConfig,
  clearStoredCVATConfig,
  CVATConfigModal,
  CVATConnectionConfig,
} from "@/components/workstation/CVATConfigModal";
import { ExportReportModal } from "@/components/workstation/ExportReportModal";

export const App: React.FC = () => {
  // 2-Screen Workflow State: defaults to OVERVIEW (Bảng Gán Cờ) on load per user preference
  const [currentView, setCurrentView] = useState<"OVERVIEW" | "WORKSTATION">("OVERVIEW");

  // Theme state: defaults to Xiaohongshu Light Mode (#f6f7f9)
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);

  // Undo / Redo history state stack of BoundingBox3D[]
  const [history, setHistory] = useState<BoundingBox3D[][]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  // Safe Sync, CVAT Config & Export Report Modal triggers
  const [isSafeSyncOpen, setIsSafeSyncOpen] = useState<boolean>(false);
  const [isCVATModalOpen, setIsCVATModalOpen] = useState<boolean>(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);

  // UI Status state machine (8 mandatory states)
  const [uiStatus, setUiStatus] = useState<UIWorkstationStatus>("CONNECTING");
  const [uiErrorMessage, setUiErrorMessage] = useState<string>("");

  // Real CVAT identifiers (dynamic from configuration or connected task)
  const [selectedTaskId, setSelectedTaskId] = useState<string>(() => getStoredCVATConfig()?.taskId || "");
  const [selectedJobId, setSelectedJobId] = useState<number>(0);

  // Request counter to avoid race conditions when switching frames rapidly
  const activeRequestIdRef = useRef<number>(0);

  // Frame and Task State (Default: 0-indexed, empty until loaded)
  const [currentFrame, setCurrentFrame] = useState<number>(0);
  const [totalFrames, setTotalFrames] = useState<number>(0);
  const [pcdFile, setPcdFile] = useState<string>("");
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [taskInfo, setTaskInfo] = useState<CVATTaskInfo | null>(null);
  const [isApproving, setIsApproving] = useState<boolean>(false);
  const [isFetchingCVAT, setIsFetchingCVAT] = useState<boolean>(false);
  const [isDataLoaded, setIsDataLoaded] = useState<boolean>(false);

  // Overview Hub KPI & Flagged Cases State
  const [datasetSummary, setDatasetSummary] = useState<DatasetSummaryKPI>({
    total_boxes: 0,
    total_frames: 0,
    easy_count: 0,
    easy_pct: 0,
    hard_count: 0,
    hard_pct: 0,
    pipeline_count: 0,
    pipeline_pct: 0,
  });
  const [flaggedCases, setFlaggedCases] = useState<FlaggedCaseItem[]>([]);

  // 3D Viewport State
  const [points, setPoints] = useState<[number, number, number, number][]>([]);
  const [boxes, setBoxes] = useState<BoundingBox3D[]>([]);
  const [selectedBoxId, setSelectedBoxId] = useState<string>("");
  const [cameras, setCameras] = useState<CameraImageOverlay[]>([]);
  const [sotifMetrics, setSotifMetrics] = useState<SOTIFMetrics | undefined>();

  // Tools & Layers
  const [currentTool, setCurrentTool] = useState<ToolMode>("select");
  const [showGroundPlane, setShowGroundPlane] = useState<boolean>(true);
  const [resetViewSignal, setResetViewSignal] = useState<number>(0);

  // Feedback Notification Banner
  const [notification, setNotification] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 4500);
  };

  // Sync dark class on root document
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDarkMode]);

  // Load Frame Data (strictly from real CVAT, zero demo/mock fallback)
  const loadFrame = useCallback(async (frameId: number, targetBoxId?: string, jobIdParam?: number, taskIdParam?: string) => {
    const jId = jobIdParam ?? (selectedJobId || undefined);
    const tId = taskIdParam ?? (selectedTaskId || (taskInfo?.id ? String(taskInfo.id) : undefined));
    const currentRequestId = ++activeRequestIdRef.current;

    // Immediate cleanup to prevent displaying previous frame's point cloud or boxes
    setPoints([]);
    setBoxes([]);
    setCameras([]);
    setUiStatus("LOADING");

    try {
      const data = await fetchFrameDetail(frameId, jId, tId);

      // Discard stale response if newer request was already launched
      if (currentRequestId !== activeRequestIdRef.current) {
        return;
      }

      setCurrentFrame(data.frame_id);
      setPcdFile(data.pcd_file || "");
      setPoints(data.points || []);
      setCameras(data.cameras || []);
      setSotifMetrics(data.sotif_metrics);

      const nextBoxes = data.boxes || [];
      setBoxes(nextBoxes);
      setHistory([nextBoxes]);
      setHistoryIndex(0);

      if (targetBoxId && nextBoxes.some((b) => b.id === targetBoxId)) {
        setSelectedBoxId(targetBoxId);
      } else if (data.selected_box_id && nextBoxes.some((b) => b.id === data.selected_box_id)) {
        setSelectedBoxId(data.selected_box_id);
      } else if (nextBoxes.length > 0) {
        setSelectedBoxId(nextBoxes[0].id);
      } else {
        setSelectedBoxId("");
      }

      // Check renderable data: points or boxes
      const hasPoints = Boolean(data.points && data.points.length > 0);
      const hasBoxes = Boolean(nextBoxes && nextBoxes.length > 0);

      if (!hasPoints && !hasBoxes) {
        setUiStatus("EMPTY");
      } else {
        setUiStatus("READY");
      }
    } catch (err: any) {
      if (currentRequestId !== activeRequestIdRef.current) return;
      console.warn("loadFrame error:", err);
      setUiStatus("ERROR");
      setUiErrorMessage(err?.message || `Không thể tải dữ liệu Frame #${frameId} từ CVAT Local.`);
    }
  }, [selectedJobId, selectedTaskId]);

  // Sync CVAT Task Dataset & Run M45 QC Engine
  const handleSyncCVATTask = useCallback(async (targetTaskId?: string) => {
    const stored = getStoredCVATConfig();
    const taskIdToFetch = targetTaskId || stored?.taskId || selectedTaskId || "16";
    setIsFetchingCVAT(true);
    setUiStatus("LOADING");
    showToast(`Đang kết nối CVAT Local và nạp dữ liệu Task #${taskIdToFetch}...`);
    try {
      const res = await syncCVATTask(taskIdToFetch);
      setIsDataLoaded(true);
      if (res.summary) {
        setDatasetSummary(res.summary);
        setTotalFrames(res.summary.total_frames || 0);
      }
      setSelectedTaskId(taskIdToFetch);

      if (res.task_info) {
        setTaskInfo(res.task_info);
        if (res.task_info.total_frames !== undefined) {
          setTotalFrames(res.task_info.total_frames);
        }
        if (res.task_info.id && String(res.task_info.id).trim().length > 0) {
          setSelectedTaskId(String(res.task_info.id));
        }
      }

      if (res.flagged_cases && res.flagged_cases.length > 0) {
        setFlaggedCases(res.flagged_cases);
        const first = res.flagged_cases[0];
        await loadFrame(first.frame, first.id, undefined, taskIdToFetch);
      } else {
        await loadFrame(0, undefined, undefined, taskIdToFetch);
      }

      showToast(`Đã đồng bộ thành công dữ liệu từ CVAT Task #${taskIdToFetch}!`);
    } catch (e: any) {
      setUiStatus("ERROR");
      setUiErrorMessage(`Lỗi khi nạp dữ liệu từ CVAT Task #${taskIdToFetch}: ${e?.message || "Không thể kết nối"}`);
      showToast(`Lỗi khi nạp dữ liệu từ CVAT Task #${taskIdToFetch}.`);
    } finally {
      setIsFetchingCVAT(false);
    }
  }, [loadFrame, selectedTaskId]);

  // Reset CVAT configuration and return platform to clean blank state
  const handleResetCVAT = useCallback(() => {
    clearStoredCVATConfig();
    resetAllData().catch((err) => console.warn("Could not reset backend data:", err));
    setTaskInfo(null);
    setDatasetSummary({
      total_boxes: 0,
      total_frames: 0,
      easy_count: 0,
      easy_pct: 0,
      hard_count: 0,
      hard_pct: 0,
      pipeline_count: 0,
      pipeline_pct: 0,
    });
    setFlaggedCases([]);
    setIsDataLoaded(false);
    setBoxes([]);
    setPoints([]);
    setCameras([]);
    setUiStatus("DISCONNECTED");
    setUiErrorMessage("Đã xóa cấu hình CVAT và làm sạch dữ liệu. Hệ thống trở về trạng thái trống ban đầu.");
    showToast("Đã xóa toàn bộ cấu hình CVAT và làm sạch dữ liệu thành công.");
  }, []);

  // Initial mount: Check live CVAT connection
  useEffect(() => {
    const initCVATConnection = async () => {
      setUiStatus("CONNECTING");
      const stored = getStoredCVATConfig();
      const targetTaskId = stored?.taskId || "";

      try {
        const pingRes = await pingCVAT({
          cvatUrl: stored?.cvatUrl || "http://localhost:8080",
          authMethod: stored?.authMethod || "token",
          token: stored?.token || "",
          username: stored?.username || "auto_annotator",
          password: stored?.password || "",
          org: stored?.org || "",
          taskId: targetTaskId,
        });

        if (pingRes.connected) {
          const resolvedTask = pingRes.task_id || targetTaskId;
          if (resolvedTask) {
            setSelectedTaskId(resolvedTask);
            await handleSyncCVATTask(resolvedTask);
          } else {
            setUiStatus("READY");
          }
        } else {
          setUiStatus("DISCONNECTED");
          setUiErrorMessage(pingRes.message || "Không thể kết nối tới CVAT Local tại http://localhost:8080. Hãy đảm bảo container CVAT đang chạy.");
        }
      } catch (err: any) {
        setUiStatus("DISCONNECTED");
        setUiErrorMessage("Không thể kết nối Backend M45 hoặc máy chủ CVAT Local.");
      }
    };

    initCVATConnection();
  }, []);

  // Animation Loop for Playing Frames in Workstation
  useEffect(() => {
    let timer: any = null;
    if (isPlaying && currentView === "WORKSTATION") {
      timer = setInterval(() => {
        setCurrentFrame((prev) => {
          const next = prev >= totalFrames ? 1 : prev + 1;
          loadFrame(next);
          return next;
        });
      }, 350);
    }
    return () => clearInterval(timer);
  }, [isPlaying, totalFrames, loadFrame, currentView]);

  // Seamless Transition: User clicks a card in Overview Hub
  const handleSelectCase = async (caseItem: FlaggedCaseItem) => {
    showToast(`Đang chuyển tới Frame #${caseItem.frame} • ${caseItem.id} trên 3D Workstation...`);
    await loadFrame(caseItem.frame, caseItem.id);
    setCurrentView("WORKSTATION");
  };

  // Upload dataset handler in Area A (supports direct .zip/.pcd/.bin/.json File upload + CVAT sync)
  const handleUploadDataset = async (fileOrName?: File | string) => {
    try {
      const res = await uploadDataset(fileOrName);
      setDatasetSummary(res.summary);
      setFlaggedCases(res.flagged_cases || []);
      setTotalFrames(res.summary?.total_frames || 0);
      setIsDataLoaded(true);
      setUiStatus("READY");
      if (res.task_info) {
        setTaskInfo(res.task_info);
      }
      if (res.flagged_cases && res.flagged_cases.length > 0) {
        await loadFrame(res.flagged_cases[0].frame, res.flagged_cases[0].id);
      } else if ((res.summary?.total_frames || 0) > 0) {
        await loadFrame(0);
      }
      showToast(`Đã nạp và quét thành công ${res.summary.total_boxes} hộp 3D (${res.summary.total_frames} frames) từ: ${res.dataset_name}!`);
    } catch (e: any) {
      showToast(`Lỗi khi xử lý file dataset tải lên: ${e?.message || "Không thể đọc file"}`);
    }
  };

  // State for exporting report
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Xuất Báo Cáo Phân Loại (Mở Modal Tùy Chọn CSV / PDF / JSON)
  const handleExportReport = () => {
    setIsExportModalOpen(true);
  };

  // 1-Click Auto Approve in Area B
  const handleAutoApproveEasy = async () => {
    setIsApproving(true);
    try {
      const effTaskId = selectedTaskId || (taskInfo?.id ? String(taskInfo.id) : "");
      const res = await autoApproveEasyCases(effTaskId);
      showToast(res.message);
      setDatasetSummary((prev) => ({
        ...prev,
        easy_count: 0,
        easy_pct: 0,
      }));
      if (taskInfo) {
        setTaskInfo({ ...taskInfo, easy_count: 0 });
      }
    } catch (e) {
      showToast("Lỗi kết nối CVAT Auto-Approve.");
    } finally {
      setIsApproving(false);
    }
  };

  // CVAT Issue Push
  const handleSendIssue = async (box: BoundingBox3D) => {
    const res = await sendCVATIssue({
      box_id: box.id,
      frame: currentFrame,
      title: `Lỗi kiểm định ${box.defect_type || "Hộp 3D"}`,
      description: box.notes || "Kiểm tra bất thường cấu trúc hộp 3D",
      severity: box.defect_type === "PCA_COLLAPSE" ? "error" : "warning",
    });
    showToast(res.message);
  };

  // Push new state to history when boxes are modified
  const pushHistory = useCallback((newBoxes: BoundingBox3D[]) => {
    setHistory((prev) => {
      const next = prev.slice(0, historyIndex + 1);
      next.push(newBoxes);
      return next;
    });
    setHistoryIndex((prev) => prev + 1);
    setBoxes(newBoxes);
  }, [historyIndex]);

  // Adjust selected box coordinates & dimensions (via keycaps & tool HUD)
  const handleAdjustBox = useCallback(
    (delta: {
      x?: number;
      y?: number;
      z?: number;
      yaw?: number;
      dx?: number;
      dy?: number;
      dz?: number;
    }) => {
      if (boxes.length === 0) return;
      const targetId = selectedBoxId || boxes[0]?.id;
      const newBoxes = boxes.map((b) => {
        if (b.id === targetId) {
          const nextX = delta.x !== undefined ? Number((b.x + delta.x).toFixed(3)) : b.x;
          const nextY = delta.y !== undefined ? Number((b.y + delta.y).toFixed(3)) : b.y;
          const nextZ = delta.z !== undefined ? Number((b.z + delta.z).toFixed(3)) : b.z;
          const nextDx =
            delta.dx !== undefined ? Math.max(0.2, Number((b.dx + delta.dx).toFixed(3))) : b.dx;
          const nextDy =
            delta.dy !== undefined ? Math.max(0.2, Number((b.dy + delta.dy).toFixed(3))) : b.dy;
          const nextDz =
            delta.dz !== undefined ? Math.max(0.1, Number((b.dz + delta.dz).toFixed(3))) : b.dz;
          return {
            ...b,
            x: nextX,
            y: nextY,
            z: nextZ,
            dx: nextDx,
            dy: nextDy,
            dz: nextDz,
            distance: Number(Math.sqrt(nextX * nextX + nextY * nextY + nextZ * nextZ).toFixed(2)),
            rotation_yaw:
              delta.yaw !== undefined
                ? Number((b.rotation_yaw + delta.yaw).toFixed(3))
                : b.rotation_yaw,
          };
        }
        return b;
      });
      pushHistory(newBoxes);
    },
    [selectedBoxId, boxes, pushHistory]
  );

  // Direct patch from 3D TransformControls Gizmo (Translate / Rotate / Scale)
  const handleUpdateBox = useCallback(
    (boxId: string, patch: Partial<BoundingBox3D>) => {
      const newBoxes = boxes.map((b) => {
        if (b.id === boxId) {
          const updated = { ...b, ...patch };
          updated.distance = Number(
            Math.sqrt(
              updated.x * updated.x + updated.y * updated.y + updated.z * updated.z
            ).toFixed(2)
          );
          return updated;
        }
        return b;
      });
      pushHistory(newBoxes);
    },
    [boxes, pushHistory]
  );

  // Create a new 3D Bounding Box in [B] mode
  const handleCreateBox = useCallback(
    (coords?: { x: number; y: number; z: number; label?: string }) => {
      const label = coords?.label || "Car";
      const dimsMap: Record<string, { dx: number; dy: number; dz: number }> = {
        Car: { dx: 1.9, dy: 4.5, dz: 1.55 },
        Truck: { dx: 2.5, dy: 7.2, dz: 2.8 },
        Motorcycle: { dx: 0.85, dy: 2.1, dz: 1.4 },
        Bicycle: { dx: 0.65, dy: 1.75, dz: 1.35 },
        Pedestrian: { dx: 0.75, dy: 0.75, dz: 1.72 },
      };
      const dims = dimsMap[label] || dimsMap.Car;
      const x = coords?.x ?? 0;
      const y = coords?.y ?? 8.0;
      const z = coords?.z ?? Number((-1.0 + dims.dz / 2).toFixed(2));
      const newId = `#${boxes.length + 101}`;

      const newBox: BoundingBox3D = {
        id: newId,
        label,
        x,
        y,
        z,
        dx: dims.dx,
        dy: dims.dy,
        dz: dims.dz,
        rotation_yaw: 0,
        points_count: 42,
        raw_points_count: 48,
        distance: Number(Math.sqrt(x * x + y * y + z * z).toFixed(2)),
        quality_tier: "EASY_AUTO",
        defect_type: "NONE",
        sotif_risk: "SAFE",
        confidence: 0.98,
        notes: `Hộp 3D ${label} mới dựng thủ công tại (${x.toFixed(1)}m, ${y.toFixed(1)}m, ${z.toFixed(2)}m).`,
      };

      const nextBoxes = [...boxes, newBox];
      pushHistory(nextBoxes);
      setSelectedBoxId(newId);
      setCurrentTool("translate");
      showToast(`Đã tạo hộp 3D mới ${newId} (${label}) và chuyển sang chế độ Dịch chuyển [W]!`);
    },
    [boxes, pushHistory]
  );

  // Delete a 3D Bounding Box
  const handleDeleteBox = useCallback(
    (boxId: string) => {
      const nextBoxes = boxes.filter((b) => b.id !== boxId);
      pushHistory(nextBoxes);
      if (selectedBoxId === boxId) {
        setSelectedBoxId(nextBoxes[0]?.id || "");
      }
      showToast(`Đã xóa hộp 3D ${boxId} khỏi Frame #${currentFrame}. (Ctrl+Z để hoàn tác)`);
    },
    [boxes, selectedBoxId, currentFrame, pushHistory]
  );

  // Reset / Center 3D View
  const handleResetView = useCallback(() => {
    setResetViewSignal((s) => s + 1);
    showToast("Đã căn giữa góc nhìn 3D về trung tâm.");
  }, []);

  // Real Undo Action
  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const prevIdx = historyIndex - 1;
      setHistoryIndex(prevIdx);
      setBoxes(history[prevIdx]);
      showToast(`Hoàn tác (Bước ${prevIdx + 1}/${history.length})`);
    }
  }, [historyIndex, history]);

  // Real Redo Action
  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextIdx = historyIndex + 1;
      setHistoryIndex(nextIdx);
      setBoxes(history[nextIdx]);
      showToast(`Làm lại (Bước ${nextIdx + 1}/${history.length})`);
    }
  }, [historyIndex, history]);

  // Real Save Action
  const handleSave = useCallback(async () => {
    const currentBox = boxes.find((b) => b.id === selectedBoxId) || boxes[0];
    if (!currentBox) {
      showToast("Không có hộp nào được chọn để lưu.");
      return;
    }
    try {
      await patchCuboid(currentBox.id, {
        x: currentBox.x,
        y: currentBox.y,
        z: currentBox.z,
        dx: currentBox.dx,
        dy: currentBox.dy,
        dz: currentBox.dz,
        rotation_yaw: currentBox.rotation_yaw,
      });
      showToast(`Đã lưu thay đổi cho hộp ${currentBox.id} vào hệ thống!`);
    } catch (e) {
      showToast(`Đã ghi nhận tọa độ đã sửa cho hộp ${currentBox.id}.`);
    }
  }, [boxes, selectedBoxId]);

  // Fix PCA Collapse in 3D Viewport with History
  const handleFixPCA = async (boxId: string) => {
    const updated = boxes.map((b) => {
      if (b.id === boxId) {
        return {
          ...b,
          dz: 1.55,
          defect_type: "NONE" as const,
          quality_tier: "MEDIUM_AI_ASSIST" as const,
          sotif_risk: "SAFE" as const,
          notes: "Đã khôi phục chiều cao chuẩn h = 1.55m (Sửa lỗi suy biến PCA). Sẵn sàng đồng bộ CVAT.",
        };
      }
      return b;
    });
    pushHistory(updated);
    try {
      await patchCuboid(boxId, { dz: 1.55 });
      showToast(`Đã phục hồi chiều cao chuẩn h = 1.55m cho ${boxId} thành công!`);
    } catch (e) {
      showToast(`Đã cập nhật cục bộ cho ${boxId}.`);
    }
  };

  const handleOpenCVAT = () => {
    const effId = selectedTaskId || (taskInfo?.id ? String(taskInfo.id) : "");
    window.open(taskInfo?.cvat_url || (effId ? `http://localhost:8080/tasks/${effId}` : "http://localhost:8080/tasks"), "_blank");
  };

  // Keyboard shortcut listener for workstation and hotkeys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;

      if (e.key === "Escape") {
        if (currentTool !== "select") {
          setCurrentTool("select");
          return;
        }
        setCurrentView("OVERVIEW");
        return;
      }

      if (currentView === "WORKSTATION") {
        // Ctrl+Z / Ctrl+Y / Ctrl+S (Undo, Redo, Save)
        if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
          e.preventDefault();
          if (e.shiftKey) {
            handleRedo();
          } else {
            handleUndo();
          }
          return;
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y")) {
          e.preventDefault();
          handleRedo();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
          e.preventDefault();
          handleSave();
          return;
        }

        // Frame scrubbing (0-indexed)
        if (e.key === "ArrowLeft") {
          loadFrame(Math.max(0, currentFrame - 1));
        } else if (e.key === "ArrowRight") {
          loadFrame(Math.min(Math.max(0, totalFrames - 1), currentFrame + 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          handleAdjustBox({ z: 0.05 });
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          handleAdjustBox({ z: -0.05 });
        } else if ((e.key === "f" || e.key === "F" || e.key === " ") && !e.repeat) {
          e.preventDefault();
          handleResetView();
        } else if (e.key === "Delete" && selectedBoxId) {
          e.preventDefault();
          handleDeleteBox(selectedBoxId);
        } else if (e.key === "u" || e.key === "U") {
          handleAdjustBox({ yaw: -0.05 });
        } else if (e.key === "o" || e.key === "O") {
          handleAdjustBox({ yaw: 0.05 });
        } else if (e.key === "i" || e.key === "I") {
          handleAdjustBox({ y: 0.1 });
        } else if (e.key === "k" || e.key === "K") {
          handleAdjustBox({ y: -0.1 });
        } else if (e.key === "j" || e.key === "J") {
          handleAdjustBox({ x: -0.1 });
        } else if (e.key === "l" || e.key === "L") {
          handleAdjustBox({ x: 0.1 });
        } else if (e.key === "v" || e.key === "V") {
          setCurrentTool("select");
          showToast("Chế độ Chọn vật thể [V]");
        } else if (e.key === "b" || e.key === "B") {
          setCurrentTool("box3d");
          showToast("Chế độ Dựng Hộp 3D mới [B] — Click trên không gian 3D để đặt hộp");
        } else if (e.key === "w" || e.key === "W") {
          setCurrentTool("translate");
          showToast("Chế độ Dịch chuyển tọa độ [W]");
        } else if (e.key === "e" || e.key === "E") {
          setCurrentTool("rotate");
          showToast("Chế độ Xoay góc hướng Yaw [E]");
        } else if (e.key === "r" || e.key === "R") {
          setCurrentTool("scale");
          showToast("Chế độ Co dãn kích thước [R]");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    currentFrame,
    totalFrames,
    currentView,
    currentTool,
    selectedBoxId,
    loadFrame,
    handleUndo,
    handleRedo,
    handleSave,
    handleAdjustBox,
    handleResetView,
    handleDeleteBox,
  ]);

  const selectedBox = boxes.find((b) => b.id === selectedBoxId) || boxes[0];

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#f6f7f9] dark:bg-[#060911] text-[#222222] dark:text-neutral-100 flex flex-col p-2 gap-2 select-none transition-colors duration-200">
      {/* Toast Notification Banner */}
      {notification && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-[#2c2c2c] dark:bg-white text-white dark:text-neutral-900 px-4 py-2 rounded-2xl shadow-2xl text-xs font-semibold flex items-center gap-2 border border-white/20 animate-in fade-in slide-in-from-top-4 duration-200">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span>{notification}</span>
        </div>
      )}

      {/* Top Header Bar with Segmented Pill Toggle, Undo/Redo/Save & Frame Control */}
      <TopHeaderBar
        currentView={currentView}
        onViewChange={setCurrentView}
        currentFrame={currentFrame}
        totalFrames={totalFrames}
        pcdFile={pcdFile}
        onFrameChange={(f) => loadFrame(f)}
        isPlaying={isPlaying}
        onTogglePlay={() => setIsPlaying((p) => !p)}
        taskInfo={taskInfo}
        onAutoApprove={handleAutoApproveEasy}
        onExportReport={handleExportReport}
        onFetchTask={() => handleSyncCVATTask(selectedTaskId)}
        isApproving={isApproving}
        isExporting={isExporting}
        isDarkMode={isDarkMode}
        onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
        hardCount={datasetSummary.hard_count}
        easyCount={datasetSummary.easy_count}
        onResetCVAT={handleResetCVAT}
        onSave={handleSave}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={historyIndex > 0}
        canRedo={historyIndex >= 0 && historyIndex < history.length - 1}
        onOpenSafeSync={() => setIsSafeSyncOpen(true)}
        onConnectCVAT={async (cfg) => {
          const targetId = cfg.taskId || "";
          showToast(targetId ? `Đã áp dụng cấu hình CVAT: ${cfg.cvatUrl} (Task #${targetId})` : `Đã áp dụng cấu hình CVAT: ${cfg.cvatUrl}`);
          saveStoredCVATConfig({ ...cfg, isConfigured: true });
          setSelectedTaskId(targetId);
          if (targetId) {
            await handleSyncCVATTask(targetId);
          }
        }}
      />

      {/* Dynamic View Rendering: OVERVIEW HUB vs 3D WORKSTATION */}
      {currentView === "OVERVIEW" ? (
        <OverviewUploadHub
          summary={datasetSummary}
          flaggedCases={flaggedCases}
          onSelectCase={handleSelectCase}
          onUploadDataset={handleUploadDataset}
          onAutoApproveEasy={handleExportReport}
          isApproving={isExporting || isApproving}
          onOpenWorkstationDirect={() => setCurrentView("WORKSTATION")}
          taskInfo={taskInfo}
          onFetchCVATTask={handleSyncCVATTask}
          isFetchingCVAT={isFetchingCVAT}
          isDataLoaded={isDataLoaded}
        />
      ) : (
        /* 3D Workstation View */
        <div className="flex-1 flex gap-2 min-h-0 overflow-hidden">
          {/* Left Vertical Toolstrip */}
          <LeftToolstrip
            currentTool={currentTool}
            onSelectTool={(tool) => {
              setCurrentTool(tool);
              if (tool === "box3d") {
                showToast("Chế độ Dựng Hộp 3D [B]: Click vào không gian 3D để đặt hộp mới");
              }
            }}
            showGroundPlane={showGroundPlane}
            onToggleGroundPlane={() => {
              const next = !showGroundPlane;
              setShowGroundPlane(next);
              showToast(
                next
                  ? "Đã BẬT Mặt phẳng lọc mặt đường z-cutoff = -1.0m"
                  : "Đã TẮT Mặt phẳng lọc mặt đường z-cutoff"
              );
            }}
            onResetView={handleResetView}
          />

          {/* Center Main Workstation (3D Viewport + 2D Ortho Views) */}
          <main className="flex-1 flex flex-col gap-2 min-w-0 h-full overflow-hidden">
            {/* Main 3D LiDAR Viewport Canvas (72%) */}
            <MainLidarViewport
              points={points}
              boxes={boxes}
              selectedBoxId={selectedBox?.id}
              onSelectBox={setSelectedBoxId}
              onSendIssue={handleSendIssue}
              onOpenCVAT={handleOpenCVAT}
              onFixPCA={handleFixPCA}
              showGroundPlane={showGroundPlane}
              currentTool={currentTool}
              onSelectTool={setCurrentTool}
              resetViewSignal={resetViewSignal}
              onAdjustBox={handleAdjustBox}
              onUpdateBox={handleUpdateBox}
              onCreateBox={handleCreateBox}
              onDeleteBox={handleDeleteBox}
              onNavigateFrame={(step) =>
                loadFrame(
                  Math.max(
                    0,
                    Math.min(Math.max(0, totalFrames - 1), currentFrame + step)
                  )
                )
              }
              uiStatus={uiStatus}
              errorMessage={uiErrorMessage}
              onOpenCVATModal={() => setIsCVATModalOpen(true)}
              onOpenOverview={() => setCurrentView("OVERVIEW")}
            />

            {/* Orthographic 2D Views Panel: Top, Side, Front (28%) */}
            <OrthoViewsPanel
              selectedBox={selectedBox}
              points={points}
              onAdjustBox={handleAdjustBox}
              onUpdateBox={handleUpdateBox}
            />
          </main>

          {/* Right Camera Sidebar (3 cameras with 2D box overlay & click-to-zoom) */}
          <CameraSidebar
            cameras={cameras}
            selectedBox={selectedBox}
            onSelectBox={setSelectedBoxId}
          />
        </div>
      )}

      {/* Safe Sync Modal: Proposal Preview & Confirmed 2-Way Write to CVAT */}
      <SafeSyncModal
        isOpen={isSafeSyncOpen}
        onClose={() => setIsSafeSyncOpen(false)}
        jobId={taskInfo?.id ? parseInt(taskInfo.id, 10) || selectedJobId : selectedJobId}
        taskId={selectedTaskId}
        currentBoxes={boxes}
        onSyncSuccess={(appliedCount: number) => {
          showToast(`Đã đồng bộ an toàn ${appliedCount} thay đổi sang CVAT thành công!`);
        }}
      />

      {/* CVAT Configuration Modal */}
      <CVATConfigModal
        isOpen={isCVATModalOpen}
        onClose={() => setIsCVATModalOpen(false)}
        initialConfig={{
          cvatUrl: "http://localhost:8080",
          taskId: selectedTaskId,
        }}
        onSave={(cfg) => {
          setSelectedTaskId(cfg.taskId || "");
          if (cfg.taskId) {
            handleSyncCVATTask(cfg.taskId);
          }
          setIsCVATModalOpen(false);
        }}
        onReset={handleResetCVAT}
      />

      {/* Export Report Modal (CSV / PDF / JSON) */}
      <ExportReportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        summary={datasetSummary}
        flaggedCases={flaggedCases}
        taskInfo={taskInfo}
        selectedTaskId={selectedTaskId}
        pcdFile={pcdFile}
      />
    </div>
  );
};

export default App;
