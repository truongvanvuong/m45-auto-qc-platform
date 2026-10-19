import React, { useState, useEffect, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CameraImageOverlay, BoundingBox3D } from "@/types/qc";
import { resolveImageUrl } from "@/services/api";
import {
  Camera,
  ZoomIn,
  ZoomOut,
  X,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Eye,
  RotateCcw,
  Compass,
  LayoutGrid,
  Columns,
  Minimize2,
} from "lucide-react";

interface CameraSidebarProps {
  cameras: CameraImageOverlay[];
  selectedBox?: BoundingBox3D;
  onSelectBox: (boxId: string) => void;
}

export const CameraSidebar: React.FC<CameraSidebarProps> = ({
  cameras,
  selectedBox,
  onSelectBox,
}) => {
  const [expandedCamIndex, setExpandedCamIndex] = useState<number | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [showOverlayBoxes, setShowOverlayBoxes] = useState<boolean>(true);
  const [viewMode, setViewMode] = useState<"360" | "FRONT" | "REAR" | "ALL">("360");
  const [isWide, setIsWide] = useState<boolean>(false);

  // Close lightbox on Escape, navigate cameras with Left/Right when modal is open
  useEffect(() => {
    if (expandedCamIndex === null) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setExpandedCamIndex(null);
      } else if (e.key === "ArrowLeft" && cameras.length > 0) {
        e.stopPropagation();
        setExpandedCamIndex((prev) =>
          prev !== null ? (prev - 1 + cameras.length) % cameras.length : 0
        );
      } else if (e.key === "ArrowRight" && cameras.length > 0) {
        e.stopPropagation();
        setExpandedCamIndex((prev) =>
          prev !== null ? (prev + 1) % cameras.length : 0
        );
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [expandedCamIndex, cameras.length]);

  const buildProjectedBoxes = (cam: CameraImageOverlay) => {
    return cam.projected_boxes || [];
  };

  const has6Cams = cameras.length >= 6;

  const displayCameras = useMemo(() => {
    if (viewMode === "FRONT") {
      const front = cameras.filter((c) => c.cam_id.toUpperCase().includes("FRONT"));
      return front.length > 0 ? front : cameras.slice(0, 3);
    }
    if (viewMode === "REAR") {
      const rear = cameras.filter((c) => c.cam_id.toUpperCase().includes("BACK") || c.cam_id.toUpperCase().includes("REAR"));
      return rear.length > 0 ? rear : cameras.slice(3, 6);
    }
    return cameras;
  }, [cameras, viewMode]);

  if (!cameras || cameras.length === 0) {
    return (
      <aside className="w-80 h-full flex flex-col gap-2 shrink-0 select-none">
        <Card className="flex-1 bg-white dark:bg-[#0d131f] rounded-2xl border border-neutral-200/80 dark:border-neutral-800 shadow-sm p-4 flex flex-col items-center justify-center text-center">
          <Camera className="h-8 w-8 text-neutral-400 mb-2 opacity-40" />
          <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            Không Có Camera Đồng Bộ
          </span>
          <span className="text-[10px] text-neutral-400 mt-1 max-w-[200px] leading-relaxed">
            Task CVAT hiện tại sử dụng dữ liệu 3D Point Cloud LiDAR thuần túy.
          </span>
        </Card>
      </aside>
    );
  }

  const expandedCam =
    expandedCamIndex !== null && cameras[expandedCamIndex]
      ? cameras[expandedCamIndex]
      : null;
  const expandedPBoxes = expandedCam ? buildProjectedBoxes(expandedCam) : [];

  return (
    <>
      <aside className={`h-full flex flex-col gap-2 shrink-0 select-none transition-all duration-200 ${
        isWide ? "w-[480px]" : has6Cams && viewMode === "360" ? "w-[390px]" : "w-80"
      }`}>
        {/* 360 Camera Controls Header */}
        <div className="bg-white dark:bg-[#0d131f] border border-neutral-200/80 dark:border-neutral-800 rounded-xl px-2.5 py-1.5 flex items-center justify-between text-xs shadow-sm">
          <div className="flex items-center gap-1.5">
            <Compass className="h-3.5 w-3.5 text-blue-500 animate-spin-slow" />
            <span className="font-semibold text-neutral-800 dark:text-neutral-200 text-[11px]">
              {cameras.length} Camera 360°
            </span>
          </div>

          {/* Filter Mode Buttons */}
          <div className="flex items-center gap-1 bg-neutral-100 dark:bg-neutral-800/80 p-0.5 rounded-lg text-[10px]">
            {has6Cams && (
              <button
                type="button"
                onClick={() => setViewMode("360")}
                className={`px-1.5 py-0.5 rounded font-medium transition ${
                  viewMode === "360"
                    ? "bg-white dark:bg-neutral-700 text-blue-600 dark:text-blue-300 shadow-sm"
                    : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                }`}
              >
                360° Lưới
              </button>
            )}
            <button
              type="button"
              onClick={() => setViewMode("FRONT")}
              className={`px-1.5 py-0.5 rounded font-medium transition ${
                viewMode === "FRONT"
                  ? "bg-white dark:bg-neutral-700 text-blue-600 dark:text-blue-300 shadow-sm"
                  : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
              }`}
            >
              Trước
            </button>
            {has6Cams && (
              <button
                type="button"
                onClick={() => setViewMode("REAR")}
                className={`px-1.5 py-0.5 rounded font-medium transition ${
                  viewMode === "REAR"
                    ? "bg-white dark:bg-neutral-700 text-blue-600 dark:text-blue-300 shadow-sm"
                    : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                }`}
              >
                Sau
              </button>
            )}
            <button
              type="button"
              onClick={() => setViewMode("ALL")}
              className={`px-1.5 py-0.5 rounded font-medium transition ${
                viewMode === "ALL"
                  ? "bg-white dark:bg-neutral-700 text-blue-600 dark:text-blue-300 shadow-sm"
                  : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
              }`}
            >
              Tất Cả
            </button>
          </div>

          {/* Width toggle */}
          <button
            type="button"
            onClick={() => setIsWide(!isWide)}
            title={isWide ? "Thu hẹp camera" : "Mở rộng 360"}
            className="p-1 rounded text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition"
          >
            {isWide ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </button>
        </div>

        {/* Camera List / Grid Container */}
        <div className={`flex-1 overflow-y-auto pr-1 flex flex-col gap-2 min-h-0 ${
          viewMode === "360" && has6Cams ? "grid grid-cols-2 auto-rows-fr" : ""
        }`}>
          {displayCameras.map((cam, idx) => {
            const pboxes = buildProjectedBoxes(cam);
            const originalIndex = cameras.findIndex((c) => c.cam_id === cam.cam_id);

            return (
              <Card
                key={cam.cam_id}
                onClick={() => {
                  setExpandedCamIndex(originalIndex >= 0 ? originalIndex : idx);
                  setZoomLevel(1);
                }}
                className={`group bg-white dark:bg-[#0d131f] rounded-2xl border border-neutral-200/80 dark:border-neutral-800 hover:border-blue-400 dark:hover:border-blue-600 shadow-sm overflow-hidden flex flex-col cursor-zoom-in transition-all ${
                  viewMode === "360" && has6Cams ? "h-36" : "flex-1 min-h-[140px]"
                }`}
              >
                {/* Header */}
                <div className="h-6 bg-white dark:bg-[#0d131f] border-b border-neutral-100 dark:border-neutral-800 px-2.5 flex items-center justify-between text-[10px] text-neutral-600 dark:text-neutral-300">
                  <div className="flex items-center gap-1 font-medium truncate">
                    <Camera className="h-2.5 w-2.5 stroke-[2.2] text-neutral-700 dark:text-neutral-300 shrink-0" />
                    <span className="font-semibold text-neutral-900 dark:text-white truncate">
                      {cam.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Badge
                      variant="monochrome"
                      className="text-[8px] px-1 py-0 h-3.5 leading-none font-mono"
                    >
                      FOV 70°
                    </Badge>
                  </div>
                </div>

              {/* Camera Viewport Canvas with Street backdrop & 2D Box Overlay */}
              <div className="flex-1 relative bg-neutral-900 overflow-hidden flex items-center justify-center">
                <svg viewBox="0 0 400 240" className="w-full h-full object-cover">
                  {/* Sky */}
                  <rect x="0" y="0" width="400" height="120" fill="#334155" />
                  {/* Horizon glow */}
                  <rect
                    x="0"
                    y="110"
                    width="400"
                    height="20"
                    fill="#475569"
                    opacity="0.6"
                  />
                  {/* Road */}
                  <polygon points="0,240 400,240 230,120 170,120" fill="#1e293b" />
                  {/* Sidewalk */}
                  <polygon points="0,240 170,120 140,120 0,180" fill="#334155" />
                  <polygon points="400,240 230,120 260,120 400,180" fill="#334155" />
                  {/* Center road divider dashes */}
                  <line
                    x1="200"
                    y1="125"
                    x2="200"
                    y2="240"
                    stroke="#f1f5f9"
                    strokeWidth="2"
                    strokeDasharray="12 12"
                  />

                  {/* Real camera image from uploaded .zip or CVAT when available */}
                  {cam.image_url && (
                    <image
                      href={resolveImageUrl(cam.image_url)}
                      x="0"
                      y="0"
                      width="400"
                      height="240"
                      preserveAspectRatio="xMidYMid slice"
                    />
                  )}

                  {/* Overlaid 2D Bounding Boxes */}
                  {pboxes.map((pbox) => {
                    const isSelected = selectedBox?.id === pbox.box_id;
                    const isPCA = pbox.defect === "PCA_COLLAPSE";
                    const isZCut = pbox.defect === "Z_CUTOFF";

                    const stroke = isPCA
                      ? "#f43f5e"
                      : isZCut
                      ? "#f59e0b"
                      : "#10b981";
                    const fill = isPCA
                      ? "rgba(244, 63, 94, 0.25)"
                      : isZCut
                      ? "rgba(245, 158, 11, 0.2)"
                      : "rgba(16, 185, 129, 0.2)";

                    const bw = pbox.x2 - pbox.x1;
                    const bh = pbox.y2 - pbox.y1;

                    return (
                      <g
                        key={pbox.box_id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectBox(pbox.box_id);
                        }}
                        className="cursor-pointer transition-opacity hover:opacity-100"
                      >
                        <rect
                          x={pbox.x1}
                          y={pbox.y1}
                          width={bw}
                          height={bh}
                          fill={fill}
                          stroke={stroke}
                          strokeWidth={isSelected ? 2.5 : 1.5}
                          rx={2}
                        />
                        <rect
                          x={pbox.x1}
                          y={Math.max(2, pbox.y1 - 16)}
                          width={Math.min(120, bw + 20)}
                          height={14}
                          fill={stroke}
                          rx={3}
                        />
                        <text
                          x={pbox.x1 + 4}
                          y={Math.max(2, pbox.y1 - 16) + 10}
                          fill="#ffffff"
                          fontSize="9"
                          fontWeight="bold"
                          fontFamily="monospace"
                        >
                          {pbox.box_id}{" "}
                          {isPCA ? "[COLLAPSE]" : isZCut ? "[Z-CUT]" : ""}
                        </text>
                      </g>
                    );
                  })}
                </svg>

                {/* Hover Hint Pill */}
                <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/75 backdrop-blur-sm text-white px-2 py-0.5 rounded-full text-[10px] font-medium flex items-center gap-1 shadow">
                  <ZoomIn className="h-3 w-3" />
                  <span>Phóng to</span>
                </div>

                {/* Timestamp & FPS watermark */}
                <div className="absolute top-1 right-2 text-[8px] font-mono text-white/60 bg-black/40 px-1 rounded">
                  10 Hz • 1600x900
                </div>
              </div>
            </Card>
          );
        })}
        </div>
      </aside>

      {/* Fullscreen Camera Lightbox Modal */}
      {expandedCam && expandedCamIndex !== null && (
        <div
          className="fixed inset-0 z-[9999] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4 select-none animate-in fade-in duration-150"
          onClick={() => setExpandedCamIndex(null)}
        >
          {/* Top Modal Controls Bar */}
          <div
            className="w-full max-w-6xl bg-neutral-900/95 border border-neutral-700/80 rounded-2xl px-4 py-2.5 mb-3 flex items-center justify-between text-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Camera Selector Tabs */}
            <div className="flex items-center gap-2">
              <Camera className="h-4 w-4 text-emerald-400" />
              <div className="flex items-center gap-1 bg-neutral-800 p-1 rounded-xl">
                {cameras.map((c, i) => (
                  <button
                    key={c.cam_id}
                    onClick={() => {
                      setExpandedCamIndex(i);
                      setZoomLevel(1);
                    }}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                      i === expandedCamIndex
                        ? "bg-white text-neutral-900 shadow-sm"
                        : "text-neutral-300 hover:text-white hover:bg-neutral-700/60"
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Zoom & Overlay Controls */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowOverlayBoxes((v) => !v)}
                className={`h-8 rounded-xl text-xs gap-1.5 border-neutral-700 ${
                  showOverlayBoxes
                    ? "bg-emerald-600/20 text-emerald-300 border-emerald-500/50"
                    : "bg-neutral-800 text-neutral-400"
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
                <span>Khung 2D ({showOverlayBoxes ? "Bật" : "Tắt"})</span>
              </Button>

              <div className="flex items-center gap-1 bg-neutral-800 px-2 py-1 rounded-xl border border-neutral-700 font-mono text-xs">
                <button
                  onClick={() => setZoomLevel((z) => Math.max(1, Number((z - 0.5).toFixed(1))))}
                  className="p-1 hover:bg-neutral-700 rounded text-neutral-200"
                  title="Thu nhỏ"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <span className="px-2 min-w-[48px] text-center font-bold">
                  {Math.round(zoomLevel * 100)}%
                </span>
                <button
                  onClick={() => setZoomLevel((z) => Math.min(3, Number((z + 0.5).toFixed(1))))}
                  className="p-1 hover:bg-neutral-700 rounded text-neutral-200"
                  title="Phóng to"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
                {zoomLevel !== 1 && (
                  <button
                    onClick={() => setZoomLevel(1)}
                    className="p-1 hover:bg-neutral-700 rounded text-neutral-400 hover:text-white"
                    title="Đặt lại 100%"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                )}
              </div>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => setExpandedCamIndex(null)}
                className="h-8 w-8 rounded-xl bg-neutral-800 hover:bg-rose-600 text-neutral-200 hover:text-white"
                title="Đóng [ESC]"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Main Enlarged Image Canvas Container */}
          <div
            className="relative w-full max-w-6xl flex-1 bg-neutral-950 border border-neutral-800 rounded-2xl overflow-auto flex items-center justify-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Previous Camera Button */}
            {cameras.length > 1 && (
              <button
                onClick={() => {
                  setExpandedCamIndex(
                    (expandedCamIndex - 1 + cameras.length) % cameras.length
                  );
                  setZoomLevel(1);
                }}
                className="absolute left-4 z-20 h-11 w-11 rounded-full bg-black/65 hover:bg-black/90 border border-white/15 text-white flex items-center justify-center shadow-xl transition"
                title="Camera trước [←]"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
            )}

            {/* Enlarged SVG / Camera Image */}
            <div
              className="transition-transform duration-150 ease-out flex items-center justify-center w-full h-full p-2"
              style={{
                transform: `scale(${zoomLevel})`,
                transformOrigin: "center center",
              }}
            >
              <svg
                viewBox="0 0 400 240"
                className="w-full h-full max-h-[78vh] object-contain rounded-xl"
              >
                {/* Fallback synthetic road if no image_url */}
                <rect x="0" y="0" width="400" height="120" fill="#334155" />
                <rect
                  x="0"
                  y="110"
                  width="400"
                  height="20"
                  fill="#475569"
                  opacity="0.6"
                />
                <polygon points="0,240 400,240 230,120 170,120" fill="#1e293b" />
                <polygon points="0,240 170,120 140,120 0,180" fill="#334155" />
                <polygon points="400,240 230,120 260,120 400,180" fill="#334155" />
                <line
                  x1="200"
                  y1="125"
                  x2="200"
                  y2="240"
                  stroke="#f1f5f9"
                  strokeWidth="2"
                  strokeDasharray="12 12"
                />

                {/* High-res Camera Image */}
                {expandedCam.image_url && (
                  <image
                    href={resolveImageUrl(expandedCam.image_url)}
                    x="0"
                    y="0"
                    width="400"
                    height="240"
                    preserveAspectRatio="xMidYMid meet"
                  />
                )}

                {/* 2D Bounding Boxes Overlay */}
                {showOverlayBoxes &&
                  expandedPBoxes.map((pbox) => {
                    const isSelected = selectedBox?.id === pbox.box_id;
                    const isPCA = pbox.defect === "PCA_COLLAPSE";
                    const isZCut = pbox.defect === "Z_CUTOFF";

                    const stroke = isPCA
                      ? "#f43f5e"
                      : isZCut
                      ? "#f59e0b"
                      : "#10b981";
                    const fill = isPCA
                      ? "rgba(244, 63, 94, 0.22)"
                      : isZCut
                      ? "rgba(245, 158, 11, 0.18)"
                      : "rgba(16, 185, 129, 0.18)";

                    const bw = pbox.x2 - pbox.x1;
                    const bh = pbox.y2 - pbox.y1;

                    return (
                      <g
                        key={pbox.box_id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectBox(pbox.box_id);
                        }}
                        className="cursor-pointer"
                      >
                        <rect
                          x={pbox.x1}
                          y={pbox.y1}
                          width={bw}
                          height={bh}
                          fill={fill}
                          stroke={stroke}
                          strokeWidth={isSelected ? 2 : 1.2}
                          rx={2}
                        />
                        <rect
                          x={pbox.x1}
                          y={Math.max(2, pbox.y1 - 14)}
                          width={Math.min(115, bw + 20)}
                          height={12}
                          fill={stroke}
                          rx={2.5}
                        />
                        <text
                          x={pbox.x1 + 3}
                          y={Math.max(2, pbox.y1 - 14) + 9}
                          fill="#ffffff"
                          fontSize="7.5"
                          fontWeight="bold"
                          fontFamily="monospace"
                        >
                          {pbox.box_id}{" "}
                          {isPCA ? "[COLLAPSE]" : isZCut ? "[Z-CUT]" : ""}
                        </text>
                      </g>
                    );
                  })}
              </svg>
            </div>

            {/* Next Camera Button */}
            {cameras.length > 1 && (
              <button
                onClick={() => {
                  setExpandedCamIndex((expandedCamIndex + 1) % cameras.length);
                  setZoomLevel(1);
                }}
                className="absolute right-4 z-20 h-11 w-11 rounded-full bg-black/65 hover:bg-black/90 border border-white/15 text-white flex items-center justify-center shadow-xl transition"
                title="Camera tiếp theo [→]"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            )}

            {/* Bottom Info Bar */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/70 backdrop-blur-md border border-white/10 px-4 py-1.5 rounded-full text-xs text-neutral-300 font-mono flex items-center gap-3">
              <span className="font-semibold text-white">{expandedCam.name}</span>
              <span>•</span>
              <span>FOV 70° • 1600×900</span>
              <span>•</span>
              <span className="text-neutral-400">
                Phím [←/→] chuyển camera • [ESC] đóng
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
