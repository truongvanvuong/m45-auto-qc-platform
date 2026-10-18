import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { pingCVAT, saveCVATConfig, fetchCVATTasks } from "@/services/api";
import { DatasetUploadResponse, CVATTaskListItem } from "@/types/qc";
import {
  X,
  Server,
  Key,
  User,
  Building,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Zap,
  RotateCcw
} from "lucide-react";

export const CVAT_STORAGE_KEY = "m45_cvat_config";
export const CVAT_CACHE_KEY = "m45_last_dataset_cache";

export interface CVATConnectionConfig {
  cvatUrl: string;
  cvatPublicUrl: string;
  authMethod: "token" | "basic";
  token: string;
  username: string;
  password?: string;
  org: string;
  taskId: string;
  forceDemo: boolean;
  isConfigured?: boolean;
}

export function getStoredCVATConfig(): CVATConnectionConfig | null {
  try {
    const raw = localStorage.getItem(CVAT_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn("Could not read CVAT config from localStorage:", e);
  }
  return null;
}

export function saveStoredCVATConfig(cfg: CVATConnectionConfig): void {
  try {
    localStorage.setItem(CVAT_STORAGE_KEY, JSON.stringify(cfg));
  } catch (e) {
    console.warn("Could not write CVAT config to localStorage:", e);
  }
}

export function clearStoredCVATConfig(): void {
  try {
    localStorage.removeItem(CVAT_STORAGE_KEY);
    localStorage.removeItem(CVAT_CACHE_KEY);
  } catch (e) {
    console.warn("Could not clear CVAT config from localStorage:", e);
  }
}

interface CVATConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: (config: CVATConnectionConfig, syncedDataset?: DatasetUploadResponse) => void;
  onReset?: () => void;
  initialConfig?: Partial<CVATConnectionConfig>;
}

export const CVATConfigModal: React.FC<CVATConfigModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onReset,
  initialConfig,
}) => {
  const [config, setConfig] = useState<CVATConnectionConfig>(() => {
    const stored = getStoredCVATConfig();
    return {
      cvatUrl: stored?.cvatUrl || initialConfig?.cvatUrl || "http://localhost:8080",
      cvatPublicUrl: stored?.cvatPublicUrl || initialConfig?.cvatPublicUrl || "http://localhost:8080",
      authMethod: stored?.authMethod || initialConfig?.authMethod || "token",
      token: stored?.token || initialConfig?.token || "",
      username: stored?.username || initialConfig?.username || "admin",
      password: stored?.password || initialConfig?.password || "",
      org: stored?.org || initialConfig?.org || "",
      taskId: stored?.taskId || initialConfig?.taskId || "",
      forceDemo: stored?.forceDemo ?? initialConfig?.forceDemo ?? false,
      isConfigured: stored?.isConfigured ?? false,
    };
  });

  const [testingStatus, setTestingStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [availableTasks, setAvailableTasks] = useState<CVATTaskListItem[]>([]);
  const [isLoadingTasks, setIsLoadingTasks] = useState<boolean>(false);

  const loadTasks = async () => {
    setIsLoadingTasks(true);
    try {
      const tasks = await fetchCVATTasks();
      if (tasks && tasks.length > 0) {
        setAvailableTasks(tasks);
      }
    } catch (err) {
      console.warn("Could not load tasks from CVAT:", err);
    } finally {
      setIsLoadingTasks(false);
    }
  };

  // Sync stored config or initialConfig when modal opens
  React.useEffect(() => {
    if (isOpen) {
      const stored = getStoredCVATConfig();
      if (stored) {
        setConfig((prev) => ({ ...prev, ...stored }));
        loadTasks();
      } else if (initialConfig?.taskId && !config.taskId) {
        setConfig((prev) => ({ ...prev, taskId: initialConfig.taskId || prev.taskId }));
        loadTasks();
      }
    }
  }, [isOpen, initialConfig?.taskId]);

  // Immediately persist every typed field to localStorage so user never loses their configuration
  const updateField = (patch: Partial<CVATConnectionConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      saveStoredCVATConfig(next);
      return next;
    });
  };

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    saveStoredCVATConfig(config);
    setTestingStatus("testing");
    setTestMessage("Đang gửi lệnh ping và xác thực tài khoản với CVAT REST API...");

    try {
      const res = await pingCVAT(config);
      if (res.connected) {
        setTestingStatus("success");
        setTestMessage(res.message);
        updateField({ isConfigured: true });
        loadTasks();
      } else {
        setTestingStatus("error");
        setTestMessage(res.message || "CVAT Local offline hoặc không phản hồi.");
      }
    } catch (err: any) {
      setTestingStatus("error");
      setTestMessage(err?.message || "Không thể kết nối Backend M45 để kiểm tra CVAT.");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const finalConfig: CVATConnectionConfig = {
        ...config,
        isConfigured: true,
      };
      saveStoredCVATConfig(finalConfig);
      const res = await saveCVATConfig(finalConfig);
      onSave?.(finalConfig, res.dataset);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    clearStoredCVATConfig();
    const fresh: CVATConnectionConfig = {
      cvatUrl: "http://localhost:8080",
      cvatPublicUrl: "http://localhost:8080",
      authMethod: "token",
      token: "",
      username: "admin",
      password: "",
      org: "",
      taskId: "",
      forceDemo: false,
      isConfigured: false,
    };
    setConfig(fresh);
    setTestingStatus("idle");
    setTestMessage("");
    onReset?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150 select-none">
      <div
        className="relative w-full max-w-lg bg-white dark:bg-[#0d131f] rounded-3xl border border-neutral-200/90 dark:border-neutral-800 shadow-2xl p-6 text-neutral-800 dark:text-neutral-100 flex flex-col gap-4 animate-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-800 dark:text-neutral-200 shadow-inner">
              <Server className="h-4.5 w-4.5 stroke-[2.2]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-neutral-900 dark:text-white font-mono tracking-tight">
                  Cấu hình Kết nối CVAT Local
                </h3>
                <Badge variant="monochrome" className="text-[9px] px-1.5 py-0 h-4">
                  REST API v2.0
                </Badge>
              </div>
              <p className="text-[11px] text-neutral-500">
                Đồng bộ 2 chiều Annotation và Bắn Issue lỗi kiểm định 3D
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center justify-center text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5 text-xs">
          {/* Server URL */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-neutral-700 dark:text-neutral-300">
                CVAT Backend URL (API Call)
              </label>
              <input
                type="text"
                value={config.cvatUrl}
                onChange={(e) => updateField({ cvatUrl: e.target.value })}
                placeholder="http://localhost:8080"
                className="w-full bg-neutral-100/80 dark:bg-neutral-800/80 rounded-xl px-3 py-2 border border-neutral-200/80 dark:border-neutral-700 text-xs font-mono text-neutral-800 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-neutral-400"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-neutral-700 dark:text-neutral-300">
                CVAT Public URL (Trình duyệt)
              </label>
              <input
                type="text"
                value={config.cvatPublicUrl}
                onChange={(e) => updateField({ cvatPublicUrl: e.target.value })}
                placeholder="http://localhost:8080"
                className="w-full bg-neutral-100/80 dark:bg-neutral-800/80 rounded-xl px-3 py-2 border border-neutral-200/80 dark:border-neutral-700 text-xs font-mono text-neutral-800 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-neutral-400"
              />
            </div>
          </div>

          {/* Authentication Method Tabs */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold text-neutral-700 dark:text-neutral-300">
              Phương Thức Xác Thực
            </label>
            <div className="flex p-1 bg-neutral-100 dark:bg-neutral-800 rounded-xl w-fit border border-neutral-200/70 dark:border-neutral-700">
              <button
                type="button"
                onClick={() => updateField({ authMethod: "token" })}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                  config.authMethod === "token"
                    ? "bg-white dark:bg-[#1a2333] text-neutral-900 dark:text-white shadow-sm"
                    : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                }`}
              >
                Personal Token / API Key
              </button>
              <button
                type="button"
                onClick={() => updateField({ authMethod: "basic" })}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                  config.authMethod === "basic"
                    ? "bg-white dark:bg-[#1a2333] text-neutral-900 dark:text-white shadow-sm"
                    : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                }`}
              >
                Username & Password
              </button>
            </div>
          </div>

          {config.authMethod === "token" ? (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400 flex items-center gap-1">
                <Key className="h-3 w-3" />
                Token / API Key
              </label>
              <input
                type="password"
                value={config.token}
                onChange={(e) => updateField({ token: e.target.value })}
                placeholder="Ví dụ: b45a7e112d93e8..."
                className="w-full bg-neutral-100/80 dark:bg-neutral-800/80 rounded-xl px-3 py-2 border border-neutral-200/80 dark:border-neutral-700 text-xs font-mono text-neutral-800 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-neutral-400"
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400 flex items-center gap-1">
                  <User className="h-3 w-3" />
                  Username
                </label>
                <input
                  type="text"
                  value={config.username}
                  onChange={(e) => updateField({ username: e.target.value })}
                  placeholder="admin"
                  className="w-full bg-neutral-100/80 dark:bg-neutral-800/80 rounded-xl px-3 py-2 border border-neutral-200/80 dark:border-neutral-700 text-xs font-mono text-neutral-800 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-neutral-400"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400 flex items-center gap-1">
                  <Key className="h-3 w-3" />
                  Password
                </label>
                <input
                  type="password"
                  value={config.password || ""}
                  onChange={(e) => updateField({ password: e.target.value })}
                  placeholder="••••••••"
                  className="w-full bg-neutral-100/80 dark:bg-neutral-800/80 rounded-xl px-3 py-2 border border-neutral-200/80 dark:border-neutral-700 text-xs font-mono text-neutral-800 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-neutral-400"
                />
              </div>
            </div>
          )}

          {/* Organization & Task ID */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400 flex items-center gap-1">
                <Building className="h-3 w-3" />
                Organization Slug (Tùy chọn)
              </label>
              <input
                type="text"
                value={config.org}
                onChange={(e) => updateField({ org: e.target.value })}
                placeholder="Để trống nếu là cá nhân"
                className="w-full bg-neutral-100/80 dark:bg-neutral-800/80 rounded-xl px-3 py-2 border border-neutral-200/80 dark:border-neutral-700 text-xs font-mono text-neutral-800 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-neutral-400"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
                Task ID
              </label>
              <input
                type="text"
                value={config.taskId}
                onChange={(e) => updateField({ taskId: e.target.value })}
                placeholder="Nhập ID Task CVAT (ví dụ: 16, 21...)"
                className="w-full bg-neutral-100/80 dark:bg-neutral-800/80 rounded-xl px-3 py-2 border border-neutral-200/80 dark:border-neutral-700 text-xs font-mono text-neutral-800 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-neutral-400"
              />
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                {availableTasks.length > 0 ? (
                  <>
                    <span className="text-[10px] text-neutral-400">Task khả dụng trên CVAT:</span>
                    {availableTasks.slice(0, 5).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => updateField({ taskId: String(t.id) })}
                        className={`text-[10px] px-2 py-0.5 rounded-full font-mono transition ${
                          config.taskId === String(t.id)
                            ? "bg-blue-600 text-white font-semibold"
                            : "bg-neutral-200/70 dark:bg-neutral-800 hover:bg-neutral-300 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300"
                        }`}
                      >
                        #{t.id} {t.name ? `(${t.name.slice(0, 16)})` : ""}
                      </button>
                    ))}
                  </>
                ) : (
                  <span className="text-[10px] text-neutral-400">Nhập ID của Task đã tạo trên CVAT để đồng bộ và kiểm định 3D.</span>
                )}
              </div>

              {availableTasks.length > 0 && (
                <div className="flex flex-col gap-1 mt-2">
                  <div className="flex items-center justify-between text-[10px] text-neutral-500 font-medium">
                    <span>Task thực tế trên CVAT ({availableTasks.length}):</span>
                    <button
                      type="button"
                      onClick={loadTasks}
                      className="hover:underline flex items-center gap-1 text-[10px] text-neutral-600 dark:text-neutral-400"
                    >
                      <RefreshCw className={`h-2.5 w-2.5 ${isLoadingTasks ? "animate-spin" : ""}`} />
                      <span>Làm mới</span>
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto p-1.5 bg-neutral-100/70 dark:bg-neutral-800/70 rounded-xl border border-neutral-200/60 dark:border-neutral-700/60">
                    {availableTasks.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => updateField({ taskId: t.id.toString() })}
                        className={`text-[10px] px-2 py-1 rounded-lg font-mono transition text-left flex items-center gap-1.5 ${
                          config.taskId === t.id.toString()
                            ? "bg-neutral-800 text-white dark:bg-white dark:text-neutral-900 font-bold shadow-xs"
                            : "bg-white dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 border border-neutral-200/60 dark:border-neutral-700"
                        }`}
                      >
                        <span className="font-semibold">#{t.id}</span>
                        <span className="truncate max-w-[110px]">{t.name}</span>
                        {t.dimension === "3d" && (
                          <span className="text-[8px] bg-rose-500 text-white px-1 py-0.2 rounded font-bold">3D</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Test connection indicator */}
          <div className="bg-neutral-50 dark:bg-neutral-900/60 rounded-2xl p-3 border border-neutral-200/70 dark:border-neutral-800 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-neutral-700 dark:text-neutral-300">
                Trạng Thái Kết Nối
              </span>
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testingStatus === "testing"}
                className="text-[11px] font-medium text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white flex items-center gap-1 px-2.5 py-1 rounded-lg bg-neutral-200/70 dark:bg-neutral-800 hover:bg-neutral-300 transition"
              >
                <RefreshCw className={`h-3 w-3 ${testingStatus === "testing" ? "animate-spin" : ""}`} />
                <span>Kiểm tra kết nối (Ping)</span>
              </button>
            </div>

            {testMessage && (
              <div
                className={`text-[11px] p-2.5 rounded-xl flex items-start gap-2 ${
                  testingStatus === "success"
                    ? "bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-900"
                    : "bg-rose-50 text-rose-900 border border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-900"
                }`}
              >
                {testingStatus === "success" ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
                )}
                <span className="leading-relaxed">{testMessage}</span>
              </div>
            )}

          </div>

          {/* Footer buttons */}
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-neutral-100 dark:border-neutral-800 mt-1">
            <button
              type="button"
              onClick={handleReset}
              className="text-xs text-rose-600 dark:text-rose-400 hover:underline px-1 font-medium transition flex items-center gap-1"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Xóa cấu hình & Đặt lại</span>
            </button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClose}
                className="rounded-xl text-xs font-medium"
              >
                Hủy
              </Button>
              <Button
                type="submit"
                variant="monochrome"
                size="sm"
                disabled={isSaving}
                className="rounded-xl text-xs font-semibold bg-[#2c2c2c] hover:bg-neutral-800 text-white dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 px-4 flex items-center gap-1.5"
              >
                {isSaving && <RefreshCw className="h-3 w-3 animate-spin" />}
                <span>{isSaving ? "Đang Lưu & Nạp Dữ Liệu..." : "Lưu & Áp Dụng Cấu Hình"}</span>
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
