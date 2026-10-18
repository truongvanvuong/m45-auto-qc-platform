import React, { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  UploadCloud,
  FileCheck2,
  AlertTriangle,
  Layers,
  Sparkles,
  ArrowRight,
  Search,
  CheckCircle2,
  AlertOctagon,
  Boxes,
  Eye,
  Database,
  Cpu,
  RefreshCw,
  FileText
} from "lucide-react";
import {
  FlaggedCaseItem,
  DatasetSummaryKPI,
  FlaggedCategory,
  CVATTaskInfo
} from "@/types/qc";

interface OverviewUploadHubProps {
  summary: DatasetSummaryKPI;
  flaggedCases: FlaggedCaseItem[];
  onSelectCase: (caseItem: FlaggedCaseItem) => void;
  onUploadDataset: (fileOrName?: File | string) => Promise<void>;
  onAutoApproveEasy: () => Promise<void>;
  isApproving: boolean;
  onOpenWorkstationDirect: () => void;
  taskInfo?: CVATTaskInfo | null;
  onFetchCVATTask?: (taskId?: string) => Promise<void>;
  isFetchingCVAT?: boolean;
  isDataLoaded?: boolean;
}

export const OverviewUploadHub: React.FC<OverviewUploadHubProps> = ({
  summary,
  flaggedCases,
  onSelectCase,
  onUploadDataset,
  onAutoApproveEasy,
  isApproving,
  onOpenWorkstationDirect,
  taskInfo,
  onFetchCVATTask,
  isFetchingCVAT = false,
  isDataLoaded = false,
}) => {
  // Filter and search state (default to ALL so both Easy & Hard cases are visible immediately)
  const [selectedFilter, setSelectedFilter] = useState<FlaggedCategory>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Upload scanning progress state
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanProgress, setScanProgress] = useState<number>(0);
  const [uploadedFileName, setUploadedFileName] = useState<string>("");

  // Handle file drop / input
  const handleFileDrop = (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      triggerScan(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      triggerScan(e.target.files[0]);
      e.target.value = "";
    }
  };

  const triggerScan = async (fileOrName?: File | string) => {
    if (!fileOrName) return;
    const fname = typeof fileOrName === "string" ? fileOrName : fileOrName.name;
    setUploadedFileName(fname);
    setIsScanning(true);
    setScanProgress(45);
    try {
      await onUploadDataset(fileOrName);
      setScanProgress(100);
    } finally {
      setIsScanning(false);
      setScanProgress(0);
    }
  };

  // Filtered cases list
  const filteredList = useMemo(() => {
    return flaggedCases.filter((item) => {
      // Category filter
      if (selectedFilter !== "ALL" && item.category !== selectedFilter) {
        return false;
      }
      // Query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesId = item.id.toLowerCase().includes(q);
        const matchesFrame = item.frame.toString().includes(q) || item.pcd_file.toLowerCase().includes(q);
        const matchesLabel = item.label.toLowerCase().includes(q);
        const matchesReason = item.flag_reason.toLowerCase().includes(q);
        return matchesId || matchesFrame || matchesLabel || matchesReason;
      }
      return true;
    });
  }, [flaggedCases, selectedFilter, searchQuery]);

  return (
    <div className="flex-1 w-full h-full overflow-y-auto px-4 py-2 flex flex-col gap-4 select-none">
      {/* Top Row: Khu Vực A (Upload Zone) + Khu Vực B (KPI Summary) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Khu vực A: Upload Dữ liệu 3D & Kết nối CVAT (5 Cột) */}
        <Card className="lg:col-span-5 bg-white dark:bg-[#0d131f] rounded-2xl border border-neutral-200/80 dark:border-neutral-800 p-5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-800 dark:text-neutral-200">
                  <UploadCloud className="h-4 w-4 stroke-[2.2]" />
                </div>
                <div>
                  <h2 className="text-xs font-bold text-neutral-900 dark:text-white uppercase tracking-wider font-mono">
                    Khu Vực A • Upload Dữ Liệu 3D
                  </h2>
                  <p className="text-[11px] text-neutral-500">
                    Hỗ trợ file .pcd, .bin, .ply hoặc JSON annotations
                  </p>
                </div>
              </div>
              <Badge
                variant={taskInfo?.connected ? "secondary" : "monochrome"}
                className={`text-[10px] font-mono flex items-center gap-1.5 ${
                  taskInfo?.connected
                    ? "bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800"
                    : "text-neutral-500 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    taskInfo?.connected ? "bg-emerald-500 animate-pulse" : "bg-neutral-400"
                  }`}
                />
                <span>
                  {taskInfo?.connected
                    ? `CVAT :8080 • Task #${taskInfo.id}`
                    : (taskInfo?.id ? `CVAT :8080 • Task #${taskInfo.id} (Chờ kết nối)` : "CVAT Local :8080 (Chưa cấu hình)")}
                </span>
              </Badge>
            </div>

            {/* Drag & Drop Zone */}
            <label
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFileDrop}
              className="border-2 border-dashed border-neutral-300 dark:border-neutral-700 hover:border-neutral-800 dark:hover:border-neutral-400 rounded-2xl p-5 text-center transition cursor-pointer flex flex-col items-center justify-center gap-2 bg-neutral-50/50 dark:bg-neutral-900/40 group block"
            >
              <input
                type="file"
                accept=".pcd,.bin,.ply,.json,.zip"
                className="hidden"
                onChange={handleFileInput}
              />
              <div className="w-10 h-10 rounded-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center text-neutral-700 dark:text-neutral-300 group-hover:scale-105 transition-transform shadow-sm">
                <UploadCloud className="h-5 w-5 stroke-[2]" />
              </div>
              <div className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                Kéo thả file 3D hoặc <span className="underline underline-offset-2 text-neutral-900 dark:text-white">duyệt từ máy tính</span>
              </div>
              <p className="text-[10px] text-neutral-400">
                Tự động chạy qua M45 PCA Engine & kiểm định hình học mặt đường z-cutoff
              </p>
            </label>
            {taskInfo?.id && (
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                <span className="text-[10px] text-neutral-400 font-medium">CVAT Task hiện tại:</span>
                <button
                  type="button"
                  onClick={() => onFetchCVATTask?.(taskInfo.id)}
                  className="text-[10px] px-2.5 py-1 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/40 border border-neutral-200/60 dark:border-neutral-700 transition cursor-pointer font-medium"
                >
                  🎯 Task #{taskInfo.id} {taskInfo.name ? `(${taskInfo.name})` : ""}
                </button>
              </div>
            )}
          </div>

          {/* Scanning Progress Bar or Quick Sample Button */}
          <div className="mt-4 pt-3 border-t border-neutral-100 dark:border-neutral-800 flex flex-col gap-2">
            {isScanning ? (
              <div className="flex flex-col gap-1.5 bg-neutral-50 dark:bg-neutral-900/60 p-3 rounded-xl border border-neutral-200/70 dark:border-neutral-800">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-medium text-neutral-700 dark:text-neutral-300 flex items-center gap-1.5">
                    <Cpu className="h-3.5 w-3.5 text-neutral-600 dark:text-neutral-400 animate-spin" />
                    Đang nạp point cloud PCD và phân tích NumPy PCA...
                  </span>
                  <span className="font-mono font-bold text-neutral-900 dark:text-white">{scanProgress}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
                  <div
                    className="h-full bg-[#2c2c2c] dark:bg-white rounded-full transition-all duration-300"
                    style={{ width: `${scanProgress}%` }}
                  />
                </div>
                <span className="text-[10px] text-neutral-400 font-mono truncate">
                  File: {uploadedFileName || taskInfo?.name || "Dataset 3D"}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  variant="pill"
                  size="sm"
                  onClick={async () => {
                    if (onFetchCVATTask && taskInfo?.id) {
                      await onFetchCVATTask(taskInfo.id);
                    }
                  }}
                  disabled={isFetchingCVAT || isScanning || !taskInfo?.id}
                  className="flex-1 font-semibold bg-neutral-100 hover:bg-neutral-200 text-neutral-800 border border-neutral-200/90 dark:bg-neutral-800 dark:text-neutral-200 dark:border-neutral-700 text-xs gap-1.5 transition"
                >
                  {isFetchingCVAT ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-neutral-600 dark:text-neutral-300" />
                  ) : (
                    <Database className="h-3.5 w-3.5" />
                  )}
                  <span>
                    {isFetchingCVAT
                      ? (taskInfo?.id ? `Đang Nạp Dữ Liệu Task #${taskInfo.id}...` : "Đang Nạp Dữ Liệu CVAT...")
                      : taskInfo?.id
                      ? `Nạp Dữ Liệu Từ CVAT Task #${taskInfo.id}`
                      : "Nạp Dữ Liệu Từ CVAT"}
                  </span>
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={onOpenWorkstationDirect}
                  className="rounded-full text-xs font-medium text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 gap-1"
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span>Mở 3D</span>
                </Button>
              </div>
            )}
          </div>
        </Card>

        {/* Khu vực B: Bảng Thống Kê Auto-QC & Duyệt Nhanh (7 Cột) */}
        <div className="lg:col-span-7 grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Card 1: Tổng số Hộp 3D đã quét */}
          <Card className="bg-white dark:bg-[#0d131f] rounded-2xl border border-neutral-200/80 dark:border-neutral-800 p-4 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold tracking-wider text-neutral-400">
                Tổng Số Hộp 3D
              </span>
              <Boxes className="h-4 w-4 text-neutral-600 dark:text-neutral-400" />
            </div>
            <div className="my-2">
              <div className="text-2xl font-bold font-mono tracking-tight text-neutral-900 dark:text-white">
                {isDataLoaded ? summary.total_boxes.toLocaleString() : "--"}
              </div>
              <div className="text-[11px] text-neutral-500 font-medium">
                {isDataLoaded ? `Quét trong ${summary.total_frames} frames .pcd` : "Chưa có dữ liệu"}
              </div>
            </div>
            <div className="text-[10px] font-mono text-neutral-400 border-t border-neutral-100 dark:border-neutral-800/80 pt-2">
              {isDataLoaded ? "Tỷ lệ phủ: 100% Volume" : "Tỷ lệ phủ: --"}
            </div>
          </Card>

          {/* Card 2: Ca Dễ (EASY_AUTO - Cờ Xanh) + Nút 1-Click Auto Approve */}
          <Card className="bg-white dark:bg-[#0d131f] rounded-2xl border border-emerald-200/80 dark:border-emerald-950/80 p-4 shadow-sm flex flex-col justify-between relative overflow-hidden">
            <div className="absolute top-0 right-0 w-16 h-16 bg-emerald-500/5 rounded-full blur-xl pointer-events-none" />
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                Ca Dễ (Auto)
              </span>
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="my-1.5">
              <div className="text-2xl font-bold font-mono tracking-tight text-neutral-900 dark:text-white">
                {isDataLoaded ? summary.easy_count.toLocaleString() : "--"}
              </div>
              <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                {isDataLoaded ? `${summary.easy_pct}% • Đạt chuẩn PCA` : "--% • Chưa phân tích"}
              </div>
            </div>
            <Button
              variant="pill"
              size="pillSm"
              onClick={onAutoApproveEasy}
              disabled={!isDataLoaded || isApproving}
              className={`w-full text-[10px] font-semibold rounded-full mt-1 gap-1 shadow-sm transition ${
                !isDataLoaded
                  ? "bg-neutral-200 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500 cursor-not-allowed hover:bg-neutral-200"
                  : "bg-emerald-600 hover:bg-emerald-700 text-white"
              }`}
              title={isDataLoaded ? "Xuất báo cáo phân loại kiểm định dữ liệu" : "Chưa có dữ liệu"}
            >
              <FileText className="h-3 w-3" />
              <span>Xuất Báo Cáo Phân Loại</span>
            </Button>
          </Card>

          {/* Card 3: Ca Khó (HARD_REVIEW - Cờ Đỏ) */}
          <Card className="bg-white dark:bg-[#0d131f] rounded-2xl border border-rose-200/80 dark:border-rose-950/80 p-4 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold tracking-wider text-rose-600 dark:text-rose-400 flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-500"></span>
                Ca Khó (Hard)
              </span>
              <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
            </div>
            <div className="my-2">
              <div className="text-2xl font-bold font-mono tracking-tight text-rose-600 dark:text-rose-400">
                {isDataLoaded ? summary.hard_count.toLocaleString() : "--"}
              </div>
              <div className="text-[11px] text-neutral-500 font-medium">
                {isDataLoaded ? `${summary.hard_pct}% • Cần chuyên gia duyệt` : "--% • Chưa phân tích"}
              </div>
            </div>
            <div className="text-[10px] font-medium text-rose-700/80 dark:text-rose-400/80 border-t border-neutral-100 dark:border-neutral-800/80 pt-2 truncate">
              {isDataLoaded ? "PCA Collapse dz<0.05m / SOTIF" : "PCA Collapse dz<0.05m / SOTIF (Chờ nạp)"}
            </div>
          </Card>

          {/* Card 4: Lỗi Pipeline (PIPELINE_DEFECT - Cờ Cam) */}
          <Card className="bg-white dark:bg-[#0d131f] rounded-2xl border border-amber-200/80 dark:border-amber-950/80 p-4 shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
                Lỗi Pipeline
              </span>
              <Layers className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="my-2">
              <div className="text-2xl font-bold font-mono tracking-tight text-amber-600 dark:text-amber-400">
                {isDataLoaded ? summary.pipeline_count.toLocaleString() : "--"}
              </div>
              <div className="text-[11px] text-neutral-500 font-medium">
                {isDataLoaded ? `${summary.pipeline_pct}% • Cắt nhầm mặt đường` : "--% • Chưa phân tích"}
              </div>
            </div>
            <div className="text-[10px] font-medium text-amber-700/80 dark:text-amber-400/80 border-t border-neutral-100 dark:border-neutral-800/80 pt-2 truncate">
              {isDataLoaded ? "z-cutoff lọc thô bạo (z < -1.0m)" : "z-cutoff lọc thô bạo (Chờ nạp)"}
            </div>
          </Card>
        </div>
      </div>

      {/* Khu vực C: Danh Sách Các Ca Đã Gán Cờ (Hàng Dưới - Grid Thẻ) */}
      <div className="flex-1 flex flex-col gap-3 min-h-0">
        {/* Filter Bar & Quick Search */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-[#0d131f] rounded-2xl border border-neutral-200/80 dark:border-neutral-800 px-4 py-2.5 shadow-sm">
          {/* Radix UI Tabs Filter Bar */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-400 hidden md:inline">
              Bộ lọc:
            </span>

            <Tabs
              value={selectedFilter}
              onValueChange={(val) => setSelectedFilter(val as FlaggedCategory)}
              className="w-full sm:w-auto"
            >
              <TabsList className="h-9 bg-neutral-100/90 dark:bg-neutral-800/90 rounded-xl p-1 gap-1 border border-neutral-200/60 dark:border-neutral-700/60">
                <TabsTrigger
                  value="ALL"
                  className="rounded-lg text-xs font-semibold px-2.5 py-1 data-[state=active]:bg-white data-[state=active]:text-neutral-900 data-[state=active]:shadow-sm dark:data-[state=active]:bg-neutral-700 dark:data-[state=active]:text-white"
                >
                  Tất cả ({isDataLoaded ? flaggedCases.length : "--"})
                </TabsTrigger>
                <TabsTrigger
                  value="HARD_REVIEW"
                  className="rounded-lg text-xs font-semibold px-2.5 py-1 text-rose-700 dark:text-rose-400 data-[state=active]:bg-white data-[state=active]:text-rose-600 data-[state=active]:shadow-sm dark:data-[state=active]:bg-neutral-700"
                >
                  🚨 Ca Khó ({isDataLoaded ? summary.hard_count : "--"})
                </TabsTrigger>
                <TabsTrigger
                  value="PIPELINE_DEFECT"
                  className="rounded-lg text-xs font-semibold px-2.5 py-1 text-amber-700 dark:text-amber-400 data-[state=active]:bg-white data-[state=active]:text-amber-600 data-[state=active]:shadow-sm dark:data-[state=active]:bg-neutral-700"
                >
                  ⚠️ Lỗi Pipeline ({isDataLoaded ? summary.pipeline_count : "--"})
                </TabsTrigger>
                <TabsTrigger
                  value="EASY_AUTO"
                  className="rounded-lg text-xs font-semibold px-2.5 py-1 text-emerald-700 dark:text-emerald-400 data-[state=active]:bg-white data-[state=active]:text-emerald-600 data-[state=active]:shadow-sm dark:data-[state=active]:bg-neutral-700"
                >
                  ✅ Ca Dễ ({isDataLoaded ? summary.easy_count : "--"})
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Quick Search Input */}
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-400" />
            <input
              type="text"
              placeholder="Tìm theo cuboid_id, Frame..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-neutral-100 dark:bg-neutral-800/90 text-neutral-800 dark:text-neutral-100 text-xs rounded-full pl-9 pr-3 py-1.5 border border-neutral-200/80 dark:border-neutral-700 focus:outline-none focus:ring-1 focus:ring-neutral-400"
            />
          </div>
        </div>

        {/* Grid Lưới Thẻ: grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-6">
          {filteredList.map((item) => {
            const isHard = item.category === "HARD_REVIEW";
            const isPipeline = item.category === "PIPELINE_DEFECT";

            return (
              <Card
                key={item.id}
                onClick={() => onSelectCase(item)}
                className={`bg-white dark:bg-[#0d131f] rounded-2xl border transition-all duration-200 p-4 shadow-sm hover:shadow-md cursor-pointer flex flex-col justify-between gap-3 group ${
                  isHard
                    ? "border-neutral-200/90 dark:border-neutral-800 hover:border-rose-300 dark:hover:border-rose-800"
                    : isPipeline
                    ? "border-neutral-200/90 dark:border-neutral-800 hover:border-amber-300 dark:hover:border-amber-800"
                    : "border-neutral-200/90 dark:border-neutral-800 hover:border-emerald-300 dark:hover:border-emerald-800"
                }`}
              >
                {/* Header thẻ: Tên hộp, số frame, badge gắn cờ */}
                <div>
                  <div className="flex items-center justify-between gap-1 mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-bold text-xs text-neutral-900 dark:text-white group-hover:text-neutral-700 dark:group-hover:text-neutral-200">
                        {item.id}
                      </span>
                      <span className="text-[10px] text-neutral-400 font-medium">
                        • {item.label.split(".").pop()}
                      </span>
                    </div>

                    <Badge
                      variant="monochrome"
                      className="font-mono text-[9px] px-1.5 py-0 h-4 bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
                    >
                      Frame #{item.frame}
                    </Badge>
                  </div>

                  <div className="mb-2">
                    {isHard ? (
                      <Badge variant="hard" className="text-[10px] gap-1">
                        <AlertTriangle className="h-3 w-3 stroke-[2.5]" />
                        {item.badge_text}
                      </Badge>
                    ) : isPipeline ? (
                      <Badge variant="defect" className="text-[10px] gap-1">
                        <Layers className="h-3 w-3 stroke-[2.5]" />
                        {item.badge_text}
                      </Badge>
                    ) : (
                      <Badge variant="easy" className="text-[10px] gap-1">
                        <CheckCircle2 className="h-3 w-3 stroke-[2.5]" />
                        {item.badge_text}
                      </Badge>
                    )}
                  </div>

                  {/* 3 Ô thông số nhanh: Chiều cao h, Mật độ, Cự ly */}
                  <div className="grid grid-cols-3 gap-1.5 mb-2.5">
                    <div className="bg-neutral-100/80 dark:bg-neutral-800/80 rounded-xl p-1.5 flex flex-col items-center justify-center border border-neutral-200/60 dark:border-neutral-700/60">
                      <span className="text-[8px] uppercase tracking-wider text-neutral-500">
                        Cao h
                      </span>
                      <span
                        className={`font-mono font-bold text-[11px] ${
                          item.h < 0.05
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-neutral-900 dark:text-white"
                        }`}
                      >
                        {item.h.toFixed(3)}m
                      </span>
                    </div>

                    <div className="bg-neutral-100/80 dark:bg-neutral-800/80 rounded-xl p-1.5 flex flex-col items-center justify-center border border-neutral-200/60 dark:border-neutral-700/60">
                      <span className="text-[8px] uppercase tracking-wider text-neutral-500">
                        Mật độ
                      </span>
                      <span className="font-mono font-bold text-[11px] text-neutral-900 dark:text-white">
                        {item.points_count}/{item.raw_points_count} pts
                      </span>
                    </div>

                    <div className="bg-neutral-100/80 dark:bg-neutral-800/80 rounded-xl p-1.5 flex flex-col items-center justify-center border border-neutral-200/60 dark:border-neutral-700/60">
                      <span className="text-[8px] uppercase tracking-wider text-neutral-500">
                        Cự ly
                      </span>
                      <span className="font-mono font-bold text-[11px] text-neutral-900 dark:text-white">
                        {item.distance.toFixed(1)}m
                      </span>
                    </div>
                  </div>

                  {/* Lý do gán cờ */}
                  <div className="bg-neutral-50 dark:bg-neutral-900/60 rounded-xl p-2 text-[10.5px] leading-relaxed text-neutral-600 dark:text-neutral-300 border border-neutral-200/60 dark:border-neutral-800 min-h-[44px]">
                    {item.flag_reason}
                  </div>
                </div>

                {/* Nút hành động đáy thẻ */}
                <Button
                  variant="monochrome"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectCase(item);
                  }}
                  className="w-full py-2 bg-[#2c2c2c] hover:bg-neutral-800 text-white dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 rounded-xl text-xs font-semibold gap-1.5 shadow-sm transition group-hover:translate-x-0.5"
                >
                  <span>Kiểm tra trên 3D Workstation</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Card>
            );
          })}
        </div>

        {filteredList.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center text-neutral-400 bg-white dark:bg-[#0d131f] rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-800 p-8 shadow-sm">
            <Boxes className="h-10 w-10 mb-2.5 opacity-40 text-neutral-500" />
            <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-1">
              {isDataLoaded ? "Không tìm thấy hộp 3D nào phù hợp" : "Chưa cấu hình hoặc chưa nạp dữ liệu kiểm định 3D"}
            </h3>
            <p className="text-xs text-neutral-500 max-w-md leading-relaxed">
              {isDataLoaded
                ? "Hãy thử tìm kiếm với từ khóa khác hoặc chuyển sang danh mục lọc khác."
                : "Mọi thông số tính toán hiện đang để trống. Vui lòng mở menu ☰ để cấu hình kết nối CVAT Local (Task ID), hoặc bấm nút 'Nạp Dữ Liệu Từ CVAT' / tải file 3D ở Khu Vực A để bắt đầu phân tích."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
