"use client";

import { useMemo, useState } from "react";
import { BookOpen, FileText, Globe, Loader2, Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CitationResultView } from "@/components/citation/CitationResultView";
import { renderCitation } from "@/lib/api";
import { emptyStructured } from "@/lib/library";
import type { CitationResult, LocalePolicy, StructuredCitation, WorkType } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (result: CitationResult) => void;
}

const TYPE_OPTIONS: { value: WorkType; label: string; icon: typeof FileText; description: string }[] = [
  { value: "journal_article", label: "期刊文章", icon: FileText, description: "学术期刊、会议论文等" },
  { value: "book", label: "图书", icon: BookOpen, description: "专著、译著、会议论文集" },
  { value: "book_chapter", label: "图书章节", icon: BookOpen, description: "编著中的单独章节" },
  { value: "webpage", label: "网页", icon: Globe, description: "新闻、博客、网站页面" },
];

type Step = 1 | 2;

type AuthorInput = { given: string; family: string; organization: boolean };

export function ManualAddDrawer({ open, onClose, onConfirm }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [workType, setWorkType] = useState<WorkType>("journal_article");
  const [localePolicy, setLocalePolicy] = useState<LocalePolicy>("en_all");
  const [enableCrossref, setEnableCrossref] = useState(true);

  const [authors, setAuthors] = useState<AuthorInput[]>([
    { given: "", family: "", organization: false },
  ]);
  const [year, setYear] = useState("");
  const [titleEnglish, setTitleEnglish] = useState("");
  const [titleOriginal, setTitleOriginal] = useState("");
  const [containerEnglish, setContainerEnglish] = useState("");
  const [volume, setVolume] = useState("");
  const [issue, setIssue] = useState("");
  const [pages, setPages] = useState("");
  const [publisher, setPublisher] = useState("");
  const [publisherPlace, setPublisherPlace] = useState("");
  const [edition, setEdition] = useState("");
  const [doi, setDoi] = useState("");
  const [url, setUrl] = useState("");
  const [accessedDate, setAccessedDate] = useState("");
  const [notes, setNotes] = useState("");

  const [preview, setPreview] = useState<CitationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showContainer = workType === "journal_article" || workType === "book_chapter";
  const showIssueVolume = workType === "journal_article";
  const showPublisher = workType === "book" || workType === "book_chapter";
  const showUrl = workType !== "journal_article";
  const showAccessedDate = workType === "webpage";

  const structured: StructuredCitation = useMemo(() => {
    const base = emptyStructured(workType);
    return {
      ...base,
      work_type: workType,
      authors: authors
        .filter((author) => author.family || author.given || author.organization)
        .map((author) =>
          author.organization
            ? { literal: author.family || author.given, is_organization: true }
            : { family: author.family || null, given: author.given || null, is_organization: false },
        ),
      year: year ? Number(year) : null,
      title: titleEnglish || titleOriginal || null,
      title_english: titleEnglish || null,
      title_original: titleOriginal || null,
      container_title: containerEnglish || null,
      container_title_english: containerEnglish || null,
      volume: volume || null,
      issue: issue || null,
      pages: pages || null,
      publisher: publisher || null,
      publisher_place: publisherPlace || null,
      edition: edition || null,
      doi: doi || null,
      url: url || null,
      accessed_date: accessedDate || null,
      notes: notes || null,
    };
  }, [
    workType,
    authors,
    year,
    titleEnglish,
    titleOriginal,
    containerEnglish,
    volume,
    issue,
    pages,
    publisher,
    publisherPlace,
    edition,
    doi,
    url,
    accessedDate,
    notes,
  ]);

  const close = () => {
    setStep(1);
    setPreview(null);
    setError(null);
    setAuthors([{ given: "", family: "", organization: false }]);
    setYear("");
    setTitleEnglish("");
    setTitleOriginal("");
    setContainerEnglish("");
    setVolume("");
    setIssue("");
    setPages("");
    setPublisher("");
    setPublisherPlace("");
    setEdition("");
    setDoi("");
    setUrl("");
    setAccessedDate("");
    setNotes("");
    onClose();
  };

  const generatePreview = async () => {
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      if (!structured.authors.length) throw new Error("请至少添加一位作者。");
      if (!structured.year) throw new Error("请填写年份。");
      if (!structured.title_english && !structured.title_original) throw new Error("请填写标题。");
      const result = await renderCitation({ structured, localePolicy, enableCrossref });
      setPreview(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法生成预览。");
    } finally {
      setLoading(false);
    }
  };

  const footer = step === 1 ? (
    <div className="flex justify-end gap-3">
      <Button variant="secondary" onClick={close}>取消</Button>
      <Button onClick={() => setStep(2)}>下一步</Button>
    </div>
  ) : (
    <div className="flex flex-wrap justify-end gap-3">
      <Button variant="secondary" onClick={() => setStep(1)}>
        返回
      </Button>
      <Button variant="outline" onClick={generatePreview} disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        生成预览
      </Button>
      <Button onClick={() => preview && onConfirm(preview)} disabled={!preview}>
        添加到文献库
      </Button>
    </div>
  );

  return (
    <Drawer
      open={open}
      onClose={close}
      title="手动添加文献"
      description={step === 1 ? "第 1 步：选择文献类型" : "第 2 步：填写必要字段并生成预览"}
      widthClassName="max-w-2xl"
      footer={footer}
    >
      {step === 1 ? (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">
            先选择类型：我们会根据类型显示必要的字段，并在下一步根据 APA 7 规则生成预览。
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {TYPE_OPTIONS.map(({ value, label, icon: Icon, description }) => (
              <button
                key={value}
                onClick={() => setWorkType(value)}
                className={
                  "flex items-start gap-3 rounded-lg border-2 p-4 text-left transition-colors " +
                  (workType === value ? "border-primary bg-primary/5" : "border-border hover:border-primary/50")
                }
              >
                <Icon className="mt-0.5 h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
              </button>
            ))}
          </div>

          <div className="grid gap-4 rounded-lg border border-dashed border-border p-4 md:grid-cols-2">
            <div className="space-y-1">
              <Label>输出语言</Label>
              <Select value={localePolicy} onChange={(event) => setLocalePolicy(event.target.value as LocalePolicy)}>
                <option value="en_all">全英文（默认）</option>
                <option value="en_bracket">原文 + 英文括注</option>
              </Select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={enableCrossref}
                  onChange={(event) => setEnableCrossref(event.target.checked)}
                />
                若填写 DOI，则使用 Crossref 增强
              </label>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="space-y-2">
            <Label>作者</Label>
            <div className="space-y-2">
              {authors.map((author, index) => (
                <div key={index} className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2">
                  <Input
                    value={author.given}
                    placeholder={author.organization ? "机构名称" : "名 (Given)"}
                    onChange={(event) => updateAuthor(index, "given", event.target.value)}
                  />
                  <Input
                    value={author.family}
                    placeholder={author.organization ? "(留空)" : "姓 (Family)"}
                    onChange={(event) => updateAuthor(index, "family", event.target.value)}
                    disabled={author.organization}
                  />
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={author.organization}
                      onChange={(event) => updateAuthor(index, "organization", event.target.checked)}
                    />
                    机构
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeAuthor(index)}
                    disabled={authors.length === 1}
                    aria-label="删除作者"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addAuthor}>
              <Plus className="h-3.5 w-3.5" /> 添加作者
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1">
              <Label>年份</Label>
              <Input
                value={year}
                maxLength={4}
                onChange={(event) => setYear(event.target.value.replace(/\D/g, ""))}
                placeholder="2024"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label>标题（英文）</Label>
              <Input
                value={titleEnglish}
                onChange={(event) => setTitleEnglish(event.target.value)}
                placeholder="Title or English translation"
              />
            </div>
            <div className="space-y-1 md:col-span-3">
              <Label>原文标题（可选）</Label>
              <Input
                value={titleOriginal}
                onChange={(event) => setTitleOriginal(event.target.value)}
                placeholder="非英文来源的原始标题"
              />
            </div>
          </div>

          {showContainer && (
            <div className="space-y-1">
              <Label>{workType === "journal_article" ? "期刊名称（英文）" : "图书名称"}</Label>
              <Input
                value={containerEnglish}
                onChange={(event) => setContainerEnglish(event.target.value)}
                placeholder={workType === "journal_article" ? "Nature" : "Handbook of research methods"}
              />
            </div>
          )}

          {showIssueVolume && (
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1">
                <Label>卷</Label>
                <Input value={volume} onChange={(event) => setVolume(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>期</Label>
                <Input value={issue} onChange={(event) => setIssue(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>页码</Label>
                <Input value={pages} onChange={(event) => setPages(event.target.value)} placeholder="12–34" />
              </div>
            </div>
          )}

          {showPublisher && (
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1">
                <Label>出版社</Label>
                <Input value={publisher} onChange={(event) => setPublisher(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>出版地（可选）</Label>
                <Input value={publisherPlace} onChange={(event) => setPublisherPlace(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>版次（可选）</Label>
                <Input value={edition} onChange={(event) => setEdition(event.target.value)} placeholder="2nd ed." />
              </div>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <Label>DOI（可选）</Label>
              <Input value={doi} onChange={(event) => setDoi(event.target.value)} placeholder="10.1038/nature12373" />
            </div>
            {showUrl && (
              <div className="space-y-1">
                <Label>URL {workType === "webpage" ? "（必填）" : "（可选）"}</Label>
                <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/article" />
              </div>
            )}
            {showAccessedDate && (
              <div className="space-y-1">
                <Label>访问日期</Label>
                <Input type="date" value={accessedDate} onChange={(event) => setAccessedDate(event.target.value)} />
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Label>备注（可选）</Label>
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} />
          </div>

          {error && <Alert tone="danger">{error}</Alert>}

          {preview && (
            <div className="space-y-3 rounded-lg border border-border p-4">
              <p className="text-sm font-medium text-muted-foreground">APA 7 预览</p>
              <CitationResultView result={preview} />
            </div>
          )}
        </div>
      )}
    </Drawer>
  );

  function updateAuthor(index: number, field: keyof AuthorInput, value: string | boolean) {
    setAuthors((current) =>
      current.map((author, idx) =>
        idx === index
          ? {
              ...author,
              [field]: value,
              ...(field === "organization" && value === true ? { family: "" } : {}),
            }
          : author,
      ),
    );
  }

  function addAuthor() {
    setAuthors((current) => [...current, { given: "", family: "", organization: false }]);
  }

  function removeAuthor(index: number) {
    setAuthors((current) => (current.length === 1 ? current : current.filter((_, idx) => idx !== index)));
  }
}
