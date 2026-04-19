"use client";

import { ChangeEvent, DragEvent, useRef, useState } from "react";
import { FileText, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface UploadSurfaceProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
  disabled?: boolean;
}

const ACCEPT = ".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp";

export function UploadSurface({ files, onFilesChange, disabled }: UploadSurfaceProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hover, setHover] = useState(false);

  const addFiles = (incoming: FileList | File[] | null | undefined) => {
    if (!incoming) return;
    const next = Array.from(incoming);
    if (next.length === 0) return;
    const seen = new Set(files.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
    const merged = [...files];
    for (const file of next) {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(file);
      }
    }
    onFilesChange(merged);
  };

  const onSelect = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(event.target.files);
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setHover(false);
    if (disabled) return;
    addFiles(event.dataTransfer.files);
  };

  const openPicker = () => {
    if (!disabled) inputRef.current?.click();
  };

  const removeAt = (index: number) => {
    const next = files.slice();
    next.splice(index, 1);
    onFilesChange(next);
  };

  const hasFiles = files.length > 0;

  return (
    <div className="space-y-3">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setHover(true);
        }}
        onDragLeave={() => setHover(false)}
        onDrop={onDrop}
        onClick={openPicker}
        className={cn(
          "relative cursor-pointer rounded-lg border-2 border-dashed p-12 text-center transition-colors",
          hover ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          hidden
          multiple
          onChange={onSelect}
          disabled={disabled}
        />
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent">
            <Upload className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="space-y-2">
            <p className="text-foreground">
              {hasFiles ? "继续添加文件或开始转换" : "拖拽文件至此或点击选择"}
            </p>
            <p className="text-sm text-muted-foreground">
              支持 PDF、Word（.doc, .docx）、图片（.jpg, .png），可一次选择多个，单个文件最大 25MB
            </p>
          </div>
        </div>
      </div>

      {hasFiles ? (
        <ul className="space-y-2">
          {files.map((file, index) => (
            <li
              key={`${file.name}:${file.size}:${file.lastModified}`}
              className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent">
                <FileText className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(file.size / 1024 / 1024).toFixed(2)} MB · {file.type || "未知类型"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => removeAt(index)}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                disabled={disabled}
                aria-label={`移除 ${file.name}`}
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
