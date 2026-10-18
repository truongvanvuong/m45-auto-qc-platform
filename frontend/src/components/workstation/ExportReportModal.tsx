import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FileText,
  FileSpreadsheet,
  Code2,
  Printer,
  Download,
  X,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Sparkles,
} from "lucide-react";
import { DatasetSummaryKPI, FlaggedCaseItem, CVATTaskInfo } from "@/types/qc";

interface ExportReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  summary: DatasetSummaryKPI;
  flaggedCases: FlaggedCaseItem[];
  taskInfo: CVATTaskInfo | null;
  selectedTaskId?: string;
  pcdFile?: string;
}

export const ExportReportModal: React.FC<ExportReportModalProps> = ({
  isOpen,
  onClose,
  summary,
  flaggedCases,
  taskInfo,
  selectedTaskId,
  pcdFile,
}) => {
  const [selectedFormat, setSelectedFormat] = useState<"CSV" | "PDF" | "JSON">("PDF");
  const [isExporting, setIsExporting] = useState<boolean>(false);

  if (!isOpen) return null;

  const datasetTitle = taskInfo?.name || pcdFile || `Task #${selectedTaskId || "Dataset"}`;
  const totalBoxes = summary.total_boxes || flaggedCases.length;
  const easyCount = summary.easy_count;
  const hardCount = summary.hard_count;
  const dropCount = summary.pipeline_count;
  const timeSaved = (easyCount * 0.05).toFixed(1);
  const costSaved = (easyCount * 0.20).toFixed(2);

  // 1. Export CSV (Excel compatible with UTF-8 BOM)
  const handleExportCSV = () => {
    setIsExporting(true);
    try {
      const headers = [
        "STT",
        "Ma Hop (Box ID)",
        "Frame",
        "Loai Nhan",
        "Cu Ly (m)",
        "Chieu Cao h (m)",
        "Kich Thuoc DxRxC (m)",
        "So Diem LiDAR",
        "Phan Loai",
        "Chi Tiet Danh Gia",
      ];

      const rows = flaggedCases.map((c, idx) => {
        const dx = c.dx?.toFixed(2) || "0.00";
        const dy = c.dy?.toFixed(2) || "0.00";
        const dz = c.dz?.toFixed(2) || c.h?.toFixed(2) || "0.00";
        const sizeStr = `${dx}x${dy}x${dz}`;
        const tier = c.category === "EASY_AUTO" ? "CA DE (DAT CHUAN)" : "CA KHO (CAN CHU Y)";
        const reason = (c.flag_reason || c.badge_text || "Chuan").replace(/,/g, " ");

        return [
          idx + 1,
          c.id,
          c.frame,
          c.label,
          c.distance?.toFixed(1) || "0.0",
          c.h?.toFixed(3) || dz,
          `"${sizeStr}"`,
          c.points_count || 0,
          `"${tier}"`,
          `"${reason}"`,
        ].join(",");
      });

      const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `M45_QC_Report_${selectedTaskId || "Dataset"}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onClose();
    } finally {
      setIsExporting(false);
    }
  };

  // Helper to strip Vietnamese diacritics for clean Latin-1 PDF font (100% no garbled characters)
  const toCleanAscii = (str: string): string => {
    if (!str) return "";
    return str
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .replace(/[–—]/g, "-")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  };

  // Helper to dynamically load jsPDF and autoTable for guaranteed non-blank vector PDF
  const loadJsPdfWithAutoTable = (): Promise<{ jsPDF: any }> => {
    return new Promise((resolve, reject) => {
      const loadScript = (src: string) => {
        return new Promise((res, rej) => {
          if (document.querySelector(`script[src="${src}"]`)) return res(true);
          const s = document.createElement("script");
          s.src = src;
          s.onload = () => res(true);
          s.onerror = rej;
          document.head.appendChild(s);
        });
      };

      // Primary CDN: cdnjs, fallback: jsdelivr
      loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js")
        .catch(() => loadScript("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"))
        .then(() => {
          return loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js")
            .catch(() => loadScript("https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js"));
        })
        .then(() => {
          const { jsPDF } = (window as any).jspdf;
          resolve({ jsPDF });
        })
        .catch(reject);
    });
  };

  // 2. Export Real PDF Document via jsPDF (Direct file download, 100% reliable)
  const handleExportPDF = async () => {
    setIsExporting(true);
    try {
      const { jsPDF } = await loadJsPdfWithAutoTable();
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

      // Title & Subtitle
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(15, 23, 42);
      doc.text("BAO CAO KIEM DINH CHAT LUONG GAN NHAN 3D LIDAR", 105, 16, { align: "center" });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      doc.text("HE THONG M45 AUTO QC PLATFORM - DANH GIA TU DONG NUMPY PCA", 105, 22, { align: "center" });

      // Divider line
      doc.setDrawColor(226, 232, 240);
      doc.line(14, 26, 196, 26);

      // Meta Block
      doc.setFontSize(9);
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "bold");
      doc.text("Tap Du Lieu:", 14, 32);
      doc.setFont("helvetica", "normal");
      doc.text(toCleanAscii(String(datasetTitle)), 36, 32);

      doc.setFont("helvetica", "bold");
      doc.text("Thoi Gian Xuat:", 120, 32);
      doc.setFont("helvetica", "normal");
      doc.text(new Date().toLocaleString("vi-VN"), 146, 32);

      // 3 Summary Metric Badges (Cards)
      // Box 1: Tong hop 3D
      doc.setFillColor(241, 245, 249);
      doc.roundedRect(14, 36, 56, 15, 2, 2, "F");
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text("TONG HOP 3D", 18, 41);
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.text(totalBoxes.toLocaleString(), 18, 48);

      // Box 2: Ca De (Dat Chuan)
      doc.setFillColor(236, 253, 245);
      doc.roundedRect(77, 36, 56, 15, 2, 2, "F");
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(5, 150, 105);
      doc.text("CA DE (DAT CHUAN)", 81, 41);
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text(`${easyCount.toLocaleString()} (${summary.easy_pct}%)`, 81, 48);

      // Box 3: Ca Kho (Can Review)
      doc.setFillColor(254, 242, 242);
      doc.roundedRect(140, 36, 56, 15, 2, 2, "F");
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(220, 38, 38);
      doc.text("CA KHO (LOI HINH HOC)", 144, 41);
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text(`${hardCount.toLocaleString()} (${summary.hard_pct}%)`, 144, 48);

      // Section title
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.text("DANH SACH CHI TIET CAC CA DUOC KIEM DINH", 14, 57);

      // Table rows
      const tableData = (flaggedCases.length > 0 ? flaggedCases : []).slice(0, 250).map((c, idx) => {
        const isHard = c.category === "HARD_REVIEW";
        const reason = toCleanAscii(c.flag_reason || c.badge_text || "Dat tieu chuan hinh hoc").replace(/,/g, " ");
        return [
          idx + 1,
          toCleanAscii(c.id),
          `#${c.frame}`,
          toCleanAscii(c.label),
          `${c.distance?.toFixed(1) || "0.0"}m`,
          `${c.h?.toFixed(2) || "0.00"}m`,
          isHard ? "CA KHO" : "DAT CHUAN",
          reason,
        ];
      });

      (doc as any).autoTable({
        startY: 61,
        head: [["STT", "Ma Hop (ID)", "Frame", "Nhan", "Cu Ly", "Chieu Cao", "Ket Qua", "Chi Tiet Danh Gia"]],
        body: tableData.length > 0 ? tableData : [["-", "-", "-", "-", "-", "-", "-", "Khong co ca vi pham"]],
        theme: "striped",
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: [255, 255, 255],
          fontSize: 8,
          fontStyle: "bold",
          halign: "left",
        },
        styles: {
          fontSize: 7.5,
          cellPadding: 2,
          overflow: "linebreak",
          font: "helvetica",
        },
        columnStyles: {
          0: { halign: "center", cellWidth: 10 },
          1: { cellWidth: 32 },
          2: { halign: "center", cellWidth: 16 },
          3: { cellWidth: 22 },
          4: { halign: "right", cellWidth: 16 },
          5: { halign: "right", cellWidth: 18 },
          6: { halign: "center", cellWidth: 24 },
          7: { cellWidth: "auto" },
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        didParseCell: (data: any) => {
          if (data.section === "body" && data.column.index === 6) {
            if (data.cell.raw === "CA KHO") {
              data.cell.styles.textColor = [220, 38, 38];
              data.cell.styles.fontStyle = "bold";
            } else if (data.cell.raw === "DAT CHUAN") {
              data.cell.styles.textColor = [5, 150, 105];
              data.cell.styles.fontStyle = "bold";
            }
          }
        },
      });

      doc.save(`M45_QC_Report_${selectedTaskId || "Dataset"}_${new Date().toISOString().slice(0, 10)}.pdf`);
      onClose();
    } catch (err) {
      console.error("PDF export error:", err);
      // Clean fallback: Hidden iframe native print
      const printFrame = document.createElement("iframe");
      printFrame.style.position = "fixed";
      printFrame.style.right = "0";
      printFrame.style.bottom = "0";
      printFrame.style.width = "0";
      printFrame.style.height = "0";
      printFrame.style.border = "0";
      document.body.appendChild(printFrame);

      const rowsHtml = flaggedCases.slice(0, 100).map((c, idx) => `
        <tr style="border-bottom: 1px solid #e2e8f0; font-size: 11px;">
          <td style="padding: 6px; text-align: center;">${idx + 1}</td>
          <td style="padding: 6px; font-weight: bold;">${c.id}</td>
          <td style="padding: 6px; text-align: center;">#${c.frame}</td>
          <td style="padding: 6px;">${c.label}</td>
          <td style="padding: 6px; text-align: right;">${c.distance?.toFixed(1)}m</td>
          <td style="padding: 6px; text-align: right;">${c.h?.toFixed(2)}m</td>
          <td style="padding: 6px; text-align: center;">${c.category === "EASY_AUTO" ? "DAT CHUAN" : "CA KHO"}</td>
          <td style="padding: 6px;">${c.flag_reason || "Dat tieu chuan"}</td>
        </tr>
      `).join("");

      const frameDoc = printFrame.contentWindow?.document || printFrame.contentDocument;
      if (frameDoc) {
        frameDoc.open();
        frameDoc.write(`
          <!DOCTYPE html><html><head><meta charset="utf-8"><title>M45_QC_Report</title>
          <style>body{font-family:sans-serif;padding:20px;color:#0f172a;} table{width:100%;border-collapse:collapse;margin-top:15px;} th{background:#0f172a;color:white;padding:6px;font-size:11px;text-align:left;}</style>
          </head><body>
          <h2>BAO CAO KIEM DINH CHAT LUONG GAN NHAN 3D LIDAR</h2>
          <p>Tap du lieu: ${datasetTitle} | Tong hop: ${totalBoxes} | Ca de: ${easyCount} | Ca kho: ${hardCount}</p>
          <table><thead><tr><th>STT</th><th>Ma Hop</th><th>Frame</th><th>Nhan</th><th>Cu Ly</th><th>Chieu Cao</th><th>Ket Qua</th><th>Chi Tiet</th></tr></thead><tbody>${rowsHtml}</tbody></table>
          </body></html>
        `);
        frameDoc.close();
        setTimeout(() => {
          printFrame.contentWindow?.focus();
          printFrame.contentWindow?.print();
          setTimeout(() => { document.body.removeChild(printFrame); }, 1000);
        }, 300);
      }
    } finally {
      setIsExporting(false);
    }
  };

  // 3. Export JSON (Machine-readable for MLOps Pipeline)
  const handleExportJSON = () => {
    setIsExporting(true);
    try {
      const reportData = {
        report_title: "BÁO CÁO PHÂN LOẠI KIỂM ĐỊNH M45 3D QC PLATFORM",
        generated_at: new Date().toLocaleString("vi-VN"),
        task_id: selectedTaskId || taskInfo?.id || "N/A",
        dataset_name: datasetTitle,
        summary: {
          total_boxes: totalBoxes,
          total_frames: summary.total_frames,
          easy_cases_count: easyCount,
          easy_cases_pct: `${summary.easy_pct}%`,
          hard_cases_count: hardCount,
          hard_cases_pct: `${summary.hard_pct}%`,
          pipeline_drop_count: dropCount,
          pipeline_drop_pct: `${summary.pipeline_pct}%`,
        },
        classification_standards: {
          EASY: "Hộp 3D đạt chuẩn kích thước thực tế (h >= 1.0m, mật độ điểm LiDAR đầy đủ, không vi phạm PCA/z-cutoff)",
          HARD: "Hộp 3D bất thường: Suy biến chiều cao PCA Collapse (h < 0.05m) hoặc cắt nhầm mặt đường z-cutoff (z < -0.85m)",
        },
        flagged_cases_detail: flaggedCases,
      };

      const jsonStr = JSON.stringify(reportData, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `M45_QC_Report_${selectedTaskId || "Dataset"}_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onClose();
    } finally {
      setIsExporting(false);
    }
  };

  const handleExecuteExport = () => {
    if (selectedFormat === "CSV") handleExportCSV();
    else if (selectedFormat === "PDF") handleExportPDF();
    else if (selectedFormat === "JSON") handleExportJSON();
  };

  return (
    <div
      className="fixed inset-0 z-[99999] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 select-none animate-in fade-in duration-150"
      onClick={onClose}
    >
      <Card
        className="w-full max-w-xl bg-white dark:bg-[#0d131f] border border-neutral-200 dark:border-neutral-800 rounded-3xl shadow-2xl p-6 overflow-hidden flex flex-col gap-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-neutral-100 dark:border-neutral-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Download className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-neutral-900 dark:text-white flex items-center gap-2">
                Tùy Chọn Xuất Báo Cáo Kiểm Định
              </h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                Chọn định dạng tệp phù hợp với nhu cầu lưu trữ, phân tích hoặc tích hợp
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Dataset Summary Mini Banner */}
        <div className="bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-100 dark:border-neutral-800 rounded-2xl p-3 flex items-center justify-between text-xs">
          <div>
            <div className="text-[10px] text-neutral-400 uppercase font-semibold">Tập Dữ Liệu</div>
            <div className="font-semibold text-neutral-800 dark:text-neutral-200 truncate max-w-[240px]">
              {datasetTitle}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="monochrome" className="text-[10px]">
              {totalBoxes.toLocaleString()} hộp 3D
            </Badge>
            <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-none text-[10px]">
              {summary.easy_pct}% Ca Dễ
            </Badge>
          </div>
        </div>

        {/* 3 Export Format Options */}
        <div className="flex flex-col gap-2.5">
          {/* Option 1: CSV / Excel */}
          <div
            onClick={() => setSelectedFormat("CSV")}
            className={`p-3.5 rounded-2xl border cursor-pointer transition flex items-center justify-between ${
              selectedFormat === "CSV"
                ? "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20 shadow-sm"
                : "border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700"
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-neutral-900 dark:text-white flex items-center gap-1.5">
                  Bảng Tính Excel / CSV (.csv)
                  <span className="text-[10px] font-normal text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/40 px-1.5 py-0.2 rounded-full">
                    Khuyên dùng
                  </span>
                </div>
                <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                  Mở trực tiếp bằng Microsoft Excel, Google Sheets để lọc, tính lương và phân việc
                </div>
              </div>
            </div>
            <input
              type="radio"
              checked={selectedFormat === "CSV"}
              onChange={() => setSelectedFormat("CSV")}
              className="text-emerald-600 focus:ring-emerald-500"
            />
          </div>

          {/* Option 2: PDF Document */}
          <div
            onClick={() => setSelectedFormat("PDF")}
            className={`p-3.5 rounded-2xl border cursor-pointer transition flex items-center justify-between ${
              selectedFormat === "PDF"
                ? "border-rose-500 bg-rose-50/50 dark:bg-rose-950/20 shadow-sm"
                : "border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700"
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-neutral-900 dark:text-white">
                  Báo Cáo Kiểm Định PDF (.pdf)
                </div>
                <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                  Tải trực tiếp tệp PDF tiêu chuẩn về máy tính để lưu trữ hoặc gửi báo cáo bàn giao
                </div>
              </div>
            </div>
            <input
              type="radio"
              checked={selectedFormat === "PDF"}
              onChange={() => setSelectedFormat("PDF")}
              className="text-rose-600 focus:ring-rose-500"
            />
          </div>

          {/* Option 3: JSON File */}
          <div
            onClick={() => setSelectedFormat("JSON")}
            className={`p-3.5 rounded-2xl border cursor-pointer transition flex items-center justify-between ${
              selectedFormat === "JSON"
                ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 shadow-sm"
                : "border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700"
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                <Code2 className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-neutral-900 dark:text-white">
                  Dữ Liệu Kỹ Thuật JSON (.json)
                </div>
                <div className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                  Tệp cấu trúc máy đọc (Machine-readable) tích hợp vào pipeline huấn luyện mô hình MLOps
                </div>
              </div>
            </div>
            <input
              type="radio"
              checked={selectedFormat === "JSON"}
              onChange={() => setSelectedFormat("JSON")}
              className="text-blue-600 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-neutral-100 dark:border-neutral-800">
          <Button variant="outline" size="sm" onClick={onClose} className="rounded-xl text-xs">
            Hủy Bỏ
          </Button>
          <Button
            size="sm"
            onClick={handleExecuteExport}
            disabled={isExporting}
            className="rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 shadow-sm px-4"
          >
            <Download className="h-3.5 w-3.5" />
            <span>
              {isExporting ? "Đang Kết Xuất..." : `Tải Xuất File .${selectedFormat}`}
            </span>
          </Button>
        </div>
      </Card>
    </div>
  );
};
