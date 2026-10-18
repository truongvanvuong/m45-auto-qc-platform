import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  fetchSafeSyncPreview,
  applySafeSyncChanges,
  fetchCVATProjects,
  fetchCVATTasks,
  fetchCVATJobs
} from "@/services/api";
import {
  SyncPreviewResponse,
  SyncProposalItem,
  SyncApplyResponse,
  CVATTaskListItem,
  CVATJobItem
} from "@/types/qc";
import {
  X,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  Sliders,
  Send,
  HelpCircle,
  FileCheck2,
  Layers,
  ArrowRight
} from "lucide-react";

interface SafeSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  jobId?: number;
  taskId?: string;
  currentBoxes?: any[];
  onApplySuccess?: (response: SyncApplyResponse) => void;
  onSyncSuccess?: (appliedCount: number) => void;
}

export const SafeSyncModal: React.FC<SafeSyncModalProps> = ({
  isOpen,
  onClose,
  jobId = 0,
  taskId = "",
  currentBoxes,
  onApplySuccess,
  onSyncSuccess,
}) => {
  const [selectedJobId, setSelectedJobId] = useState<number>(jobId);
  const [selectedTaskId, setSelectedTaskId] = useState<string>(taskId);
  const [isLoadingPreview, setIsLoadingPreview] = useState<boolean>(false);
  const [previewData, setPreviewData] = useState<SyncPreviewResponse | null>(null);
  const [selectedShapeIds, setSelectedShapeIds] = useState<Set<number>>(new Set());
  const [includeIssues, setIncludeIssues] = useState<boolean>(true);
  
  // Confirmation step state
  const [showConfirmDialog, setShowConfirmDialog] = useState<boolean>(false);
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [applyResult, setApplyResult] = useState<SyncApplyResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Available tasks & jobs if connected
  const [availableTasks, setAvailableTasks] = useState<CVATTaskListItem[]>([]);
  const [availableJobs, setAvailableJobs] = useState<CVATJobItem[]>([]);

  // Load available tasks on open
  useEffect(() => {
    if (isOpen) {
      fetchCVATTasks()
        .then((tasks) => {
          if (tasks && tasks.length > 0) {
            setAvailableTasks(tasks);
          }
        })
        .catch(() => {});
    }
  }, [isOpen]);

  // Load preview whenever modal opens or selectedJobId changes
  const loadPreview = async (jId: number, tId?: string) => {
    const numTaskId = tId && !isNaN(Number(tId)) && Number(tId) > 0 ? Number(tId) : undefined;
    if (!jId && !numTaskId) {
      setIsLoadingPreview(false);
      setPreviewData(null);
      return;
    }
    setIsLoadingPreview(true);
    setErrorMessage(null);
    setApplyResult(null);
    setShowConfirmDialog(false);
    try {
      const res = await fetchSafeSyncPreview(jId || (numTaskId || 0), numTaskId);
      setPreviewData(res);
      // Auto select all shapes with MODIFY_DIMENSIONS
      const modIds = new Set<number>();
      res.proposals.forEach((p) => {
        if (p.action === "MODIFY_DIMENSIONS") {
          modIds.add(p.shape_id);
        }
      });
      setSelectedShapeIds(modIds);
    } catch (err: any) {
      setErrorMessage(err.message || "Không thể tải bản xem trước Safe Sync.");
    } finally {
      setIsLoadingPreview(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      if (jobId) setSelectedJobId(jobId);
      if (taskId) setSelectedTaskId(taskId);
      loadPreview(jobId || selectedJobId, taskId || selectedTaskId);
    }
  }, [isOpen, selectedJobId, selectedTaskId, jobId, taskId]);

  if (!isOpen) return null;

  const toggleSelectShape = (shapeId: number) => {
    setSelectedShapeIds((prev) => {
      const next = new Set(prev);
      if (next.has(shapeId)) next.delete(shapeId);
      else next.add(shapeId);
      return next;
    });
  };

  const selectAllModifications = () => {
    if (!previewData) return;
    const all = new Set<number>();
    previewData.proposals.forEach((p) => {
      if (p.action === "MODIFY_DIMENSIONS") all.add(p.shape_id);
    });
    setSelectedShapeIds(all);
  };

  const handleExecuteApply = async () => {
    setIsApplying(true);
    setErrorMessage(null);
    try {
      const numTaskId = selectedTaskId && !isNaN(Number(selectedTaskId)) ? Number(selectedTaskId) : undefined;
      const approvedList = Array.from(selectedShapeIds);
      
      const res = await applySafeSyncChanges(
        selectedJobId,
        approvedList,
        true, // Bắt buộc confirm_apply = True
        numTaskId,
        includeIssues
      );

      setApplyResult(res);
      setShowConfirmDialog(false);
      if (onApplySuccess) {
        onApplySuccess(res);
      }
      if (onSyncSuccess) {
        onSyncSuccess(res.applied_count);
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Lỗi khi áp dụng Safe Sync sang CVAT.");
      setShowConfirmDialog(false);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#0f141f] text-neutral-900 dark:text-neutral-100 rounded-3xl border border-neutral-200 dark:border-neutral-800 shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between shrink-0 bg-neutral-50/70 dark:bg-neutral-900/60">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 flex items-center justify-center shadow-md">
              <ShieldCheck className="h-5 w-5 stroke-[2.2]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm font-mono tracking-tight text-neutral-900 dark:text-white">
                  SAFE SYNC PREVIEW & COMMITS
                </h3>
                <Badge variant="monochrome" className="text-[10px] px-2 py-0.5">
                  CVAT Job #{selectedJobId}
                </Badge>
              </div>
              <p className="text-[11px] text-neutral-500">
                Đồng bộ hai chiều có kiểm soát: Xem trước thay đổi trước khi ghi đè lên CVAT Local
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 flex items-center justify-center text-neutral-600 dark:text-neutral-300 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
          {/* Status Message / Result */}
          {errorMessage && (
            <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 dark:bg-rose-950/60 dark:border-rose-900 dark:text-rose-200 text-xs flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {applyResult && (
            <div className={`p-4 rounded-2xl border text-xs flex flex-col gap-1.5 ${
              applyResult.success
                ? "bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/60 dark:border-emerald-900 dark:text-emerald-200"
                : "bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/60 dark:border-amber-900 dark:text-amber-200"
            }`}>
              <div className="flex items-center gap-2 font-bold text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>{applyResult.message}</span>
              </div>
              <div className="flex items-center gap-3 font-mono text-[11px] text-neutral-600 dark:text-neutral-400">
                <span>Đã ghi: {applyResult.applied_count}</span>
                <span>Thất bại: {applyResult.failed_count}</span>
                <span>Bỏ qua: {applyResult.skipped_count}</span>
              </div>
              {applyResult.errors && applyResult.errors.length > 0 && (
                <div className="mt-1 text-[11px] text-rose-600 dark:text-rose-400 font-mono">
                  Lỗi: {applyResult.errors.join("; ")}
                </div>
              )}
            </div>
          )}

          {/* Read-Only Safety Banner */}
          <div className="p-3.5 rounded-2xl bg-neutral-100 dark:bg-neutral-900/90 border border-neutral-200/80 dark:border-neutral-800 text-xs flex items-start gap-2.5">
            <Sliders className="h-4 w-4 text-neutral-700 dark:text-neutral-300 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="font-bold text-neutral-900 dark:text-white">
                Bảo Vệ Dữ Liệu An Toàn (Safe Verification Gate)
              </div>
              <p className="text-[11px] text-neutral-600 dark:text-neutral-400 mt-0.5 leading-relaxed">
                M45 Engine chạy thuật toán phân tích ma trận hiệp phương sai PCA cục bộ. Dữ liệu bên dưới hoàn toàn là
                bản xem trước (Read-Only Preview). CVAT sẽ <strong>không bị sửa đổi</strong> cho đến khi bạn tích chọn
                và bấm &quot;Xác nhận Đồng bộ&quot;.
              </p>
            </div>
          </div>

          {/* Quick Metrics KPI Bar */}
          {previewData && (
            <div className="grid grid-cols-4 gap-2.5">
              <div className="bg-neutral-50 dark:bg-neutral-900/50 p-3 rounded-2xl border border-neutral-200/70 dark:border-neutral-800">
                <span className="text-[10px] text-neutral-400 font-medium uppercase tracking-wider">Tổng số hộp</span>
                <div className="text-xl font-bold font-mono text-neutral-900 dark:text-white mt-1">
                  {previewData.total_shapes}
                </div>
              </div>
              <div className="bg-rose-50/70 dark:bg-rose-950/40 p-3 rounded-2xl border border-rose-200/70 dark:border-rose-900">
                <span className="text-[10px] text-rose-700 dark:text-rose-400 font-medium uppercase tracking-wider">Đề xuất sửa (PCA)</span>
                <div className="text-xl font-bold font-mono text-rose-600 dark:text-rose-400 mt-1">
                  {previewData.modified_count}
                </div>
              </div>
              <div className="bg-amber-50/70 dark:bg-amber-950/40 p-3 rounded-2xl border border-amber-200/70 dark:border-amber-900">
                <span className="text-[10px] text-amber-700 dark:text-amber-400 font-medium uppercase tracking-wider">Cần tạo Issue</span>
                <div className="text-xl font-bold font-mono text-amber-600 dark:text-amber-400 mt-1">
                  {previewData.flagged_issues_count}
                </div>
              </div>
              <div className="bg-emerald-50/70 dark:bg-emerald-950/40 p-3 rounded-2xl border border-emerald-200/70 dark:border-emerald-900">
                <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-medium uppercase tracking-wider">Hợp lệ (Giữ nguyên)</span>
                <div className="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                  {previewData.unmodified_count}
                </div>
              </div>
            </div>
          )}

          {/* Proposals List Table */}
          <div className="border border-neutral-200 dark:border-neutral-800 rounded-2xl overflow-hidden flex flex-col">
            <div className="bg-neutral-100/90 dark:bg-neutral-900/90 px-4 py-2.5 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between text-xs font-semibold text-neutral-700 dark:text-neutral-300">
              <div className="flex items-center gap-2">
                <span>Danh Sách Thay Đổi Đề Xuất</span>
                {previewData && (
                  <Badge variant="monochrome" className="text-[10px]">
                    {selectedShapeIds.size}/{previewData.modified_count} đã chọn
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={selectAllModifications}
                  className="text-[11px] text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white underline"
                >
                  Chọn tất cả đề xuất sửa
                </button>
                <button
                  type="button"
                  onClick={() => loadPreview(selectedJobId, selectedTaskId)}
                  disabled={isLoadingPreview}
                  className="p-1 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-800 transition"
                  title="Tải lại bản xem trước"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isLoadingPreview ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            <div className="divide-y divide-neutral-100 dark:divide-neutral-800 max-h-72 overflow-y-auto text-xs">
              {isLoadingPreview ? (
                <div className="p-8 text-center text-neutral-400 flex flex-col items-center gap-2">
                  <RefreshCw className="h-5 w-5 animate-spin" />
                  <span>Đang tải và chạy kiểm định M45 trên các hộp 3D...</span>
                </div>
              ) : previewData && previewData.proposals.length > 0 ? (
                previewData.proposals.map((item) => {
                  const isChecked = selectedShapeIds.has(item.shape_id);
                  const isModifiable = item.action === "MODIFY_DIMENSIONS";

                  return (
                    <div
                      key={item.shape_id}
                      className={`p-3.5 flex items-center justify-between gap-3 transition ${
                        item.m45_defect_type === "PCA_COLLAPSE"
                          ? "bg-rose-50/30 dark:bg-rose-950/20"
                          : item.m45_defect_type === "Z_CUTOFF"
                          ? "bg-amber-50/30 dark:bg-amber-950/20"
                          : "hover:bg-neutral-50 dark:hover:bg-neutral-900/40"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {isModifiable ? (
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleSelectShape(item.shape_id)}
                            className="w-4 h-4 rounded text-neutral-900 accent-[#2c2c2c] cursor-pointer"
                          />
                        ) : (
                          <span className="w-4 h-4 flex items-center justify-center text-neutral-300 dark:text-neutral-600">
                            •
                          </span>
                        )}

                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2 font-mono">
                            <span className="font-bold text-neutral-900 dark:text-white">
                              shape #{item.shape_id}
                            </span>
                            <span className="text-neutral-400 text-[10px]">
                              • Frame {item.frame}
                            </span>
                            <Badge
                              variant={
                                item.m45_defect_type === "PCA_COLLAPSE"
                                  ? "hard"
                                  : item.m45_defect_type === "Z_CUTOFF"
                                  ? "defect"
                                  : "easy"
                              }
                              className="text-[9px] px-1.5 py-0"
                            >
                              {item.m45_defect_type}
                            </Badge>
                          </div>

                          <div className="text-[11px] text-neutral-500 max-w-md truncate">
                            {item.reason}
                          </div>
                        </div>
                      </div>

                      {/* Before / After Comparison */}
                      <div className="flex items-center gap-3 font-mono text-[11px]">
                        <div className="text-neutral-500 bg-neutral-100 dark:bg-neutral-800 px-2 py-1 rounded-lg">
                          dz={item.original_values.dz?.toFixed(3)}m
                        </div>
                        {item.proposed_values.dz !== undefined && item.proposed_values.dz !== item.original_values.dz && (
                          <>
                            <ArrowRight className="h-3 w-3 text-neutral-400" />
                            <div className="font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-2 py-1 rounded-lg">
                              dz={item.proposed_values.dz?.toFixed(3)}m
                            </div>
                          </>
                        )}
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          item.action === "MODIFY_DIMENSIONS"
                            ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                            : item.action === "FLAG_ISSUE"
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                            : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                        }`}>
                          {item.action}
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-8 text-center text-neutral-400">
                  Không có đối tượng hộp 3D nào được tìm thấy trong Job #{selectedJobId}.
                </div>
              )}
            </div>
          </div>

          {/* Options: Include issue creation */}
          <div className="flex items-center justify-between text-xs px-2">
            <label className="flex items-center gap-2 cursor-pointer text-neutral-700 dark:text-neutral-300 font-medium">
              <input
                type="checkbox"
                checked={includeIssues}
                onChange={(e) => setIncludeIssues(e.target.checked)}
                className="w-4 h-4 rounded text-neutral-900 accent-[#2c2c2c] cursor-pointer"
              />
              <span>Tự động tạo Issue trên CVAT cho các hộp vi phạm (z-cutoff & PCA Collapse)</span>
            </label>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between shrink-0 bg-neutral-50/70 dark:bg-neutral-900/60">
          <div className="text-[11px] text-neutral-500 font-mono">
            {selectedShapeIds.size > 0 ? (
              <span>Sẵn sàng cập nhật {selectedShapeIds.size} hộp lên CVAT Local</span>
            ) : (
              <span>Chưa chọn thay đổi nào để áp dụng</span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="rounded-xl border-neutral-300 dark:border-neutral-700"
            >
              Đóng
            </Button>

            {!showConfirmDialog ? (
              <Button
                variant="monochrome"
                size="sm"
                disabled={selectedShapeIds.size === 0 || isApplying}
                onClick={() => setShowConfirmDialog(true)}
                className="rounded-xl bg-[#2c2c2c] hover:bg-neutral-800 text-white dark:bg-white dark:text-neutral-900 font-bold gap-2 px-4 shadow-md"
              >
                <FileCheck2 className="h-4 w-4" />
                <span>Đồng Bộ Sang CVAT ({selectedShapeIds.size})</span>
              </Button>
            ) : (
              <div className="flex items-center gap-2 animate-in fade-in zoom-in-95 duration-150">
                <span className="text-xs text-rose-600 dark:text-rose-400 font-bold">
                  Xác nhận ghi {selectedShapeIds.size} annotation?
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowConfirmDialog(false)}
                  className="rounded-xl h-8 text-xs"
                >
                  Hủy
                </Button>
                <Button
                  variant="monochrome"
                  size="sm"
                  disabled={isApplying}
                  onClick={handleExecuteApply}
                  className="rounded-xl h-8 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold gap-1.5 shadow-md"
                >
                  {isApplying ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                  <span>Xác Nhận Ghi Đè</span>
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
