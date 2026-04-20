"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  FileText,
  Globe,
  Library,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { copyPlainText, copyReference, copyReferenceList } from "@/lib/clipboard";
import { useLibrary } from "@/lib/library";
import type { LibraryEntry, SavedSummaryEntry, WorkType } from "@/lib/types";
import { ManualAddDrawer } from "./ManualAddDrawer";
import { formatSummaryPlainText, SummaryView } from "@/components/summary/SummaryPanel";

type SortMode = "manual" | "alpha";
const SORT_STORAGE_KEY = "apa7_reference_list_sort_v1";

function readSortMode(): SortMode {
  if (typeof window === "undefined") return "manual";
  const raw = window.localStorage.getItem(SORT_STORAGE_KEY);
  return raw === "alpha" ? "alpha" : "manual";
}

function sortKey(entry: LibraryEntry): string {
  const author = entry.structured.authors?.[0];
  const candidate =
    (author?.family && author.family.trim()) ||
    (author?.literal && author.literal.trim()) ||
    (author?.given && author.given.trim()) ||
    entry.rendered.reference_plain.replace(/^[^\p{L}\p{N}]+/u, "");
  return (candidate || "").toLocaleLowerCase("en");
}

export function LibraryPanel() {
  const {
    entries,
    projects,
    activeProjectId,
    activeProjectName,
    setActiveProject,
    createProject,
    renameProject,
    deleteProject,
    addFromResult,
    remove,
    move,
    clear,
    summaries,
    removeSummary,
  } = useLibrary();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("manual");
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);

  useEffect(() => {
    setSortMode(readSortMode());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SORT_STORAGE_KEY, sortMode);
  }, [sortMode]);

  const displayEntries = useMemo(() => {
    if (sortMode === "manual") return entries;
    return [...entries].sort((a, b) =>
      sortKey(a).localeCompare(sortKey(b), "en", { sensitivity: "base", ignorePunctuation: true }),
    );
  }, [entries, sortMode]);

  const copyPayload = useMemo(
    () =>
      displayEntries.map((entry) => ({
        plain: entry.rendered.reference_plain,
        html: entry.rendered.reference_html,
      })),
    [displayEntries],
  );

  const copyAll = async () => {
    if (!copyPayload.length) return;
    await copyReferenceList(copyPayload);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1400);
  };

  const manualSort = sortMode === "manual";

  const activeProject = projects.find((p) => p.id === activeProjectId);
  const entryCountForDelete = activeProject?.entries.length ?? 0;

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h2 className="text-xl font-medium">参考文献库</h2>
        <div className="flex flex-wrap items-center gap-3">
          {projects.length > 0 && (
            <>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>论文项目</span>
                <Select
                  value={activeProjectId}
                  onChange={(event) => setActiveProject(event.target.value)}
                  className="h-9 min-w-[12rem] max-w-[16rem]"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}（{p.entries.length}）
                    </option>
                  ))}
                </Select>
              </label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setNewProjectName("");
                  setNewProjectOpen(true);
                }}
              >
                <Plus className="h-4 w-4" /> 新建项目
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRenameDraft(activeProjectName);
                  setRenameOpen(true);
                }}
              >
                重命名
              </Button>
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteProjectOpen(true)}>
                删除项目
              </Button>
            </>
          )}
          {entries.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>排序</span>
              <Select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as SortMode)}
                className="h-9 w-[10.5rem]"
              >
                <option value="manual">手动顺序</option>
                <option value="alpha">按首字母 A–Z</option>
              </Select>
            </label>
          )}
          <Button variant="secondary" size="sm" onClick={copyAll} disabled={!entries.length}>
            {copiedAll ? <Check className="h-4 w-4" /> : <ClipboardCopy className="h-4 w-4" />}
            {copiedAll ? "已复制" : "复制整张列表"}
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setConfirmClear(true)} disabled={!entries.length}>
            <Trash2 className="h-4 w-4" /> 清空
          </Button>
          <Button onClick={() => setDrawerOpen(true)} size="sm">
            <Plus className="h-4 w-4" /> 手动添加
          </Button>
        </div>
      </div>

      {summaries.length > 0 && (
        <SavedSummariesSection summaries={summaries} onRemove={removeSummary} />
      )}

      {entries.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-12 text-center">
          <Library className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="mb-2 text-lg font-medium">文献库为空</h3>
          <p className="mb-6 text-sm text-muted-foreground">
            通过「转换」页上传或手动添加一条文献以开始构建你的参考文献列表。
          </p>
          <Button onClick={() => setDrawerOpen(true)}>
            <Plus className="h-4 w-4" /> 手动添加文献
          </Button>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-card">
          {displayEntries.map((entry, index) => (
            <LibraryRow
              key={entry.id}
              entry={entry}
              isFirst={index === 0}
              isLast={index === displayEntries.length - 1}
              manualSort={manualSort}
              onRemove={() => remove(entry.id)}
              onUp={manualSort ? () => move(entry.id, -1) : undefined}
              onDown={manualSort ? () => move(entry.id, 1) : undefined}
            />
          ))}
        </div>
      )}

      <ManualAddDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onConfirm={(result) => {
          addFromResult(result, "manual");
          setDrawerOpen(false);
        }}
      />

      <Dialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="确认清空"
        description="删除后无法恢复；如需保留请先使用「复制整张列表」。"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmClear(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                clear();
                setConfirmClear(false);
              }}
            >
              确认清空
            </Button>
          </>
        }
      >
        <p>确定要清空当前项目「{activeProjectName}」下的全部文献吗？此操作无法撤销。</p>
      </Dialog>

      <Dialog
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        title="新建论文项目"
        description="创建后将自动切换到新项目，文献列表为空。"
        widthClassName="max-w-md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setNewProjectOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => {
                createProject(newProjectName);
                setNewProjectOpen(false);
                setNewProjectName("");
              }}
            >
              创建
            </Button>
          </>
        }
      >
        <label className="block space-y-2 text-sm">
          <span className="text-muted-foreground">项目名称</span>
          <Input
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            placeholder="例如：硕士论文 · 第三章"
            autoFocus
          />
        </label>
      </Dialog>

      <Dialog
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="重命名项目"
        widthClassName="max-w-md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenameOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => {
                renameProject(activeProjectId, renameDraft);
                setRenameOpen(false);
              }}
              disabled={!renameDraft.trim()}
            >
              保存
            </Button>
          </>
        }
      >
        <label className="block space-y-2 text-sm">
          <span className="text-muted-foreground">项目名称</span>
          <Input value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)} autoFocus />
        </label>
      </Dialog>

      <Dialog
        open={deleteProjectOpen}
        onClose={() => setDeleteProjectOpen(false)}
        title="删除项目"
        description="项目内的参考文献将一并删除。"
        widthClassName="max-w-md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteProjectOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                deleteProject(activeProjectId);
                setDeleteProjectOpen(false);
              }}
            >
              确认删除
            </Button>
          </>
        }
      >
        <p>
          确定删除项目「{activeProjectName}」吗？其中 {entryCountForDelete} 条文献将被永久删除。
          {projects.length <= 1
            ? " 删除后系统会创建一个空白的默认项目。"
            : " 删除后将切换到列表中的其他项目。"}
        </p>
      </Dialog>
    </section>
  );
}

function LibraryRow({
  entry,
  isFirst,
  isLast,
  manualSort,
  onRemove,
  onUp,
  onDown,
}: {
  entry: LibraryEntry;
  isFirst: boolean;
  isLast: boolean;
  manualSort: boolean;
  onRemove: () => void;
  onUp?: () => void;
  onDown?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const copyEntry = async () => {
    await copyReference(entry.rendered.reference_plain, entry.rendered.reference_html);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const upDisabled = !manualSort || isFirst || !onUp;
  const downDisabled = !manualSort || isLast || !onDown;

  return (
    <div className="flex flex-col gap-3 p-4 transition-colors hover:bg-accent/40">
      <div className="flex items-start gap-4">
        <div className="flex flex-col items-center gap-1 pt-1 text-muted-foreground">
          <button
            type="button"
            onClick={onUp}
            disabled={upDisabled}
            className="rounded p-1 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-30"
            aria-label={manualSort ? "上移" : "按字母排序下不可手动调整"}
            title={manualSort ? undefined : "切换为「手动顺序」后再调整"}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDown}
            disabled={downDisabled}
            className="rounded p-1 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-30"
            aria-label={manualSort ? "下移" : "按字母排序下不可手动调整"}
            title={manualSort ? undefined : "切换为「手动顺序」后再调整"}
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex-1 space-y-2">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="block w-full text-left"
          >
            <p
              className="reference-entry text-[15px]"
              dangerouslySetInnerHTML={{
                __html: entry.rendered.reference_html || entry.rendered.reference_plain,
              }}
            />
          </button>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <WorkTypeBadge type={entry.structured.work_type} />
            <Badge tone={entry.source === "manual" ? "outline" : "muted"}>
              {entry.source === "manual" ? "手动添加" : "来自上传"}
            </Badge>
            {entry.crossrefUsed && <Badge tone="positive">Crossref</Badge>}
            <span className="ml-auto">{new Date(entry.createdAt).toLocaleString()}</span>
          </div>
          {expanded && (
            <div className="grid gap-2 rounded-md bg-muted/60 p-3 md:grid-cols-2">
              <InlineText label="Parenthetical" value={entry.rendered.in_text_parenthetical} />
              <InlineText label="Narrative" value={entry.rendered.in_text_narrative} />
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={copyEntry}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
            {copied ? "已复制" : "复制"}
          </Button>
          <Button variant="ghost" size="icon" onClick={onRemove} aria-label="删除">
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function InlineText({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="pt-1 font-mono text-sm">{value}</p>
    </div>
  );
}

function SavedSummariesSection({
  summaries,
  onRemove,
}: {
  summaries: SavedSummaryEntry[];
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-5 py-3 text-sm transition-colors hover:bg-accent/40"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="font-medium">已保存概要</span>
        <span className="text-xs text-muted-foreground">（{summaries.length}）</span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-border p-5">
          {summaries.map((entry) => (
            <SavedSummaryRow key={entry.id} entry={entry} onRemove={() => onRemove(entry.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function SavedSummaryRow({ entry, onRemove }: { entry: SavedSummaryEntry; onRemove: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const title =
    entry.summary.title_guess?.trim() ||
    entry.filename?.trim() ||
    (entry.source === "paste" ? "粘贴文本" : "未命名概要");

  const copy = async () => {
    await copyPlainText(formatSummaryPlainText(entry.summary));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="space-y-3 rounded-md border border-border bg-background p-4">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
        >
          {expanded ? (
            <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{title}</p>
            <p className="text-xs text-muted-foreground">
              {entry.source === "upload" ? "来自上传" : "来自粘贴"} · {entry.outputLanguage === "zh" ? "中文" : "English"} ·{" "}
              {new Date(entry.createdAt).toLocaleString()}
            </p>
          </div>
        </button>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={copy}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
            {copied ? "已复制" : "复制"}
          </Button>
          <Button variant="ghost" size="icon" onClick={onRemove} aria-label="删除概要">
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>
      {!expanded && (
        <div className="flex flex-wrap gap-2">
          {entry.summary.topic_tags.slice(0, 6).map((tag, idx) => (
            <Badge key={idx}>{tag}</Badge>
          ))}
          {entry.summary.keywords.slice(0, 6).map((word, idx) => (
            <Badge key={idx} tone="outline">
              {word}
            </Badge>
          ))}
        </div>
      )}
      {expanded && <SummaryView summary={entry.summary} />}
    </div>
  );
}

function WorkTypeBadge({ type }: { type: WorkType }) {
  const config: Record<WorkType, { label: string; icon: typeof FileText }> = {
    journal_article: { label: "期刊", icon: FileText },
    book: { label: "图书", icon: BookOpen },
    book_chapter: { label: "章节", icon: BookOpen },
    webpage: { label: "网页", icon: Globe },
  };
  const { label, icon: Icon } = config[type];
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
      <Icon className="h-3 w-3" /> {label}
    </span>
  );
}
