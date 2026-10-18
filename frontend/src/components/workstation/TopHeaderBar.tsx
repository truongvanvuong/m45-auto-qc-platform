import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CVATConfigModal, CVATConnectionConfig } from "./CVATConfigModal";
import {
  Menu,
  Save,
  Undo2,
  Redo2,
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  LayoutGrid,
  Box,
  Settings,
  FolderOpen,
  Sliders,
  Shield,
  FileText,
  RotateCcw,
  ShieldCheck,
  Zap
} from "lucide-react";
import { CVATTaskInfo } from "@/types/qc";

interface TopHeaderBarProps {
  currentView: "OVERVIEW" | "WORKSTATION";
  onViewChange: (view: "OVERVIEW" | "WORKSTATION") => void;
  currentFrame?: number;
  totalFrames?: number;
  pcdFile?: string;
  onFrameChange?: (frame: number) => void;
  isPlaying?: boolean;
  onTogglePlay?: () => void;
  taskInfo?: CVATTaskInfo | null;
  onAutoApprove?: () => void;
  onExportReport?: () => void;
  onFetchTask?: () => void;
  isApproving?: boolean;
  isExporting?: boolean;
  isDarkMode?: boolean;
  onToggleDarkMode?: () => void;
  hardCount?: number;
  easyCount?: number;
  onConnectCVAT?: (config: CVATConnectionConfig, syncedDataset?: any) => void;
  onResetCVAT?: () => void;
  // Real Undo / Redo / Save actions
  onSave?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  // Safe Sync modal trigger
  onOpenSafeSync?: () => void;
}

export const TopHeaderBar: React.FC<TopHeaderBarProps> = ({
  currentView,
  onViewChange,
  currentFrame = 0,
  totalFrames = 0,
  pcdFile = "",
  onFrameChange,
  isPlaying = false,
  onTogglePlay,
  taskInfo,
  onAutoApprove,
  onExportReport,
  onFetchTask,
  isApproving = false,
  isExporting = false,
  isDarkMode = false,
  onToggleDarkMode,
  hardCount = 0,
  easyCount = 0,
  onConnectCVAT,
  onResetCVAT,
  onSave,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onOpenSafeSync,
}) => {
  const [isCVATModalOpen, setIsCVATModalOpen] = useState(false);

  const fileName = pcdFile ? pcdFile.split("/").pop()?.toUpperCase() : (totalFrames > 0 ? `FRAME_${currentFrame}.PCD` : "--");
  const taskLabel = taskInfo?.id ? `Fetch CVAT Task #${taskInfo.id}` : "Kết nối CVAT Task";

  return (
    <>
      <header className="h-12 w-full bg-white dark:bg-[#0d131f] rounded-2xl border border-neutral-200/80 dark:border-neutral-800/90 shadow-sm px-4 flex items-center justify-between gap-3 shrink-0 select-none font-sans transition-colors duration-200">
        {/* ================================================================= */}
        {/* CỤM TRÁI: Menu viên thuốc + Save, Undo, Redo + Separator + Logo   */}
        {/* ================================================================= */}
        <div className="flex items-center gap-2">
          {/* Nút Menu dạng viên thuốc */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Hệ thống & Tùy chọn"
                className="w-8 h-8 rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:hover:bg-neutral-700 dark:text-neutral-200 flex items-center justify-center transition border border-neutral-200/60 dark:border-neutral-700 cursor-pointer shadow-sm"
                title="Hệ thống & Tùy chọn"
              >
                <Menu className="h-4 w-4 stroke-[2.4] text-[#333333] dark:text-neutral-200" />
              </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              align="start"
              className="w-72 bg-white dark:bg-[#0d131f] rounded-2xl p-1.5 shadow-2xl border border-neutral-200/90 dark:border-neutral-800 text-neutral-800 dark:text-neutral-100"
            >
              <DropdownMenuLabel className="text-[10px] font-mono text-neutral-400 px-2.5 py-1">
                KẾT NỐI & DỮ LIỆU CVAT
              </DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => setIsCVATModalOpen(true)}
                className="cursor-pointer rounded-xl px-2.5 py-2 text-xs font-semibold hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2 text-neutral-800 dark:text-neutral-100"
              >
                <Settings className="h-4 w-4 stroke-[2] text-[#333333] dark:text-neutral-300" />
                <span>Cấu hình Kết nối CVAT Local...</span>
              </DropdownMenuItem>

              {onOpenSafeSync && (
                <DropdownMenuItem
                  onClick={onOpenSafeSync}
                  className="cursor-pointer rounded-xl px-2.5 py-2 text-xs font-semibold hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center gap-2 text-neutral-800 dark:text-neutral-100"
                >
                  <ShieldCheck className="h-4 w-4 stroke-[2] text-[#333333] dark:text-neutral-300" />
                  <span>Safe Sync Preview & Đề Xuất...</span>
                </DropdownMenuItem>
              )}

              {taskInfo && (
                <DropdownMenuItem
                  onClick={onResetCVAT}
                  className="cursor-pointer rounded-xl px-2.5 py-2 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-2"
                >
                  <RotateCcw className="h-4 w-4" />
                  <span>Xóa Cấu Hình & Đặt Lại (Reset)...</span>
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator className="my-1 bg-neutral-100 dark:bg-neutral-800" />

              <DropdownMenuLabel className="text-[10px] font-mono text-neutral-400 px-2.5 py-1">
                THAM SỐ KIỂM ĐỊNH M45
              </DropdownMenuLabel>
              <div className="px-2.5 py-1.5 text-[11px] text-neutral-600 dark:text-neutral-300 flex flex-col gap-1 font-mono">
                <div className="flex justify-between">
                  <span>Ngưỡng PCA Collapse:</span>
                  <span className="font-bold">h &lt; 0.05m</span>
                </div>
                <div className="flex justify-between">
                  <span>Ngưỡng z-cutoff:</span>
                  <span className="font-bold">z &lt; -1.0m</span>
                </div>
                <div className="flex justify-between">
                  <span>SOTIF dừng xe (50km/h):</span>
                  <span className="font-bold">29.19m</span>
                </div>
              </div>

              <DropdownMenuSeparator className="my-1 bg-neutral-100 dark:bg-neutral-800" />

              <div className="px-2.5 py-1.5 flex items-center justify-between text-[10px] text-neutral-400 font-mono">
                <span>M45 ENGINE • v2.8 (Build 2026)</span>
                <span className="text-emerald-500 font-semibold">• Ready</span>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Các nút icon Save, Undo, Redo đơn sắc #333333 */}
          <button
            onClick={onSave}
            aria-label="Lưu chỉnh sửa hình học hộp 3D"
            className="w-8 h-8 rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:hover:bg-neutral-700 dark:text-neutral-200 flex items-center justify-center transition border border-neutral-200/60 dark:border-neutral-700 cursor-pointer shadow-sm"
            title="Lưu chỉnh sửa hình học hộp 3D (Save - Ctrl+S)"
          >
            <Save className="h-3.5 w-3.5 stroke-[2.4] text-[#333333] dark:text-neutral-200" />
          </button>

          <button
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="Hoàn tác thay đổi"
            className="w-8 h-8 rounded-full bg-neutral-100 hover:bg-neutral-200 disabled:opacity-35 disabled:cursor-not-allowed text-neutral-800 dark:bg-neutral-800 dark:hover:bg-neutral-700 dark:text-neutral-200 flex items-center justify-center transition border border-neutral-200/60 dark:border-neutral-700 cursor-pointer shadow-sm"
            title="Hoàn tác thay đổi (Undo - Ctrl+Z)"
          >
            <Undo2 className="h-3.5 w-3.5 stroke-[2.4] text-[#333333] dark:text-neutral-200" />
          </button>

          <button
            onClick={onRedo}
            disabled={!canRedo}
            aria-label="Làm lại thay đổi"
            className="w-8 h-8 rounded-full bg-neutral-100 hover:bg-neutral-200 disabled:opacity-35 disabled:cursor-not-allowed text-neutral-800 dark:bg-neutral-800 dark:hover:bg-neutral-700 dark:text-neutral-200 flex items-center justify-center transition border border-neutral-200/60 dark:border-neutral-700 cursor-pointer shadow-sm"
            title="Làm lại thay đổi (Redo - Ctrl+Y)"
          >
            <Redo2 className="h-3.5 w-3.5 stroke-[2.4] text-[#333333] dark:text-neutral-200" />
          </button>

          <Separator orientation="vertical" className="h-4 mx-1" />

          {/* Logo M45 ENGINE kèm Badge v2.8 */}
          <div className="flex items-baseline gap-1.5 mr-2">
            <span className="font-extrabold text-xs tracking-tight text-neutral-900 dark:text-white font-mono">
              M45 ENGINE
            </span>
            <Badge variant="monochrome" className="text-[9px] px-1.5 py-0 h-4 leading-none font-mono">
              v2.8
            </Badge>
          </div>

          {/* Segmented View Switch (Bảng Gán Cờ vs 3D Workstation) */}
          <div className="bg-neutral-100/90 dark:bg-neutral-900/90 p-0.5 rounded-full flex items-center border border-neutral-200/80 dark:border-neutral-700/80 shadow-inner">
            <button
              onClick={() => onViewChange("OVERVIEW")}
              className={`px-3 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1.5 transition duration-150 ${
                currentView === "OVERVIEW"
                  ? "bg-white dark:bg-[#1a2333] text-neutral-900 dark:text-white shadow-sm"
                  : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
              }`}
            >
              <LayoutGrid className="h-3 w-3 stroke-[2.4] text-[#333333] dark:text-neutral-300" />
              <span>Bảng Gán Cờ</span>
            </button>

            <button
              onClick={() => onViewChange("WORKSTATION")}
              className={`px-3 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1.5 transition duration-150 ${
                currentView === "WORKSTATION"
                  ? "bg-white dark:bg-[#1a2333] text-neutral-900 dark:text-white shadow-sm"
                  : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
              }`}
            >
              <Box className="h-3 w-3 stroke-[2.4] text-[#333333] dark:text-neutral-300" />
              <span>3D Workstation</span>
            </button>
          </div>
        </div>

        {/* ================================================================= */}
        {/* CỤM ĐIỀU KHIỂN FRAME Ở CHÍNH GIỮA (Center Frame Controller)       */}
        {/* Chỉ hiển thị trên 3D Workstation, ẩn khi ở Bảng Gán Cờ (OVERVIEW) */}
        {/* ================================================================= */}
        {currentView === "WORKSTATION" ? (
          <div className="bg-neutral-100/90 dark:bg-neutral-900/90 border border-neutral-200/80 dark:border-neutral-700/80 rounded-full px-3.5 py-1 flex items-center gap-2.5 shadow-inner">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onFrameChange?.(Math.max(0, currentFrame - 1))}
              disabled={totalFrames <= 0}
              className="h-6 w-6 rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-800 dark:text-neutral-200 disabled:opacity-40"
              title="Frame trước (←)"
            >
              <ChevronLeft className="h-3.5 w-3.5 stroke-[2.4] text-[#333333] dark:text-neutral-200" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={onTogglePlay}
              disabled={totalFrames <= 1}
              className="h-6 w-6 rounded-full bg-neutral-200 hover:bg-neutral-300 text-neutral-900 dark:bg-neutral-800 dark:hover:bg-neutral-700 dark:text-neutral-100 disabled:opacity-40"
              title={isPlaying ? "Tạm dừng (Space)" : "Phát liên tục (Space)"}
            >
              {isPlaying ? (
                <Pause className="h-3 w-3 stroke-[2.4] text-[#333333] dark:text-neutral-100" />
              ) : (
                <Play className="h-3 w-3 ml-0.5 stroke-[2.4] text-[#333333] dark:text-neutral-100" />
              )}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => onFrameChange?.(Math.min(Math.max(0, totalFrames - 1), currentFrame + 1))}
              disabled={totalFrames <= 0}
              className="h-6 w-6 rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-800 dark:text-neutral-200 disabled:opacity-40"
              title="Frame kế tiếp (→)"
            >
              <ChevronRight className="h-3.5 w-3.5 stroke-[2.4] text-[#333333] dark:text-neutral-200" />
            </Button>

            {/* Thanh Slider tông màu xám than #2c2c2c */}
            <div className="w-28 px-1">
              <Slider
                value={[currentFrame]}
                min={0}
                max={Math.max(0, totalFrames - 1)}
                step={1}
                disabled={totalFrames <= 1}
                onValueChange={(val) => onFrameChange?.(val[0])}
                className="w-full cursor-pointer"
              />
            </div>

            <div className="flex items-center gap-1 font-mono text-[10px] whitespace-nowrap text-neutral-700 dark:text-neutral-300">
              <span className="font-bold text-neutral-900 dark:text-white">
                {totalFrames > 0 ? currentFrame.toString().padStart(2, "0") : "--"}
              </span>
              <span className="text-neutral-400">/</span>
              <span>{totalFrames > 0 ? (totalFrames - 1).toString().padStart(2, "0") : "--"}</span>
            </div>

            {/* Badge tên file / số frame */}
            <Badge
              variant="monochrome"
              className="text-[9px] px-2 py-0.5 h-4 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 font-mono shadow-xs"
            >
              {fileName}
            </Badge>
          </div>
        ) : (
          <div className="flex-1" />
        )}

        {/* ================================================================= */}
        {/* CỤM NÚT PHẢI: Monochrome Capsule UI (Fetch, Export, Sync)        */}
        {/* ================================================================= */}
        <div className="flex items-center gap-2">

          {/* Nút Fetch CVAT Task dạng viên thuốc */}
          <Button
            variant="pill"
            size="pillSm"
            onClick={onFetchTask}
            className="rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:hover:bg-neutral-700 dark:text-neutral-200 border border-neutral-200/90 dark:border-neutral-700 font-semibold text-xs transition"
          >
            <span>{taskLabel}</span>
          </Button>

          {/* Nút Xuất Báo Cáo Phân Loại */}
          <Button
            variant="pill"
            size="pillSm"
            onClick={onExportReport || onAutoApprove}
            disabled={isExporting || isApproving}
            className="rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:hover:bg-neutral-700 dark:text-neutral-200 border border-neutral-200/90 dark:border-neutral-700 font-semibold text-xs transition gap-1.5"
            title="Tải về báo cáo phân loại kiểm định Ca Dễ / Ca Khó dưới định dạng JSON"
          >
            <FileText className="h-3 w-3 stroke-[2.4] text-[#333333] dark:text-neutral-300" />
            <span>Xuất Báo Cáo Phân Loại</span>
          </Button>

          {/* Nút Safe Sync mở Modal xem trước & đồng bộ có xác nhận */}
          {onOpenSafeSync && (
            <Button
              variant="pill"
              size="pillSm"
              onClick={onOpenSafeSync}
              className="rounded-full bg-[#2c2c2c] hover:bg-neutral-800 text-white dark:bg-white dark:text-neutral-900 font-bold text-xs transition gap-1.5 shadow-sm"
              title="Xem trước và đồng bộ thay đổi an toàn sang CVAT"
            >
              <ShieldCheck className="h-3.5 w-3.5 stroke-[2.4]" />
              <span>Safe Sync</span>
            </Button>
          )}

          <Separator orientation="vertical" className="h-4 mx-0.5" />

          {/* Theme Toggle Button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleDarkMode}
            className="h-8 w-8 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300"
            title={isDarkMode ? "Chuyển sang Light Mode (#f6f7f9)" : "Chuyển sang Dark Mode"}
          >
            {isDarkMode ? (
              <Sun className="h-3.5 w-3.5 stroke-[2.4] text-neutral-300" />
            ) : (
              <Moon className="h-3.5 w-3.5 stroke-[2.4] text-[#333333]" />
            )}
          </Button>
        </div>
      </header>

      {/* Modal Cấu hình CVAT */}
      <CVATConfigModal
        isOpen={isCVATModalOpen}
        onClose={() => setIsCVATModalOpen(false)}
        initialConfig={{
          cvatUrl: "http://localhost:8080",
          taskId: taskInfo?.id || "16",
        }}
        onSave={(config, syncedDataset) => {
          onConnectCVAT?.(config, syncedDataset);
          setIsCVATModalOpen(false);
        }}
        onReset={onResetCVAT}
      />
    </>
  );
};
