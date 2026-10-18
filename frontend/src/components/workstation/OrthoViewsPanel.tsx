import React, { useMemo, useRef, useState, useEffect } from "react";
import { BoundingBox3D } from "@/types/qc";
import { ZoomIn, ZoomOut, RotateCcw, Maximize2 } from "lucide-react";

interface OrthoViewsPanelProps {
  selectedBox?: BoundingBox3D;
  points: [number, number, number, number][];
  onAdjustBox?: (delta: {
    x?: number;
    y?: number;
    z?: number;
    yaw?: number;
    dx?: number;
    dy?: number;
    dz?: number;
  }) => void;
  onUpdateBox?: (boxId: string, patch: Partial<BoundingBox3D>) => void;
}

interface DragState {
  plane: "top" | "side" | "front";
  handle: "left" | "right" | "top" | "bottom" | "body";
  startX: number;
  startY: number;
  initialBox: BoundingBox3D;
}

interface OrthoCardProps {
  title: string;
  subTitle: string;
  box?: BoundingBox3D;
  plane: "top" | "side" | "front";
  croppedPoints: { u: number; v: number; intensity: number }[];
  onStartDrag: (
    e: React.MouseEvent,
    plane: "top" | "side" | "front",
    handle: "left" | "right" | "top" | "bottom" | "body"
  ) => void;
}

// Convert global LiDAR point (x, y, z) into local coordinates of the box
// Local coordinate:
// u: Along dy (heading forward/backward) or dx (lateral right/left)
// v: Along dz (vertical height up/down)
const OrthoCard: React.FC<OrthoCardProps> = ({
  title,
  subTitle,
  box,
  plane,
  croppedPoints,
  onStartDrag,
}) => {
  const isCollapsed = Boolean(box && box.dz < 0.05 && (plane === "side" || plane === "front"));

  // Scale: pixels per meter.
  // Canvas: 240 x 100, Center: (120, 50)
  // Auto-fit scale based on box dimensions
  const scale = useMemo(() => {
    if (!box) return 18;
    const maxDim = Math.max(box.dx, box.dy, box.dz, 2.5);
    return Math.min(32, Math.max(12, 100 / (maxDim * 1.5)));
  }, [box?.dx, box?.dy, box?.dz]);

  const centerX = 120;
  const centerY = 50;

  // Compute 2D box width and height on this orthographic plane
  // plane == "top": X-axis is dx (width lateral), Y-axis is dy (length forward)
  // plane == "side": X-axis is dy (length forward), Y-axis is dz (height vertical)
  // plane == "front": X-axis is dx (width lateral), Y-axis is dz (height vertical)
  let boxW = 0;
  let boxH = 0;
  let labelX = "--";
  let labelY = "--";

  if (box) {
    if (plane === "top") {
      boxW = box.dx * scale;
      boxH = box.dy * scale;
      labelX = `Rộng: ${box.dx.toFixed(2)}m`;
      labelY = `Dài: ${box.dy.toFixed(2)}m`;
    } else if (plane === "side") {
      boxW = box.dy * scale;
      boxH = Math.max(3, box.dz * scale);
      labelX = `Dài: ${box.dy.toFixed(2)}m`;
      labelY = `Cao: ${box.dz.toFixed(2)}m`;
    } else if (plane === "front") {
      boxW = box.dx * scale;
      boxH = Math.max(3, box.dz * scale);
      labelX = `Rộng: ${box.dx.toFixed(2)}m`;
      labelY = `Cao: ${box.dz.toFixed(2)}m`;
    }
  }

  const strokeColor =
    box?.defect_type === "PCA_COLLAPSE"
      ? "#f43f5e"
      : box?.defect_type === "Z_CUTOFF"
      ? "#f59e0b"
      : "#10b981";

  const boxLeft = centerX - boxW / 2;
  const boxTop = centerY - boxH / 2;

  return (
    <div className="flex-1 bg-white dark:bg-[#0d131f] rounded-2xl border border-neutral-200/80 dark:border-neutral-800 shadow-sm overflow-hidden flex flex-col min-w-0">
      {/* Header */}
      <div className="h-7 bg-white dark:bg-[#0d131f] border-b border-neutral-100 dark:border-neutral-800 px-3 flex items-center justify-between text-[11px] text-neutral-600 dark:text-neutral-300">
        <div className="flex items-center gap-1.5 font-medium">
          <span className="font-semibold text-neutral-900 dark:text-white">{title}</span>
          <span className="text-[10px] text-neutral-400 font-normal">({subTitle})</span>
        </div>
        <div className="flex items-center gap-2 font-mono text-[9px] text-neutral-500">
          <span className="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-700 dark:text-neutral-300 font-bold">
            {labelX} × {labelY}
          </span>
          <span className="text-emerald-500 font-semibold">
            {croppedPoints.length} pts
          </span>
        </div>
      </div>

      {/* 2D Canvas Area */}
      <div className="flex-1 relative bg-[#14171f] flex items-center justify-center p-1 overflow-hidden select-none">
        {/* Subtle coordinate grid background */}
        <div
          className="absolute inset-0 opacity-15 pointer-events-none"
          style={{
            backgroundImage: "radial-gradient(circle, #64748b 1px, transparent 1px)",
            backgroundSize: "12px 12px",
          }}
        />

        <svg viewBox="0 0 240 100" className="w-full h-full max-h-24 select-none">
          {/* Ground reference line for Side and Front */}
          {(plane === "side" || plane === "front") && (
            <line
              x1="10"
              y1={centerY + boxH / 2}
              x2="230"
              y2={centerY + boxH / 2}
              stroke="#475569"
              strokeDasharray="3 3"
              strokeWidth="0.8"
            />
          )}

          {/* Center axes */}
          <line
            x1={centerX}
            y1="6"
            x2={centerX}
            y2="94"
            stroke="#334155"
            strokeWidth="0.6"
            strokeDasharray="2 2"
          />
          <line
            x1="15"
            y1={centerY}
            x2="225"
            y2={centerY}
            stroke="#334155"
            strokeWidth="0.6"
            strokeDasharray="2 2"
          />

          {/* Actual LiDAR point cloud cropped inside & near this box */}
          {croppedPoints.map((pt, i) => {
            const px = centerX + pt.u * scale;
            const py = centerY - pt.v * scale;
            if (px < 0 || px > 240 || py < 0 || py > 100) return null;

            return (
              <circle
                key={i}
                cx={px}
                cy={py}
                r={1.2}
                fill={
                  pt.v < -0.4 && (plane === "side" || plane === "front")
                    ? "#f59e0b"
                    : "#38bdf8"
                }
                opacity={0.85}
              />
            );
          })}

          {/* 2D Bounding Box Body */}
          {box && (
            <g>
              {/* Drag Body to adjust position */}
              <rect
                x={boxLeft}
                y={boxTop}
                width={Math.max(4, boxW)}
                height={Math.max(4, boxH)}
                fill={strokeColor}
                fillOpacity={isCollapsed ? 0.35 : 0.14}
                stroke={strokeColor}
                strokeWidth={isCollapsed ? 2 : 1.4}
                rx={1.5}
                className="cursor-move"
                onMouseDown={(e) => onStartDrag(e, plane, "body")}
              />

              {/* Heading direction arrow for Top View */}
              {plane === "top" && (
                <polygon
                  points={`${centerX},${boxTop - 6} ${centerX - 4},${boxTop} ${centerX + 4},${boxTop}`}
                  fill={strokeColor}
                />
              )}

              {/* Interactive Resize Handles on Left, Right, Top, Bottom */}
              {/* Left Handle */}
              <line
                x1={boxLeft}
                y1={boxTop + 2}
                x2={boxLeft}
                y2={boxTop + boxH - 2}
                stroke={strokeColor}
                strokeWidth={4}
                className="cursor-ew-resize hover:stroke-white transition-colors"
                onMouseDown={(e) => onStartDrag(e, plane, "left")}
              />
              <rect
                x={boxLeft - 2.5}
                y={centerY - 4}
                width={5}
                height={8}
                fill="#ffffff"
                stroke={strokeColor}
                strokeWidth={1}
                rx={1}
                className="cursor-ew-resize hover:scale-125 transition-transform"
                onMouseDown={(e) => onStartDrag(e, plane, "left")}
              />

              {/* Right Handle */}
              <line
                x1={boxLeft + boxW}
                y1={boxTop + 2}
                x2={boxLeft + boxW}
                y2={boxTop + boxH - 2}
                stroke={strokeColor}
                strokeWidth={4}
                className="cursor-ew-resize hover:stroke-white transition-colors"
                onMouseDown={(e) => onStartDrag(e, plane, "right")}
              />
              <rect
                x={boxLeft + boxW - 2.5}
                y={centerY - 4}
                width={5}
                height={8}
                fill="#ffffff"
                stroke={strokeColor}
                strokeWidth={1}
                rx={1}
                className="cursor-ew-resize hover:scale-125 transition-transform"
                onMouseDown={(e) => onStartDrag(e, plane, "right")}
              />

              {/* Top Handle */}
              <line
                x1={boxLeft + 2}
                y1={boxTop}
                x2={boxLeft + boxW - 2}
                y2={boxTop}
                stroke={strokeColor}
                strokeWidth={4}
                className="cursor-ns-resize hover:stroke-white transition-colors"
                onMouseDown={(e) => onStartDrag(e, plane, "top")}
              />
              <rect
                x={centerX - 4}
                y={boxTop - 2.5}
                width={8}
                height={5}
                fill="#ffffff"
                stroke={strokeColor}
                strokeWidth={1}
                rx={1}
                className="cursor-ns-resize hover:scale-125 transition-transform"
                onMouseDown={(e) => onStartDrag(e, plane, "top")}
              />

              {/* Bottom Handle */}
              <line
                x1={boxLeft + 2}
                y1={boxTop + boxH}
                x2={boxLeft + boxW - 2}
                y2={boxTop + boxH}
                stroke={strokeColor}
                strokeWidth={4}
                className="cursor-ns-resize hover:stroke-white transition-colors"
                onMouseDown={(e) => onStartDrag(e, plane, "bottom")}
              />
              <rect
                x={centerX - 4}
                y={boxTop + boxH - 2.5}
                width={8}
                height={5}
                fill="#ffffff"
                stroke={strokeColor}
                strokeWidth={1}
                rx={1}
                className="cursor-ns-resize hover:scale-125 transition-transform"
                onMouseDown={(e) => onStartDrag(e, plane, "bottom")}
              />
            </g>
          )}

          {/* Severe Collapse Warning Tag */}
          {isCollapsed && (
            <g>
              <rect
                x="55"
                y="8"
                width="130"
                height="16"
                rx="4"
                fill="#881337"
                stroke="#f43f5e"
                strokeWidth="0.8"
              />
              <text
                x="120"
                y="19"
                fill="#ffffff"
                fontSize="7.5"
                fontWeight="bold"
                textAnchor="middle"
                fontFamily="monospace"
              >
                PCA COLLAPSED: h = {box?.dz.toFixed(3)}m
              </text>
            </g>
          )}
        </svg>

        {/* Tip pill */}
        <span className="absolute bottom-1 right-2 text-[8px] font-mono text-neutral-400 bg-black/40 px-1 rounded pointer-events-none">
          Kéo cạnh để chỉnh cỡ • Kéo tâm để dịch
        </span>
      </div>
    </div>
  );
};

export const OrthoViewsPanel: React.FC<OrthoViewsPanelProps> = ({
  selectedBox,
  points,
  onAdjustBox,
  onUpdateBox,
}) => {
  const [dragState, setDragState] = useState<DragState | null>(null);

  // Crop and project LiDAR points into the selected box's local coordinate system
  const { topPoints, sidePoints, frontPoints } = useMemo(() => {
    if (!selectedBox || !points || points.length === 0) {
      return { topPoints: [], sidePoints: [], frontPoints: [] };
    }

    const { x: bx, y: by, z: bz, dx, dy, dz, rotation_yaw } = selectedBox;
    const cosY = Math.cos(rotation_yaw);
    const sinY = Math.sin(rotation_yaw);

    // Expand margin by 25% around box to show nearby edge points
    const marginX = dx * 0.65;
    const marginY = dy * 0.65;
    const marginZ = dz * 0.65;

    const top: { u: number; v: number; intensity: number }[] = [];
    const side: { u: number; v: number; intensity: number }[] = [];
    const front: { u: number; v: number; intensity: number }[] = [];

    const maxPts = 450;
    let count = 0;

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (!p || p.length < 3) continue;
      const px = p[0];
      const py = p[1];
      const pz = p[2];

      // Shift to box center
      const dxRel = px - bx;
      const dyRel = py - by;
      const dzRel = pz - bz;

      // Rotate by box yaw to align with box axes
      // localX is lateral (width dx)
      // localY is forward (length dy)
      const localX = cosY * dxRel + sinY * dyRel;
      const localY = -sinY * dxRel + cosY * dyRel;
      const localZ = dzRel;

      // Check if within box boundaries (plus margin)
      if (
        Math.abs(localX) <= marginX &&
        Math.abs(localY) <= marginY &&
        Math.abs(localZ) <= marginZ
      ) {
        // Top View: u = localX (width), v = localY (length forward)
        top.push({ u: localX, v: localY, intensity: p[3] ?? 0.5 });
        // Side View: u = localY (length), v = localZ (height)
        side.push({ u: localY, v: localZ, intensity: p[3] ?? 0.5 });
        // Front View: u = localX (width), v = localZ (height)
        front.push({ u: localX, v: localZ, intensity: p[3] ?? 0.5 });

        count++;
        if (count >= maxPts) break;
      }
    }

    return { topPoints: top, sidePoints: side, frontPoints: front };
  }, [
    selectedBox?.id,
    selectedBox?.x,
    selectedBox?.y,
    selectedBox?.z,
    selectedBox?.dx,
    selectedBox?.dy,
    selectedBox?.dz,
    selectedBox?.rotation_yaw,
    points,
  ]);

  const handleStartDrag = (
    e: React.MouseEvent,
    plane: "top" | "side" | "front",
    handle: "left" | "right" | "top" | "bottom" | "body"
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedBox) return;

    setDragState({
      plane,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      initialBox: { ...selectedBox },
    });
  };

  // Mouse move and mouse up listeners for interactive dragging
  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaScreenX = e.clientX - dragState.startX;
      const deltaScreenY = e.clientY - dragState.startY;

      // Sensitivity factor (meters per pixel)
      const meterPerPx = 0.04;
      const dX = deltaScreenX * meterPerPx;
      const dY = -deltaScreenY * meterPerPx;

      const init = dragState.initialBox;
      const patch: Partial<BoundingBox3D> = {};

      if (dragState.plane === "top") {
        // Top view: horizontal is dx (width), vertical is dy (length)
        if (dragState.handle === "left" || dragState.handle === "right") {
          const factor = dragState.handle === "right" ? 1 : -1;
          patch.dx = Math.max(0.2, Number((init.dx + dX * factor * 2).toFixed(2)));
        } else if (dragState.handle === "top" || dragState.handle === "bottom") {
          const factor = dragState.handle === "top" ? 1 : -1;
          patch.dy = Math.max(0.2, Number((init.dy + dY * factor * 2).toFixed(2)));
        } else if (dragState.handle === "body") {
          // Move local position rotated by yaw
          const cosY = Math.cos(init.rotation_yaw);
          const sinY = Math.sin(init.rotation_yaw);
          patch.x = Number((init.x + cosY * dX - sinY * dY).toFixed(2));
          patch.y = Number((init.y + sinY * dX + cosY * dY).toFixed(2));
        }
      } else if (dragState.plane === "side") {
        // Side view: horizontal is dy (length), vertical is dz (height)
        if (dragState.handle === "left" || dragState.handle === "right") {
          const factor = dragState.handle === "right" ? 1 : -1;
          patch.dy = Math.max(0.2, Number((init.dy + dX * factor * 2).toFixed(2)));
        } else if (dragState.handle === "top" || dragState.handle === "bottom") {
          const factor = dragState.handle === "top" ? 1 : -1;
          patch.dz = Math.max(0.1, Number((init.dz + dY * factor * 2).toFixed(2)));
        } else if (dragState.handle === "body") {
          const cosY = Math.cos(init.rotation_yaw);
          const sinY = Math.sin(init.rotation_yaw);
          patch.x = Number((init.x - sinY * dX).toFixed(2));
          patch.y = Number((init.y + cosY * dX).toFixed(2));
          patch.z = Number((init.z + dY).toFixed(2));
        }
      } else if (dragState.plane === "front") {
        // Front view: horizontal is dx (width), vertical is dz (height)
        if (dragState.handle === "left" || dragState.handle === "right") {
          const factor = dragState.handle === "right" ? 1 : -1;
          patch.dx = Math.max(0.2, Number((init.dx + dX * factor * 2).toFixed(2)));
        } else if (dragState.handle === "top" || dragState.handle === "bottom") {
          const factor = dragState.handle === "top" ? 1 : -1;
          patch.dz = Math.max(0.1, Number((init.dz + dY * factor * 2).toFixed(2)));
        } else if (dragState.handle === "body") {
          const cosY = Math.cos(init.rotation_yaw);
          const sinY = Math.sin(init.rotation_yaw);
          patch.x = Number((init.x + cosY * dX).toFixed(2));
          patch.y = Number((init.y + sinY * dX).toFixed(2));
          patch.z = Number((init.z + dY).toFixed(2));
        }
      }

      if (Object.keys(patch).length > 0 && onUpdateBox) {
        onUpdateBox(init.id, patch);
      }
    };

    const handleMouseUp = () => {
      setDragState(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragState, onUpdateBox]);

  // CVAT-style context points: include all points in a full 360-degree radius around the vehicle
  const contextPoints = useMemo(() => {
    if (!selectedBox || !points || points.length === 0) return { top: [], side: [], front: [] };
    const { x: bx, y: by, z: bz, rotation_yaw } = selectedBox;
    const cosY = Math.cos(rotation_yaw);
    const sinY = Math.sin(rotation_yaw);

    const maxRadius = 55.0; // 55 meters radius for complete 360-degree LiDAR sweep
    const maxZ = 6.0;
    const result: {
      top: { u: number; v: number }[];
      side: { u: number; v: number }[];
      front: { u: number; v: number }[];
    } = {
      top: [],
      side: [],
      front: [],
    };

    // Subsample step if points is extremely large (e.g. > 15,000 points) to maintain 60 FPS
    const step = points.length > 25000 ? 2 : 1;

    for (let i = 0; i < points.length; i += step) {
      const p = points[i];
      if (!p || p.length < 3) continue;
      const px = p[0];
      const py = p[1];
      const pz = p[2];

      const dxRel = px - bx;
      const dyRel = py - by;
      const dzRel = pz - bz;

      if (dxRel * dxRel + dyRel * dyRel > maxRadius * maxRadius) continue;
      if (Math.abs(dzRel) > maxZ) continue;

      // Rotate point into box heading orientation
      const localX = cosY * dxRel + sinY * dyRel; // lateral
      const localY = -sinY * dxRel + cosY * dyRel; // forward

      result.top.push({ u: localX, v: localY });
      result.side.push({ u: localY, v: dzRel });
      result.front.push({ u: localX, v: dzRel });
    }

    return result;
  }, [selectedBox?.x, selectedBox?.y, selectedBox?.z, selectedBox?.rotation_yaw, points]);

  const [expandedPlane, setExpandedPlane] = useState<"top" | "side" | "front" | null>(null);
  const [modalZoom, setModalZoom] = useState<number>(1.2);
  const [modalPan, setModalPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Close modal on ESC, navigate with Left/Right
  useEffect(() => {
    if (!expandedPlane) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setExpandedPlane(null);
      } else if (e.key === "ArrowLeft") {
        e.stopPropagation();
        setExpandedPlane((prev) =>
          prev === "top" ? "front" : prev === "front" ? "side" : "top"
        );
      } else if (e.key === "ArrowRight") {
        e.stopPropagation();
        setExpandedPlane((prev) =>
          prev === "top" ? "side" : prev === "side" ? "front" : "top"
        );
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [expandedPlane]);

  const planesConfig = [
    {
      plane: "top" as const,
      title: "Top",
      subTitle: "Bird's Eye (BEV)",
      points: topPoints,
      context: contextPoints?.top || [],
    },
    {
      plane: "side" as const,
      title: "Side",
      subTitle: "Profile View",
      points: sidePoints,
      context: contextPoints?.side || [],
    },
    {
      plane: "front" as const,
      title: "Front",
      subTitle: "Heading View",
      points: frontPoints,
      context: contextPoints?.front || [],
    },
  ];

  const currentExpandedConfig = planesConfig.find((p) => p.plane === expandedPlane);

  return (
    <>
      <div className="w-full h-[28%] flex gap-2 shrink-0 select-none">
        {planesConfig.map((cfg) => (
          <div
            key={cfg.plane}
            className="flex-1 flex min-w-0 relative group"
            onDoubleClick={() => {
              setExpandedPlane(cfg.plane);
              setModalZoom(1.2);
              setModalPan({ x: 0, y: 0 });
            }}
          >
            <OrthoCard
              title={cfg.title}
              subTitle={cfg.subTitle}
              box={selectedBox}
              plane={cfg.plane}
              croppedPoints={cfg.points}
              onStartDrag={handleStartDrag}
            />
            {/* Quick Enlarge Button */}
            <button
              onClick={() => {
                setExpandedPlane(cfg.plane);
                setModalZoom(1.2);
                setModalPan({ x: 0, y: 0 });
              }}
              className="absolute top-1.5 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-300 shadow-sm"
              title="Phóng to theo chuẩn CVAT"
            >
              <Maximize2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      {/* CVAT Authentic Fullscreen Orthographic View Modal */}
      {expandedPlane && currentExpandedConfig && selectedBox && (() => {
        // Compute 2D SVG box dimensions in CVAT modal
        // CVAT canvas viewbox: 800 x 500, Center: (400, 250)
        const modalScale = 32 * modalZoom;
        const cX = 400 + modalPan.x;
        const cY = 250 + modalPan.y;

        let bW = selectedBox.dx * modalScale;
        let bH = selectedBox.dy * modalScale;
        if (expandedPlane === "side") {
          bW = selectedBox.dy * modalScale;
          bH = Math.max(6, selectedBox.dz * modalScale);
        } else if (expandedPlane === "front") {
          bW = selectedBox.dx * modalScale;
          bH = Math.max(6, selectedBox.dz * modalScale);
        }

        const bLeft = cX - bW / 2;
        const bTop = cY - bH / 2;
        const bRight = bLeft + bW;
        const bBottom = bTop + bH;

        return (
          <div
            className="fixed inset-0 z-[9999] bg-black flex flex-col select-none overflow-hidden animate-in fade-in duration-100"
            onWheel={(e) => {
              e.preventDefault();
              const delta = e.deltaY > 0 ? -0.15 : 0.15;
              setModalZoom((z) => Math.max(0.4, Math.min(4.0, Number((z + delta).toFixed(2)))));
            }}
          >
            {/* CVAT Top Title Bar */}
            <div className="h-8 bg-[#e2e8f0] dark:bg-[#1e293b] text-neutral-800 dark:text-neutral-200 px-3 flex items-center justify-between text-xs font-sans border-b border-neutral-300 dark:border-neutral-700">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setExpandedPlane(null)}
                  className="p-1 hover:bg-neutral-300 dark:hover:bg-neutral-700 rounded text-neutral-600 dark:text-neutral-300"
                  title="Thu nhỏ / Đóng [ESC]"
                >
                  <Maximize2 className="h-3.5 w-3.5 rotate-180" />
                </button>
                <div className="flex items-center gap-1 font-semibold">
                  <span>Góc nhìn CVAT:</span>
                  <div className="flex items-center bg-white dark:bg-neutral-900 rounded p-0.5 border border-neutral-300 dark:border-neutral-700">
                    {planesConfig.map((p) => (
                      <button
                        key={p.plane}
                        onClick={() => {
                          setExpandedPlane(p.plane);
                          setModalPan({ x: 0, y: 0 });
                        }}
                        className={`px-2.5 py-0.5 rounded text-[11px] font-bold transition ${
                          p.plane === expandedPlane
                            ? "bg-[#2563eb] text-white shadow-xs"
                            : "text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white"
                        }`}
                      >
                        {p.title}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="font-bold text-sm tracking-wide text-neutral-900 dark:text-white">
                {currentExpandedConfig.title}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setExpandedPlane(null)}
                  className="px-2 py-0.5 rounded bg-neutral-200 dark:bg-neutral-700 hover:bg-rose-600 hover:text-white text-xs font-bold transition"
                  title="Đóng [ESC]"
                >
                  ✕ Đóng (ESC)
                </button>
              </div>
            </div>

            {/* CVAT Floating Toolbar at top center */}
            <div className="absolute top-10 left-1/2 -translate-x-1/2 z-20 flex items-center bg-white/95 dark:bg-neutral-800/95 border border-neutral-300 dark:border-neutral-700 rounded shadow-md px-1 py-0.5 gap-1 text-xs">
              <button
                onClick={() => {
                  setModalZoom(1.2);
                  setModalPan({ x: 0, y: 0 });
                }}
                className="p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded text-neutral-700 dark:text-neutral-200"
                title="Khôi phục góc nhìn"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setModalZoom((z) => Math.min(4.0, Number((z + 0.2).toFixed(1))))}
                className="p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded text-neutral-700 dark:text-neutral-200"
                title="Phóng to (+)"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setModalZoom((z) => Math.max(0.4, Number((z - 0.2).toFixed(1))))}
                className="p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded text-neutral-700 dark:text-neutral-200"
                title="Thu nhỏ (-)"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <span className="text-[10px] font-mono px-1 font-semibold text-neutral-600 dark:text-neutral-400">
                {Math.round(modalZoom * 100)}%
              </span>
            </div>

            {/* Main Pure Black CVAT Canvas */}
            <div
              className={`flex-1 relative bg-black overflow-hidden flex items-center justify-center ${
                isPanning ? "cursor-grabbing" : "cursor-grab"
              }`}
              onMouseDown={(e) => {
                if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === "svg") {
                  setIsPanning(true);
                  panStartRef.current = { x: e.clientX - modalPan.x, y: e.clientY - modalPan.y };
                }
              }}
              onMouseMove={(e) => {
                if (isPanning) {
                  setModalPan({
                    x: e.clientX - panStartRef.current.x,
                    y: e.clientY - panStartRef.current.y,
                  });
                }
              }}
              onMouseUp={() => setIsPanning(false)}
            >
              <svg
                viewBox="0 0 800 500"
                className="w-full h-full select-none"
                style={{ background: "#000000" }}
              >
                {/* 1. Surrounding Context LiDAR points (Scan Rings - Exactly as in CVAT screenshot) */}
                {currentExpandedConfig.context.map((pt, i) => {
                  const px = cX + pt.u * modalScale;
                  const py = cY - pt.v * modalScale;
                  if (px < -20 || px > 820 || py < -20 || py > 520) return null;

                  return (
                    <circle
                      key={i}
                      cx={px}
                      cy={py}
                      r={1.0}
                      fill="#e2e8f0"
                      opacity={0.7}
                    />
                  );
                })}

                {/* 2. CVAT Red Bounding Box Body */}
                <rect
                  x={bLeft}
                  y={bTop}
                  width={bW}
                  height={bH}
                  fill="#7f1d1d"
                  fillOpacity={0.65}
                  stroke="#ef4444"
                  strokeWidth={1.8}
                  className="cursor-move"
                  onMouseDown={(e) => handleStartDrag(e, expandedPlane, "body")}
                />

                {/* 3. Heading Orientation Indicator (Green Dot on top edge - exactly as in CVAT screenshot) */}
                {expandedPlane === "top" && (
                  <circle
                    cx={cX}
                    cy={bTop - 12}
                    r={3.5}
                    fill="#10b981"
                    stroke="#ffffff"
                    strokeWidth={0.8}
                  />
                )}

                {/* 4. CVAT Red Corner Anchor Dots (at all 4 corners) */}
                {/* Top-Left */}
                <circle
                  cx={bLeft}
                  cy={bTop}
                  r={3.5}
                  fill="#ef4444"
                  stroke="#ffffff"
                  strokeWidth={1}
                  className="cursor-nwse-resize hover:scale-150 transition-transform"
                  onMouseDown={(e) => handleStartDrag(e, expandedPlane, "left")}
                />
                {/* Top-Right */}
                <circle
                  cx={bRight}
                  cy={bTop}
                  r={3.5}
                  fill="#ef4444"
                  stroke="#ffffff"
                  strokeWidth={1}
                  className="cursor-nesw-resize hover:scale-150 transition-transform"
                  onMouseDown={(e) => handleStartDrag(e, expandedPlane, "right")}
                />
                {/* Bottom-Left */}
                <circle
                  cx={bLeft}
                  cy={bBottom}
                  r={3.5}
                  fill="#ef4444"
                  stroke="#ffffff"
                  strokeWidth={1}
                  className="cursor-nesw-resize hover:scale-150 transition-transform"
                  onMouseDown={(e) => handleStartDrag(e, expandedPlane, "left")}
                />
                {/* Bottom-Right */}
                <circle
                  cx={bRight}
                  cy={bBottom}
                  r={3.5}
                  fill="#ef4444"
                  stroke="#ffffff"
                  strokeWidth={1}
                  className="cursor-nwse-resize hover:scale-150 transition-transform"
                  onMouseDown={(e) => handleStartDrag(e, expandedPlane, "right")}
                />

                {/* 5. Edge Drag Handles */}
                {/* Left */}
                <line
                  x1={bLeft}
                  y1={bTop}
                  x2={bLeft}
                  y2={bBottom}
                  stroke="transparent"
                  strokeWidth={10}
                  className="cursor-ew-resize"
                  onMouseDown={(e) => handleStartDrag(e, expandedPlane, "left")}
                />
                {/* Right */}
                <line
                  x1={bRight}
                  y1={bTop}
                  x2={bRight}
                  y2={bBottom}
                  stroke="transparent"
                  strokeWidth={10}
                  className="cursor-ew-resize"
                  onMouseDown={(e) => handleStartDrag(e, expandedPlane, "right")}
                />
                {/* Top */}
                <line
                  x1={bLeft}
                  y1={bTop}
                  x2={bRight}
                  y2={bTop}
                  stroke="transparent"
                  strokeWidth={10}
                  className="cursor-ns-resize"
                  onMouseDown={(e) => handleStartDrag(e, expandedPlane, "top")}
                />
                {/* Bottom */}
                <line
                  x1={bLeft}
                  y1={bBottom}
                  x2={bRight}
                  y2={bBottom}
                  stroke="transparent"
                  strokeWidth={10}
                  className="cursor-ns-resize"
                  onMouseDown={(e) => handleStartDrag(e, expandedPlane, "bottom")}
                />
              </svg>

              {/* Bottom Info HUD */}
              <div className="absolute bottom-2 left-4 bg-black/75 border border-white/20 rounded px-3 py-1 font-mono text-[11px] text-white flex items-center gap-3 pointer-events-none">
                <span className="text-emerald-400 font-bold">{selectedBox.id}</span>
                <span>•</span>
                <span>
                  {expandedPlane === "top"
                    ? `L: ${selectedBox.dy.toFixed(2)}m × W: ${selectedBox.dx.toFixed(2)}m`
                    : expandedPlane === "side"
                    ? `L: ${selectedBox.dy.toFixed(2)}m × H: ${selectedBox.dz.toFixed(2)}m`
                    : `W: ${selectedBox.dx.toFixed(2)}m × H: ${selectedBox.dz.toFixed(2)}m`}
                </span>
                <span>•</span>
                <span className="text-neutral-400">
                  Cuộn chuột để Zoom • Kéo chuột để Pan • Kéo 4 chấm đỏ để chỉnh cỡ
                </span>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
};



