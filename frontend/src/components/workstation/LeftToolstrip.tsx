import React from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import {
  MousePointer2,
  Box,
  Move,
  RotateCw,
  Maximize2,
  Layers,
  Focus,
} from "lucide-react";

export type ToolMode = "select" | "box3d" | "translate" | "rotate" | "scale";

interface LeftToolstripProps {
  currentTool: ToolMode;
  onSelectTool: (tool: ToolMode) => void;
  showGroundPlane: boolean;
  onToggleGroundPlane: () => void;
  onResetView: () => void;
}

export const LeftToolstrip: React.FC<LeftToolstripProps> = ({
  currentTool,
  onSelectTool,
  showGroundPlane,
  onToggleGroundPlane,
  onResetView,
}) => {
  const tools: { id: ToolMode; label: string; shortcut: string; icon: React.ReactNode }[] = [
    {
      id: "select",
      label: "Chọn Vật Thể (Select Mode)",
      shortcut: "V",
      icon: <MousePointer2 className="h-4 w-4 stroke-[2.2]" />,
    },
    {
      id: "box3d",
      label: "Dựng Hộp 3D Mới (Bounding Box)",
      shortcut: "B",
      icon: <Box className="h-4 w-4 stroke-[2.2]" />,
    },
    {
      id: "translate",
      label: "Dịch Chuyển Tọa Độ (Translate)",
      shortcut: "W",
      icon: <Move className="h-4 w-4 stroke-[2.2]" />,
    },
    {
      id: "rotate",
      label: "Xoay Góc Hướng Yaw (Rotate)",
      shortcut: "E",
      icon: <RotateCw className="h-4 w-4 stroke-[2.2]" />,
    },
    {
      id: "scale",
      label: "Co Dãn Kích Thước Hộp (Scale)",
      shortcut: "R",
      icon: <Maximize2 className="h-4 w-4 stroke-[2.2]" />,
    },
  ];

  return (
    <TooltipProvider delayDuration={150}>
      <aside className="w-12 h-full bg-white dark:bg-[#0d131f] rounded-2xl border border-neutral-200/80 dark:border-neutral-800 shadow-sm flex flex-col items-center py-3 gap-2 shrink-0 select-none">
        {/* Main transformation tools */}
        <div className="flex flex-col gap-1.5 items-center w-full px-1.5">
          {tools.map((t) => {
            const isActive = currentTool === t.id;
            return (
              <Tooltip key={t.id}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t.label}
                    onClick={() => onSelectTool(t.id)}
                    className={`h-9 w-9 rounded-xl transition-all duration-150 ${
                      isActive
                        ? "bg-[#2c2c2c] text-white hover:bg-neutral-800 shadow-sm dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
                        : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800/80"
                    }`}
                  >
                    {t.icon}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <div className="flex items-center gap-1.5">
                    <span>{t.label}</span>
                    <kbd className="px-1 py-0.5 rounded bg-neutral-100 dark:bg-neutral-700 font-mono text-[9px] text-neutral-600 dark:text-neutral-300">
                      [{t.shortcut}]
                    </kbd>
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        <Separator className="w-6 my-1" />

        {/* View inspection toggles */}
        <div className="flex flex-col gap-1.5 items-center w-full px-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Bật/tắt mặt phẳng lọc mặt đường z-cutoff"
                onClick={onToggleGroundPlane}
                className={`h-9 w-9 rounded-xl transition-all ${
                  showGroundPlane
                    ? "bg-amber-500 text-white hover:bg-amber-600 shadow-sm dark:bg-amber-500 dark:text-neutral-950"
                    : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800/80"
                }`}
              >
                <Layers className="h-4 w-4 stroke-[2.2]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <span>Bật/Tắt Mặt Phẳng Lọc Mặt Đường (z-cutoff = -1.0m)</span>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="mt-auto flex flex-col gap-1.5 items-center w-full px-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Căn giữa góc nhìn 3D"
                onClick={onResetView}
                className="h-9 w-9 rounded-xl text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                <Focus className="h-4 w-4 stroke-[2.2]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <span>Căn giữa góc nhìn 3D (Space / F)</span>
            </TooltipContent>
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  );
};
