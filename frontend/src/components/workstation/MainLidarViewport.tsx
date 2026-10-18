import React, { useMemo, useRef, useState, useEffect } from "react";
import { Canvas, useThree, ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Line, Html, TransformControls } from "@react-three/drei";
import * as THREE from "three";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BoundingBox3D } from "@/types/qc";
import { ToolMode } from "@/components/workstation/LeftToolstrip";
import {
  AlertTriangle,
  Send,
  ExternalLink,
  CheckCircle2,
  Wrench,
  Crosshair,
  RefreshCw,
  FolderOpen,
  AlertOctagon,
  Layers,
  ServerOff,
  Server,
  UploadCloud,
  Plus,
  Move,
  RotateCw,
  Maximize2,
  Trash2,
} from "lucide-react";

export type UIWorkstationStatus =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED_NO_JOB"
  | "LOADING"
  | "READY"
  | "EMPTY"
  | "ERROR"
  | "UNSUPPORTED_FORMAT";

interface MainLidarViewportProps {
  points: [number, number, number, number][];
  boxes: BoundingBox3D[];
  selectedBoxId?: string;
  onSelectBox: (boxId: string) => void;
  onSendIssue: (box: BoundingBox3D) => void;
  onOpenCVAT: () => void;
  onFixPCA: (boxId: string) => void;
  showGroundPlane: boolean;
  currentTool: ToolMode;
  onSelectTool?: (tool: ToolMode) => void;
  resetViewSignal?: number;
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
  onCreateBox?: (coords?: { x: number; y: number; z: number; label?: string }) => void;
  onDeleteBox?: (boxId: string) => void;
  onNavigateFrame?: (step: number) => void;
  uiStatus?: UIWorkstationStatus;
  errorMessage?: string;
  onOpenCVATModal?: () => void;
  onOpenOverview?: () => void;
}

const DEFAULT_CLASS_DIMS: Record<string, { dx: number; dy: number; dz: number }> = {
  Car: { dx: 1.9, dy: 4.5, dz: 1.55 },
  Truck: { dx: 2.5, dy: 7.2, dz: 2.8 },
  Motorcycle: { dx: 0.85, dy: 2.1, dz: 1.4 },
  Bicycle: { dx: 0.65, dy: 1.75, dz: 1.35 },
  Pedestrian: { dx: 0.75, dy: 0.75, dz: 1.72 },
};

// LiDAR Point Cloud Subcomponent with z-cutoff ground plane highlighting
const PointCloudMesh: React.FC<{
  points: [number, number, number, number][];
  showGroundPlane: boolean;
}> = ({ points, showGroundPlane }) => {
  const geomRef = useRef<THREE.BufferGeometry>(null);

  const validPoints = useMemo(() => {
    if (!points || points.length === 0) return [];
    const res: [number, number, number, number][] = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (
        p &&
        p.length >= 3 &&
        p[0] !== null &&
        p[0] !== undefined &&
        !isNaN(p[0]) &&
        isFinite(p[0]) &&
        p[1] !== null &&
        p[1] !== undefined &&
        !isNaN(p[1]) &&
        isFinite(p[1]) &&
        p[2] !== null &&
        p[2] !== undefined &&
        !isNaN(p[2]) &&
        isFinite(p[2])
      ) {
        res.push(p);
      }
    }
    return res;
  }, [points]);

  const { positions, colors } = useMemo(() => {
    const pos = new Float32Array(validPoints.length * 3);
    const col = new Float32Array(validPoints.length * 3);

    for (let i = 0; i < validPoints.length; i++) {
      const [x, y, z] = validPoints[i];
      // nuScenes coordinate: x right, y forward, z up
      // Three.js: x right, y up, z back
      pos[i * 3] = x;
      pos[i * 3 + 1] = z;
      pos[i * 3 + 2] = -y;

      // When showGroundPlane (z-cutoff = -1.0m) is active, highlight points below z = -1.0m in warm amber/orange
      if (showGroundPlane && z < -1.0) {
        col[i * 3] = 0.98;
        col[i * 3 + 1] = 0.45;
        col[i * 3 + 2] = 0.15;
      } else {
        const normalizedHeight = Math.max(0, Math.min(1, (z + 2.0) / 3.0));
        if (normalizedHeight < 0.2) {
          col[i * 3] = 0.5;
          col[i * 3 + 1] = 0.6;
          col[i * 3 + 2] = 0.8;
        } else {
          col[i * 3] = 0.9;
          col[i * 3 + 1] = 0.95;
          col[i * 3 + 2] = 1.0;
        }
      }
    }

    return { positions: pos, colors: col };
  }, [validPoints, showGroundPlane]);

  useEffect(() => {
    if (geomRef.current) {
      geomRef.current.computeBoundingSphere();
    }
  }, [positions, colors]);

  if (validPoints.length === 0) return null;

  return (
    <points>
      <bufferGeometry ref={geomRef}>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.065}
        vertexColors
        transparent
        opacity={0.9}
        sizeAttenuation
      />
    </points>
  );
};

// Concentric LiDAR Range Rings (10m, 20m, 30m, 40m, 50m)
const LidarRings: React.FC = () => {
  const rings = useMemo(() => {
    const ringRadii = [10, 20, 30, 40, 50];
    const segments = 64;
    return ringRadii.map((r) => {
      const pts: [number, number, number][] = [];
      for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        pts.push([Math.cos(theta) * r, 0, Math.sin(theta) * r]);
      }
      return { r, pts };
    });
  }, []);

  return (
    <group position={[0, -1.6, 0]}>
      {rings.map(({ r, pts }) => (
        <group key={r}>
          <Line
            points={pts}
            color="#2a3b53"
            lineWidth={1}
            transparent
            opacity={0.45}
          />
        </group>
      ))}
    </group>
  );
};

// Camera Auto-Focus & Reset View Controller
const CameraFocusController: React.FC<{
  targetBox?: BoundingBox3D;
  focusCount: number;
  resetViewSignal: number;
}> = ({ targetBox, focusCount, resetViewSignal }) => {
  const { camera } = useThree();
  const controls = useThree((state) => (state as any).controls);

  // Focus on selected box when focusCount changes
  useEffect(() => {
    if (!targetBox || focusCount === 0) return;

    const targetX = targetBox.x;
    const targetY = targetBox.z;
    const targetZ = -targetBox.y;

    if (controls && controls.target) {
      controls.target.set(targetX, targetY, targetZ);
      controls.update();
    }

    const span = Math.max(targetBox.dx, targetBox.dy, 3.5);
    const offset = Math.max(6.5, span * 1.8);

    camera.position.set(
      targetX + offset * 0.7,
      targetY + offset * 0.65,
      targetZ + offset * 0.85
    );
    camera.lookAt(targetX, targetY, targetZ);
  }, [targetBox?.id, focusCount, camera, controls]);

  // Reset global 3D view or re-center when user clicks Focus button / presses F or Space
  useEffect(() => {
    if (resetViewSignal === 0) return;

    if (targetBox) {
      const targetX = targetBox.x;
      const targetY = targetBox.z;
      const targetZ = -targetBox.y;
      if (controls && controls.target) {
        controls.target.set(targetX, targetY, targetZ);
        controls.update();
      }
      camera.position.set(targetX + 10, targetY + 9, targetZ + 12);
      camera.lookAt(targetX, targetY, targetZ);
    } else {
      if (controls && controls.target) {
        controls.target.set(0, 0, 0);
        controls.update();
      }
      camera.position.set(0, 22, 28);
      camera.lookAt(0, 0, 0);
    }
  }, [resetViewSignal, camera, controls]);

  return null;
};

// Interactive 3D Transform Gizmo for Translate [W], Rotate [E], Scale [R]
const SelectedBoxTransformGizmo: React.FC<{
  box: BoundingBox3D;
  currentTool: ToolMode;
  onUpdateBox?: (boxId: string, patch: Partial<BoundingBox3D>) => void;
}> = ({ box, currentTool, onUpdateBox }) => {
  const [proxyObj, setProxyObj] = useState<THREE.Group | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const initialDimsRef = useRef<{ dx: number; dy: number; dz: number }>({
    dx: box.dx,
    dy: box.dy,
    dz: box.dz,
  });

  const isTransformMode =
    currentTool === "translate" || currentTool === "rotate" || currentTool === "scale";

  // Keep proxy synced with box state whenever not actively dragging
  useEffect(() => {
    if (!proxyObj || isDraggingRef.current) return;
    proxyObj.position.set(box.x, box.z, -box.y);
    proxyObj.rotation.set(0, -box.rotation_yaw, 0);
    proxyObj.scale.set(1, 1, 1);
    initialDimsRef.current = {
      dx: Math.max(0.1, box.dx),
      dy: Math.max(0.1, box.dy),
      dz: Math.max(0.05, box.dz),
    };
  }, [proxyObj, box.id, box.x, box.y, box.z, box.dx, box.dy, box.dz, box.rotation_yaw, currentTool]);

  if (
    currentTool !== "translate" &&
    currentTool !== "rotate" &&
    currentTool !== "scale"
  ) {
    return null;
  }

  const commitProxyChange = () => {
    if (!proxyObj || !onUpdateBox) return;

    if (currentTool === "translate") {
      onUpdateBox(box.id, {
        x: Number(proxyObj.position.x.toFixed(3)),
        y: Number((-proxyObj.position.z).toFixed(3)),
        z: Number(proxyObj.position.y.toFixed(3)),
      });
    } else if (currentTool === "rotate") {
      onUpdateBox(box.id, {
        rotation_yaw: Number((-proxyObj.rotation.y).toFixed(3)),
      });
    } else if (currentTool === "scale") {
      const nextDx = Math.max(0.2, Number((initialDimsRef.current.dx * proxyObj.scale.x).toFixed(3)));
      const nextDz = Math.max(0.1, Number((initialDimsRef.current.dz * proxyObj.scale.y).toFixed(3)));
      const nextDy = Math.max(0.2, Number((initialDimsRef.current.dy * proxyObj.scale.z).toFixed(3)));
      proxyObj.scale.set(1, 1, 1);
      initialDimsRef.current = { dx: nextDx, dy: nextDy, dz: nextDz };
      onUpdateBox(box.id, {
        dx: nextDx,
        dy: nextDy,
        dz: nextDz,
      });
    }
  };

  return (
    <>
      <group
        ref={setProxyObj}
        position={[box.x, box.z, -box.y]}
        rotation={[0, -box.rotation_yaw, 0]}
      />
      {proxyObj && (
        <TransformControls
          object={proxyObj}
          mode={currentTool}
          size={0.85}
          showX={currentTool !== "rotate"}
          showY={true}
          showZ={currentTool !== "rotate"}
          onMouseDown={() => {
            isDraggingRef.current = true;
            initialDimsRef.current = {
              dx: Math.max(0.1, box.dx),
              dy: Math.max(0.1, box.dy),
              dz: Math.max(0.05, box.dz),
            };
          }}
          onObjectChange={() => {
            if (isDraggingRef.current) {
              commitProxyChange();
            }
          }}
          onMouseUp={() => {
            commitProxyChange();
            isDraggingRef.current = false;
          }}
        />
      )}
    </>
  );
};

// Interactive 3D Box Placement Plane when in "box3d" [B] mode
const BoxPlacementPlane: React.FC<{
  active: boolean;
  newBoxLabel: string;
  onPlaceBox: (coords: { x: number; y: number; z: number; label: string }) => void;
}> = ({ active, newBoxLabel, onPlaceBox }) => {
  const [hoverPos, setHoverPos] = useState<[number, number, number] | null>(null);
  const dims = DEFAULT_CLASS_DIMS[newBoxLabel] || DEFAULT_CLASS_DIMS.Car;

  if (!active) return null;

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHoverPos([e.point.x, -1.0 + dims.dz / 2, e.point.z]);
  };

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    // Convert Three.js [x, y, z] back to LiDAR [x, -z, y]
    const lidarX = Number(e.point.x.toFixed(2));
    const lidarY = Number((-e.point.z).toFixed(2));
    const lidarZ = Number((-1.0 + dims.dz / 2).toFixed(2));
    onPlaceBox({ x: lidarX, y: lidarY, z: lidarZ, label: newBoxLabel });
  };

  return (
    <group>
      {/* Invisible ground raycast plane at z = -1.0m */}
      <mesh
        position={[0, -1.0, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerMove={handlePointerMove}
        onPointerOut={() => setHoverPos(null)}
        onClick={handleClick}
      >
        <planeGeometry args={[160, 160]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>

      {/* Preview Ghost Cuboid following cursor */}
      {hoverPos && (
        <group position={hoverPos}>
          <mesh>
            <boxGeometry args={[dims.dx, dims.dz, dims.dy]} />
            <meshBasicMaterial color="#38bdf8" transparent opacity={0.28} depthWrite={false} />
          </mesh>
          <mesh>
            <boxGeometry args={[dims.dx, dims.dz, dims.dy]} />
            <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.85} />
          </mesh>
          <Html center position={[0, dims.dz / 2 + 0.6, 0]} distanceFactor={16}>
            <div className="px-2 py-0.5 rounded-full bg-sky-500 text-white text-[10px] font-mono font-bold whitespace-nowrap shadow-lg">
              Click để đặt {newBoxLabel} ({ hoverPos[0].toFixed(1) }m, { (-hoverPos[2]).toFixed(1) }m)
            </div>
          </Html>
        </group>
      )}
    </group>
  );
};

// Individual 3D Bounding Box Mesh with Wireframe, Heading, Ghost Box & Floating Pin
const Cuboid3DItem: React.FC<{
  box: BoundingBox3D;
  isSelected: boolean;
  onClick: () => void;
}> = ({ box, isSelected, onClick }) => {
  let boxColor = "#10b981"; // Easy: Emerald
  if (box.defect_type === "PCA_COLLAPSE") {
    boxColor = "#f43f5e"; // PCA Collapse: Red/Rose
  } else if (box.defect_type === "Z_CUTOFF") {
    boxColor = "#f59e0b"; // z-cutoff: Amber
  } else if (box.label.includes("Pedestrian")) {
    boxColor = "#38bdf8"; // Pedestrian: Sky
  }

  const isCollapsed = box.dz < 0.05;
  const safeDx = Math.max(0.1, Number.isFinite(box.dx) ? box.dx : 1.0);
  const safeDy = Math.max(0.1, Number.isFinite(box.dy) ? box.dy : 1.0);
  const safeDz = Number.isFinite(box.dz) ? box.dz : 1.0;
  const displayDz = Math.max(0.04, safeDz);
  const safeX = Number.isFinite(box.x) ? box.x : 0;
  const safeY = Number.isFinite(box.y) ? box.y : 0;
  const safeZ = Number.isFinite(box.z) ? box.z : 0;
  const safeYaw = Number.isFinite(box.rotation_yaw) ? box.rotation_yaw : 0;
  const position: [number, number, number] = [safeX, safeZ, -safeY];

  const geometries = useMemo(() => {
    const mainBox = new THREE.BoxGeometry(safeDx, displayDz, safeDy);
    const mainEdges = new THREE.EdgesGeometry(mainBox);
    let ghostBox: THREE.BoxGeometry | null = null;
    let ghostEdges: THREE.EdgesGeometry | null = null;
    if (isCollapsed) {
      ghostBox = new THREE.BoxGeometry(safeDx, 1.55, safeDy);
      ghostEdges = new THREE.EdgesGeometry(ghostBox);
    }
    return { mainBox, mainEdges, ghostBox, ghostEdges };
  }, [safeDx, safeDy, displayDz, isCollapsed]);

  useEffect(() => {
    return () => {
      geometries.mainBox.dispose();
      geometries.mainEdges.dispose();
      geometries.ghostBox?.dispose();
      geometries.ghostEdges?.dispose();
    };
  }, [geometries]);

  return (
    <group
      position={position}
      rotation={[0, -safeYaw, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {/* Ground Glowing Radar Target if selected */}
      {isSelected && (
        <group position={[0, -displayDz / 2, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry
              args={[
                Math.max(box.dx, box.dy) * 0.65,
                Math.max(box.dx, box.dy) * 0.85,
                32,
              ]}
            />
            <meshBasicMaterial
              color={boxColor}
              transparent
              opacity={0.7}
              side={THREE.DoubleSide}
            />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[Math.max(box.dx, box.dy) * 0.45, 32]} />
            <meshBasicMaterial
              color={boxColor}
              transparent
              opacity={0.15}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      )}

      {/* Ghost Bounding Box: If collapsed (dz < 0.05m), render what a normal 1.55m vehicle should look like */}
      {isCollapsed && geometries.ghostBox && geometries.ghostEdges && (
        <group position={[0, (1.55 - displayDz) / 2, 0]}>
          <lineSegments geometry={geometries.ghostEdges}>
            <lineBasicMaterial
              color="#f43f5e"
              transparent
              opacity={isSelected ? 0.65 : 0.3}
              linewidth={1}
            />
          </lineSegments>
          <mesh geometry={geometries.ghostBox}>
            <meshBasicMaterial
              color="#f43f5e"
              transparent
              opacity={0.06}
              depthWrite={false}
            />
          </mesh>
        </group>
      )}

      {/* Box Fill */}
      <mesh geometry={geometries.mainBox}>
        <meshStandardMaterial
          color={boxColor}
          transparent
          opacity={isSelected ? 0.45 : 0.2}
          depthWrite={false}
        />
      </mesh>

      {/* Wireframe Outline */}
      <lineSegments geometry={geometries.mainEdges}>
        <lineBasicMaterial
          color={isSelected ? "#ffffff" : boxColor}
          linewidth={isSelected ? 3 : 1.5}
        />
      </lineSegments>

      {/* Heading arrow pointing forward along dy */}
      <mesh
        position={[0, displayDz / 2, -box.dy / 2 - 0.3]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <coneGeometry args={[0.2, 0.5, 4]} />
        <meshBasicMaterial color={isSelected ? "#ffffff" : boxColor} />
      </mesh>

      {/* Floating 3D Label & Status Pin */}
      <Html
        center
        position={[0, (isCollapsed ? 1.55 : displayDz) / 2 + 0.8, 0]}
        distanceFactor={18}
        zIndexRange={[10, 0]}
      >
        <div
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          className={`cursor-pointer px-2.5 py-1 rounded-full text-[11px] font-bold shadow-2xl flex items-center gap-1.5 transition-all select-none border backdrop-blur-md ${
            isSelected
              ? "bg-rose-600 text-white border-white ring-2 ring-rose-400 scale-110 shadow-rose-500/50"
              : "bg-neutral-900/90 text-neutral-200 border-neutral-700 hover:scale-105"
          }`}
        >
          <span className="font-mono">{box.id}</span>
          <span className="text-[10px] bg-black/40 px-1.5 py-0.5 rounded font-mono">
            h={box.dz.toFixed(2)}m
          </span>
          {box.defect_type === "PCA_COLLAPSE" ? (
            <span className="text-[9px] bg-white text-rose-700 px-1 py-0.5 rounded font-extrabold uppercase">
              PCA COLLAPSE
            </span>
          ) : box.defect_type === "Z_CUTOFF" ? (
            <span className="text-[9px] bg-amber-400 text-neutral-900 px-1 py-0.5 rounded font-extrabold uppercase">
              Z-CUT
            </span>
          ) : null}
        </div>
      </Html>
    </group>
  );
};

export const MainLidarViewport: React.FC<MainLidarViewportProps> = ({
  points,
  boxes,
  selectedBoxId,
  onSelectBox,
  onSendIssue,
  onOpenCVAT,
  onFixPCA,
  showGroundPlane,
  currentTool,
  onSelectTool,
  resetViewSignal = 0,
  onAdjustBox,
  onUpdateBox,
  onCreateBox,
  onDeleteBox,
  onNavigateFrame,
  uiStatus = "READY",
  errorMessage,
  onOpenCVATModal,
  onOpenOverview,
}) => {
  const selectedBox =
    boxes.find((b) => b.id === selectedBoxId) ||
    (boxes.length > 0 ? boxes[0] : undefined);
  const [focusCount, setFocusCount] = useState<number>(0);
  const [newBoxLabel, setNewBoxLabel] = useState<string>("Car");

  // Auto trigger focus when selectedBoxId changes
  useEffect(() => {
    if (selectedBox) {
      setFocusCount((c) => c + 1);
    }
  }, [selectedBox?.id]);

  const effectivePoints = useMemo(() => {
    return points && points.length > 0 ? points : [];
  }, [points]);

  return (
    <div
      className={`relative w-full h-[72%] bg-[#14171f] rounded-2xl border border-neutral-200/80 dark:border-neutral-800 shadow-sm overflow-hidden select-none ${
        currentTool === "box3d" ? "cursor-crosshair" : ""
      }`}
    >
      {/* 3D WebGL Canvas */}
      <Canvas
        camera={{ position: [0, 22, 28], fov: 45 }}
        className={`w-full h-full ${
          currentTool === "box3d"
            ? "cursor-crosshair"
            : "cursor-grab active:cursor-grabbing"
        }`}
      >
        <color attach="background" args={["#14171f"]} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[10, 20, 15]} intensity={0.9} />
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          maxDistance={120}
          minDistance={2}
        />

        <CameraFocusController
          targetBox={selectedBox}
          focusCount={focusCount}
          resetViewSignal={resetViewSignal}
        />
        <LidarRings />
        {effectivePoints.length > 0 && (
          <PointCloudMesh
            points={effectivePoints}
            showGroundPlane={showGroundPlane}
          />
        )}

        {/* Interactive Placement Plane for [B] Box3D tool */}
        <BoxPlacementPlane
          active={currentTool === "box3d"}
          newBoxLabel={newBoxLabel}
          onPlaceBox={(coords) => {
            onCreateBox?.(coords);
          }}
        />

        {/* 3D Cuboids */}
        {boxes.map((box) => (
          <Cuboid3DItem
            key={box.id}
            box={box}
            isSelected={box.id === selectedBox?.id}
            onClick={() => onSelectBox(box.id)}
          />
        ))}

        {/* Interactive 3D Gizmo for Translate [W], Rotate [E], Scale [R] */}
        {selectedBox && (
          <SelectedBoxTransformGizmo
            box={selectedBox}
            currentTool={currentTool}
            onUpdateBox={onUpdateBox}
          />
        )}

        {/* Ground Plane Visualizer (z-cutoff = -1.0m) */}
        {showGroundPlane && (
          <group position={[0, -1.0, 0]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[80, 80]} />
              <meshBasicMaterial
                color="#f59e0b"
                transparent
                opacity={0.14}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>
            <gridHelper args={[80, 40, "#f59e0b", "#38bdf8"]} />
            <Html position={[12, 0.3, -12]} center distanceFactor={22}>
              <div className="px-2.5 py-1 rounded-full bg-amber-500/95 text-neutral-950 font-mono text-[10px] font-bold shadow-lg border border-amber-200 whitespace-nowrap">
                Mặt phẳng lọc mặt đường z-cutoff = -1.00m (Điểm cam = Bị cắt)
              </div>
            </Html>
          </group>
        )}
      </Canvas>

      {/* Active Tool Mode Top-Center Interactive Bar */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1.5">
        {currentTool === "box3d" && (
          <div className="bg-sky-950/95 backdrop-blur-md border border-sky-400/60 text-white px-3.5 py-2 rounded-2xl shadow-2xl flex items-center gap-2.5 text-xs">
            <span className="h-2 w-2 rounded-full bg-sky-400 animate-ping" />
            <span className="font-semibold">Dựng Hộp 3D Mới [B]:</span>
            <select
              value={newBoxLabel}
              onChange={(e) => setNewBoxLabel(e.target.value)}
              className="bg-sky-900 border border-sky-600 rounded-lg px-2 py-1 text-xs font-mono text-white outline-none"
            >
              <option value="Car">Car (4.5×1.9×1.55m)</option>
              <option value="Truck">Truck (7.2×2.5×2.8m)</option>
              <option value="Motorcycle">Motorcycle (2.1×0.85×1.4m)</option>
              <option value="Bicycle">Bicycle (1.75×0.65×1.35m)</option>
              <option value="Pedestrian">Pedestrian (0.75×0.75×1.72m)</option>
            </select>
            <Button
              size="sm"
              onClick={() =>
                onCreateBox?.({
                  x: selectedBox ? Number((selectedBox.x + 2.5).toFixed(2)) : 0,
                  y: selectedBox ? Number((selectedBox.y + 3.0).toFixed(2)) : 8.0,
                  z: -0.2,
                  label: newBoxLabel,
                })
              }
              className="h-7 px-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-neutral-950 font-bold text-xs gap-1"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Tạo Hộp Ngay</span>
            </Button>
            <span className="text-[11px] text-sky-200 hidden xl:inline">
              (Hoặc click trực tiếp vào vùng không gian 3D)
            </span>
          </div>
        )}

        {currentTool === "translate" && selectedBox && (
          <div className="bg-neutral-900/95 backdrop-blur-md border border-emerald-500/50 text-white px-3.5 py-2 rounded-2xl shadow-2xl flex items-center gap-2 text-xs font-mono">
            <Move className="h-3.5 w-3.5 text-emerald-400" />
            <span className="font-sans font-semibold text-emerald-300">
              Dịch Chuyển [W] ({selectedBox.id}):
            </span>
            <div className="flex items-center gap-1 bg-black/40 px-2 py-0.5 rounded-lg">
              <span className="text-rose-400">X:{selectedBox.x.toFixed(2)}m</span>
              <button
                onClick={() => onAdjustBox?.({ x: -0.2 })}
                className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 rounded text-[10px]"
              >
                -
              </button>
              <button
                onClick={() => onAdjustBox?.({ x: 0.2 })}
                className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 rounded text-[10px]"
              >
                +
              </button>
            </div>
            <div className="flex items-center gap-1 bg-black/40 px-2 py-0.5 rounded-lg">
              <span className="text-emerald-400">Y:{selectedBox.y.toFixed(2)}m</span>
              <button
                onClick={() => onAdjustBox?.({ y: -0.2 })}
                className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 rounded text-[10px]"
              >
                -
              </button>
              <button
                onClick={() => onAdjustBox?.({ y: 0.2 })}
                className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 rounded text-[10px]"
              >
                +
              </button>
            </div>
            <div className="flex items-center gap-1 bg-black/40 px-2 py-0.5 rounded-lg">
              <span className="text-sky-400">Z:{selectedBox.z.toFixed(2)}m</span>
              <button
                onClick={() => onAdjustBox?.({ z: -0.1 })}
                className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 rounded text-[10px]"
              >
                -
              </button>
              <button
                onClick={() => onAdjustBox?.({ z: 0.1 })}
                className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 rounded text-[10px]"
              >
                +
              </button>
            </div>
            <span className="text-[10px] text-neutral-400 font-sans hidden lg:inline">
              (Kéo mũi tên 3D trên hộp hoặc bấm +/-)
            </span>
          </div>
        )}

        {currentTool === "rotate" && selectedBox && (
          <div className="bg-neutral-900/95 backdrop-blur-md border border-amber-500/50 text-white px-3.5 py-2 rounded-2xl shadow-2xl flex items-center gap-2 text-xs font-mono">
            <RotateCw className="h-3.5 w-3.5 text-amber-400" />
            <span className="font-sans font-semibold text-amber-300">
              Xoay Góc Yaw [E] ({selectedBox.id}):
            </span>
            <span className="bg-black/40 px-2 py-0.5 rounded-lg text-amber-200">
              {((selectedBox.rotation_yaw * 180) / Math.PI).toFixed(1)}° ({selectedBox.rotation_yaw.toFixed(2)} rad)
            </span>
            <button
              onClick={() => onAdjustBox?.({ yaw: -0.2618 })}
              className="px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-[11px]"
              title="Xoay -15 độ"
            >
              -15°
            </button>
            <button
              onClick={() => onAdjustBox?.({ yaw: -0.0873 })}
              className="px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-[11px]"
              title="Xoay -5 độ"
            >
              -5°
            </button>
            <button
              onClick={() => onAdjustBox?.({ yaw: 0.0873 })}
              className="px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-[11px]"
              title="Xoay +5 độ"
            >
              +5°
            </button>
            <button
              onClick={() => onAdjustBox?.({ yaw: 0.2618 })}
              className="px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-[11px]"
              title="Xoay +15 độ"
            >
              +15°
            </button>
            <button
              onClick={() => onAdjustBox?.({ yaw: Math.PI })}
              className="px-2 py-0.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-[11px] font-sans font-semibold"
              title="Đảo chiều đầu xe 180 độ"
            >
              Đảo 180°
            </button>
          </div>
        )}

        {currentTool === "scale" && selectedBox && (
          <div className="bg-neutral-900/95 backdrop-blur-md border border-purple-500/50 text-white px-3.5 py-2 rounded-2xl shadow-2xl flex items-center gap-2 text-xs font-mono">
            <Maximize2 className="h-3.5 w-3.5 text-purple-400" />
            <span className="font-sans font-semibold text-purple-300">
              Co Dãn Kích Thước [R] ({selectedBox.id}):
            </span>
            <div className="flex items-center gap-1 bg-black/40 px-2 py-0.5 rounded-lg">
              <span className="text-rose-300">Rộng dx:{selectedBox.dx.toFixed(2)}m</span>
              <button
                onClick={() => onAdjustBox?.({ dx: -0.1 })}
                className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 rounded text-[10px]"
              >
                -
              </button>
              <button
                onClick={() => onAdjustBox?.({ dx: 0.1 })}
                className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 rounded text-[10px]"
              >
                +
              </button>
            </div>
            <div className="flex items-center gap-1 bg-black/40 px-2 py-0.5 rounded-lg">
              <span className="text-emerald-300">Dài dy:{selectedBox.dy.toFixed(2)}m</span>
              <button
                onClick={() => onAdjustBox?.({ dy: -0.1 })}
                className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 rounded text-[10px]"
              >
                -
              </button>
              <button
                onClick={() => onAdjustBox?.({ dy: 0.1 })}
                className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 rounded text-[10px]"
              >
                +
              </button>
            </div>
            <div className="flex items-center gap-1 bg-black/40 px-2 py-0.5 rounded-lg">
              <span className="text-sky-300">Cao dz:{selectedBox.dz.toFixed(2)}m</span>
              <button
                onClick={() => onAdjustBox?.({ dz: -0.1 })}
                className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 rounded text-[10px]"
              >
                -
              </button>
              <button
                onClick={() => onAdjustBox?.({ dz: 0.1 })}
                className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 rounded text-[10px]"
              >
                +
              </button>
            </div>
          </div>
        )}
      </div>

      {/* UI State Overlays */}
      {uiStatus === "DISCONNECTED" && effectivePoints.length === 0 && boxes.length === 0 && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#14171f]/90 backdrop-blur-md p-6 text-center select-none">
          <div className="w-14 h-14 rounded-2xl bg-neutral-800/80 border border-neutral-700/80 flex items-center justify-center text-sky-400 mb-3.5 shadow-xl">
            <UploadCloud className="h-7 w-7 stroke-[1.8]" />
          </div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-white font-mono mb-1">
            Chưa Có Dữ Liệu 3D Đám Mây Điểm
          </h3>
          <p className="text-xs text-neutral-400 max-w-md leading-relaxed mb-4">
            Bạn có thể nạp dữ liệu bằng cách tải trực tiếp tệp từ máy tính <strong className="text-neutral-200">(hoạt động ngoại tuyến 100%, không cần kết nối CVAT)</strong> hoặc kết nối trực tiếp với máy chủ CVAT Local nếu cần đồng bộ 2 chiều.
          </p>
          <div className="flex items-center gap-2.5">
            {onOpenOverview && (
              <Button
                variant="monochrome"
                onClick={onOpenOverview}
                className="bg-sky-500 hover:bg-sky-400 text-neutral-950 rounded-xl text-xs font-bold px-4 py-2 gap-1.5 shadow-md cursor-pointer"
              >
                <UploadCloud className="h-3.5 w-3.5" />
                <span>Nạp Tệp Dữ Liệu (.zip, .pcd, .bin)</span>
              </Button>
            )}
            <Button
              variant="outline"
              onClick={onOpenCVATModal}
              className="bg-neutral-800 hover:bg-neutral-700 border-neutral-700 text-neutral-200 rounded-xl text-xs font-semibold px-4 py-2 gap-1.5 cursor-pointer"
            >
              <Server className="h-3.5 w-3.5" />
              <span>Kết Nối CVAT Local (:8080)</span>
            </Button>
          </div>
        </div>
      )}

      {uiStatus === "CONNECTING" && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#14171f]/80 backdrop-blur-sm p-6 text-center select-none">
          <RefreshCw className="h-8 w-8 text-neutral-300 animate-spin mb-3" />
          <span className="text-xs font-semibold text-neutral-200 font-mono">
            Đang kiểm tra kết nối CVAT Server...
          </span>
        </div>
      )}

      {uiStatus === "CONNECTED_NO_JOB" && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#14171f]/80 backdrop-blur-md p-6 text-center select-none">
          <div className="w-14 h-14 rounded-2xl bg-neutral-800/80 border border-neutral-700/80 flex items-center justify-center text-emerald-400 mb-3.5 shadow-xl">
            <FolderOpen className="h-7 w-7 stroke-[1.8]" />
          </div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-white font-mono mb-1">
            Đã Kết Nối CVAT • Chưa Chọn Job (CONNECTED_NO_JOB)
          </h3>
          <p className="text-xs text-neutral-400 max-w-md leading-relaxed mb-4">
            Kết nối CVAT thành công. Vui lòng chọn một Task và Job từ danh sách để nạp đám mây điểm LiDAR và annotation 3D thật.
          </p>
          <Button
            variant="monochrome"
            onClick={onOpenCVATModal}
            className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold px-4 py-2 gap-1.5"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span>Chọn Task & Job Trên CVAT</span>
          </Button>
        </div>
      )}

      {uiStatus === "LOADING" && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#14171f]/75 backdrop-blur-xs p-6 text-center select-none">
          <div className="w-12 h-12 rounded-2xl bg-neutral-800/90 border border-neutral-700 flex items-center justify-center mb-3">
            <RefreshCw className="h-6 w-6 text-neutral-200 animate-spin" />
          </div>
          <span className="text-xs font-semibold text-white font-mono mb-1">
            Đang tải Point Cloud & Annotation thật từ CVAT...
          </span>
          <span className="text-[11px] text-neutral-400">
            Giải mã PCD và ma trận hiệp phương sai NumPy PCA
          </span>
        </div>
      )}

      {uiStatus === "EMPTY" && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#14171f]/80 backdrop-blur-sm p-6 text-center select-none">
          <div className="w-12 h-12 rounded-2xl bg-neutral-800/80 border border-neutral-700 flex items-center justify-center text-neutral-400 mb-3">
            <Layers className="h-6 w-6 stroke-[1.8]" />
          </div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-white font-mono mb-1">
            Không Có Dữ Liệu Phù Hợp (EMPTY)
          </h3>
          <p className="text-[11px] text-neutral-400 max-w-sm">
            API phản hồi thành công nhưng Frame này không chứa dữ liệu Point Cloud hoặc 3D Cuboids nào trên CVAT.
          </p>
        </div>
      )}

      {uiStatus === "ERROR" && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#14171f]/85 backdrop-blur-md p-6 text-center select-none">
          <div className="w-12 h-12 rounded-2xl bg-rose-950/80 border border-rose-800/80 flex items-center justify-center text-rose-400 mb-3">
            <AlertTriangle className="h-6 w-6 stroke-[2]" />
          </div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-rose-300 font-mono mb-1">
            Lỗi Kết Nối Hoặc Tải Dữ Liệu (ERROR)
          </h3>
          <p className="text-[11px] text-neutral-300 max-w-md mb-3">
            {errorMessage ||
              "Không thể tải dữ liệu từ CVAT Local. Vui lòng kiểm tra lại dịch vụ CVAT và Backend."}
          </p>
          <Button
            variant="outline"
            onClick={onOpenCVATModal}
            className="text-xs text-neutral-200 border-neutral-700 bg-neutral-800 hover:bg-neutral-700 rounded-xl"
          >
            Kiểm tra cấu hình CVAT
          </Button>
        </div>
      )}

      {uiStatus === "UNSUPPORTED_FORMAT" && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#14171f]/85 backdrop-blur-md p-6 text-center select-none">
          <div className="w-12 h-12 rounded-2xl bg-amber-950/80 border border-amber-800/80 flex items-center justify-center text-amber-400 mb-3">
            <AlertOctagon className="h-6 w-6 stroke-[2]" />
          </div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300 font-mono mb-1">
            Định Dạng Chưa Được Hỗ Trợ (UNSUPPORTED_FORMAT)
          </h3>
          <p className="text-[11px] text-neutral-300 max-w-md">
            {errorMessage ||
              "Dữ liệu trả về chưa đủ thông tin để giải mã an toàn định dạng đám mây điểm 3D."}
          </p>
        </div>
      )}

      {/* Point cloud info badge if points present but no annotations */}
      {uiStatus === "READY" && boxes.length === 0 && points.length > 0 && (
        <div className="absolute top-3 left-3 bg-neutral-900/90 backdrop-blur-md border border-neutral-700/80 rounded-2xl px-3.5 py-2 text-neutral-200 text-xs font-mono flex items-center gap-2 shadow-lg z-20">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>LiDAR: {points.length.toLocaleString()} điểm thật</span>
          <span className="text-neutral-500">•</span>
          <span className="text-neutral-400">
            Chưa có Annotation 3D trong Frame này
          </span>
          <Button
            size="sm"
            onClick={() => onSelectTool?.("box3d")}
            className="h-6 px-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-neutral-950 font-sans font-bold text-[10px] ml-1"
          >
            + Dựng Hộp [B]
          </Button>
        </div>
      )}

      {/* Floating Light Card HUD: Trạm Kiểm Định 3D (Top Left) */}
      {selectedBox && (
        <Card className="absolute top-3 left-3 z-40 bg-white/95 dark:bg-[#0d131f]/95 backdrop-blur-md border border-neutral-200/90 dark:border-neutral-700/80 rounded-2xl w-80 shadow-2xl p-3.5 text-neutral-800 dark:text-neutral-100 transition-all duration-200">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-xs font-mono tracking-tight text-neutral-900 dark:text-white">
                {selectedBox.id}
              </span>
              <span className="text-[11px] text-neutral-500 font-medium">
                • {selectedBox.label}
              </span>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFocusCount((c) => c + 1)}
                className="h-6 px-2 rounded-full text-[10px] font-semibold gap-1 bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-200"
                title="Căn giữa camera vào hộp đang chọn"
              >
                <Crosshair className="h-3 w-3 text-rose-500" />
                <span>Căn giữa</span>
              </Button>

              {onDeleteBox && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onDeleteBox(selectedBox.id)}
                  className="h-6 w-6 rounded-full text-neutral-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50"
                  title="Xóa hộp 3D này [Delete]"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}

              {selectedBox.defect_type === "PCA_COLLAPSE" ? (
                <Badge
                  variant="hard"
                  className="gap-1 bg-rose-50 text-rose-700 border-rose-200"
                >
                  <AlertTriangle className="h-3 w-3 stroke-[2.5]" />
                  HARD • PCA
                </Badge>
              ) : selectedBox.defect_type === "Z_CUTOFF" ? (
                <Badge
                  variant="defect"
                  className="gap-1 bg-amber-50 text-amber-700 border-amber-200"
                >
                  <AlertTriangle className="h-3 w-3 stroke-[2.5]" />
                  z-cutoff
                </Badge>
              ) : (
                <Badge
                  variant="easy"
                  className="gap-1 bg-emerald-50 text-emerald-700 border-emerald-200"
                >
                  <CheckCircle2 className="h-3 w-3 stroke-[2.5]" />
                  EASY
                </Badge>
              )}
            </div>
          </div>

          {/* 3 Parameter boxes */}
          <div className="grid grid-cols-3 gap-1.5 mb-2.5">
            <div className="bg-neutral-100/90 dark:bg-neutral-800/80 rounded-xl p-2 flex flex-col items-center justify-center border border-neutral-200/60 dark:border-neutral-700/60">
              <span className="text-[9px] uppercase tracking-wider text-neutral-500">
                Kích thước (D×R×C)
              </span>
              <span
                className={`font-mono font-bold text-[10px] ${
                  selectedBox.dz < 0.05
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-neutral-900 dark:text-white"
                }`}
              >
                {selectedBox.dy.toFixed(1)}×{selectedBox.dx.toFixed(1)}×{selectedBox.dz.toFixed(2)}m
              </span>
            </div>

            <div className="bg-neutral-100/90 dark:bg-neutral-800/80 rounded-xl p-2 flex flex-col items-center justify-center border border-neutral-200/60 dark:border-neutral-700/60">
              <span className="text-[9px] uppercase tracking-wider text-neutral-500">
                Mật độ điểm
              </span>
              <span className="font-mono font-bold text-xs text-neutral-900 dark:text-white">
                {selectedBox.points_count}/
                {selectedBox.raw_points_count || selectedBox.points_count} pts
              </span>
            </div>

            <div className="bg-neutral-100/90 dark:bg-neutral-800/80 rounded-xl p-2 flex flex-col items-center justify-center border border-neutral-200/60 dark:border-neutral-700/60">
              <span className="text-[9px] uppercase tracking-wider text-neutral-500">
                Cự ly D(r)
              </span>
              <span className="font-mono font-bold text-xs text-neutral-900 dark:text-white">
                {selectedBox.distance.toFixed(1)}m
              </span>
            </div>
          </div>

          {/* Diagnosis box */}
          <div className="bg-neutral-50 dark:bg-neutral-900/60 rounded-xl p-2 mb-3 border border-neutral-200/70 dark:border-neutral-800 text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-300">
            {selectedBox.notes ||
              "Hộp 3D được khớp tự động theo thuật toán tối ưu hóa."}
          </div>

          {/* Action buttons */}
          <div className="flex flex-col gap-1.5">
            {selectedBox.defect_type === "PCA_COLLAPSE" && (
              <Button
                variant="monochrome"
                size="sm"
                onClick={() => onFixPCA(selectedBox.id)}
                className="w-full gap-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl"
              >
                <Wrench className="h-3.5 w-3.5" />
                <span>Khôi Phục Chiều Cao Chuẩn (h = 1.55m)</span>
              </Button>
            )}

            <div className="flex items-center gap-1.5">
              <Button
                variant="monochrome"
                size="sm"
                onClick={() => onSendIssue(selectedBox)}
                className="flex-1 gap-1.5 text-xs font-semibold rounded-xl bg-[#2c2c2c] hover:bg-neutral-700 text-white dark:bg-neutral-200 dark:text-neutral-900 dark:hover:bg-white"
              >
                <Send className="h-3.5 w-3.5" />
                <span>Bắn Issue về CVAT</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={onOpenCVAT}
                className="gap-1 text-xs font-medium rounded-xl border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Mở CVAT Local</span>
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Bottom Left HUD: Keycaps for Frame Navigation & Z Elevation [↑][←][↓][→] */}
      <div className="absolute bottom-3 left-3 flex items-center gap-2 bg-black/40 backdrop-blur-md px-3.5 py-2 rounded-2xl border border-white/10 text-white text-[11px] select-none shadow-lg">
        <span className="text-neutral-400 font-medium text-[10px]">
          Frame / Cao độ Z:
        </span>
        <div className="flex items-center gap-1 font-mono">
          <button
            type="button"
            onClick={() => onNavigateFrame?.(-1)}
            className="w-7 h-7 rounded-lg bg-white/90 text-neutral-800 font-mono text-xs shadow-sm flex items-center justify-center font-bold hover:bg-white active:scale-95 transition"
            title="Frame trước [←]"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => onAdjustBox?.({ z: 0.05 })}
            className="w-7 h-7 rounded-lg bg-white/90 text-neutral-800 font-mono text-xs shadow-sm flex items-center justify-center font-bold hover:bg-white active:scale-95 transition"
            title="Nâng cao Z +0.05m [↑]"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onAdjustBox?.({ z: -0.05 })}
            className="w-7 h-7 rounded-lg bg-white/90 text-neutral-800 font-mono text-xs shadow-sm flex items-center justify-center font-bold hover:bg-white active:scale-95 transition"
            title="Hạ thấp Z -0.05m [↓]"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => onNavigateFrame?.(1)}
            className="w-7 h-7 rounded-lg bg-white/90 text-neutral-800 font-mono text-xs shadow-sm flex items-center justify-center font-bold hover:bg-white active:scale-95 transition"
            title="Frame kế tiếp [→]"
          >
            →
          </button>
        </div>
      </div>

      {/* Bottom Right HUD: Keycaps for Translation & Yaw Rotation [U][I][O] / [J][K][L] */}
      <div className="absolute bottom-3 right-3 flex flex-col items-end gap-1.5 bg-black/40 backdrop-blur-md px-3.5 py-2 rounded-2xl border border-white/10 text-white text-[11px] select-none shadow-lg">
        {/* Row 1: [U] Rotate CCW, [I] Forward Y+, [O] Rotate CW */}
        <div className="flex items-center gap-2">
          <span className="text-neutral-400 font-medium text-[10px]">
            Xoay Yaw / Tiến Y+:
          </span>
          <div className="flex items-center gap-1 font-mono">
            <button
              type="button"
              onClick={() => onAdjustBox?.({ yaw: -0.05 })}
              className="w-7 h-7 rounded-lg bg-white/90 text-neutral-800 font-mono text-xs shadow-sm flex items-center justify-center font-bold hover:bg-white active:scale-95 transition"
              title="Xoay ngược chiều kim đồng hồ [U]"
            >
              U
            </button>
            <button
              type="button"
              onClick={() => onAdjustBox?.({ y: 0.1 })}
              className="w-7 h-7 rounded-lg bg-white/90 text-neutral-800 font-mono text-xs shadow-sm flex items-center justify-center font-bold hover:bg-white active:scale-95 transition"
              title="Dịch tiến Y+ [I]"
            >
              I
            </button>
            <button
              type="button"
              onClick={() => onAdjustBox?.({ yaw: 0.05 })}
              className="w-7 h-7 rounded-lg bg-white/90 text-neutral-800 font-mono text-xs shadow-sm flex items-center justify-center font-bold hover:bg-white active:scale-95 transition"
              title="Xoay theo chiều kim đồng hồ [O]"
            >
              O
            </button>
          </div>
        </div>

        {/* Row 2: [J] Left X-, [K] Backward Y-, [L] Right X+ */}
        <div className="flex items-center gap-2">
          <span className="text-neutral-400 font-medium text-[10px]">
            Trái X- / Lùi Y- / Phải X+:
          </span>
          <div className="flex items-center gap-1 font-mono">
            <button
              type="button"
              onClick={() => onAdjustBox?.({ x: -0.1 })}
              className="w-7 h-7 rounded-lg bg-white/90 text-neutral-800 font-mono text-xs shadow-sm flex items-center justify-center font-bold hover:bg-white active:scale-95 transition"
              title="Dịch trái X- [J]"
            >
              J
            </button>
            <button
              type="button"
              onClick={() => onAdjustBox?.({ y: -0.1 })}
              className="w-7 h-7 rounded-lg bg-white/90 text-neutral-800 font-mono text-xs shadow-sm flex items-center justify-center font-bold hover:bg-white active:scale-95 transition"
              title="Dịch lùi Y- [K]"
            >
              K
            </button>
            <button
              type="button"
              onClick={() => onAdjustBox?.({ x: 0.1 })}
              className="w-7 h-7 rounded-lg bg-white/90 text-neutral-800 font-mono text-xs shadow-sm flex items-center justify-center font-bold hover:bg-white active:scale-95 transition"
              title="Dịch phải X+ [L]"
            >
              L
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
