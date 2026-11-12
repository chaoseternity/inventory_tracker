"use client";

import { useState, useRef, useMemo } from "react";
import {
  FolderArchive,
  Upload,
  Download,
  ExternalLink,
  Search,
  Trash2,
  Edit3,
  Camera,
  Video,
  Sliders,
  FileText,
  Calendar,
  User,
  AlertCircle,
  Loader2,
  X,
  FileUp,
  type LucideIcon,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import type { EventSection, ResourceItem, Role } from "@/lib/types";
import { formatDate } from "@/lib/timezone";
import { readErrorMessage, networkErrorMessage } from "@/lib/fetch-error";
import { isAdminRole, isVerifiedOrHigher } from "@/lib/utils";

interface ResourceBankClientProps {
  initialResources: ResourceItem[];
  role: Role;
  currentUserId: number | null;
}

const SECTIONS: {
  id: EventSection;
  label: string;
  fullName: string;
  icon: LucideIcon;
  badgeClass: string;
  activeTabClass: string;
}[] = [
  {
    id: "photo",
    label: "Photo",
    fullName: "Photography",
    icon: Camera,
    badgeClass:
      "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800",
    activeTabClass: "bg-blue-600 hover:bg-blue-700 text-white border-blue-600",
  },
  {
    id: "video",
    label: "Video",
    fullName: "Videography",
    icon: Video,
    badgeClass:
      "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800",
    activeTabClass: "bg-purple-600 hover:bg-purple-700 text-white border-purple-600",
  },
  {
    id: "av",
    label: "AV",
    fullName: "Audio / AV",
    icon: Sliders,
    badgeClass:
      "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800",
    activeTabClass: "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600",
  },
];

const SECTION_META = Object.fromEntries(SECTIONS.map((s) => [s.id, s])) as Record<
  EventSection,
  (typeof SECTIONS)[number]
>;

const ACCEPT_EXTENSIONS =
  ".pdf,.ppt,.pptx,.key,.odp,.doc,.docx,.txt,.md,.csv,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.gif,.mp3,.wav,.mp4,.mov,.zip";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getExtBadge(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0 || dot === fileName.length - 1) return "FILE";
  return fileName.slice(dot + 1).toUpperCase().slice(0, 6);
}

function isPreviewable(item: ResourceItem): boolean {
  const type = item.file_type.toLowerCase();
  const name = item.file_name.toLowerCase();
  return (
    type === "application/pdf" ||
    name.endsWith(".pdf") ||
    type === "image/png" ||
    type === "image/jpeg" ||
    type === "image/webp" ||
    type === "image/gif"
  );
}

export function ResourceBankClient({
  initialResources,
  role,
  currentUserId,
}: ResourceBankClientProps) {
  const [resources, setResources] = useState<ResourceItem[]>(initialResources);
  const [activeSection, setActiveSection] = useState<EventSection | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [bannerError, setBannerError] = useState<string | null>(null);

  // Upload modal state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadSection, setUploadSection] = useState<EventSection>("photo");
  const [uploadSessionDate, setUploadSessionDate] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Edit modal state
  const [editingItem, setEditingItem] = useState<ResourceItem | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editSection, setEditSection] = useState<EventSection>("photo");
  const [editSessionDate, setEditSessionDate] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<number | null>(null);

  const canUpload = isVerifiedOrHigher(role);

  function canModify(item: ResourceItem): boolean {
    if (isAdminRole(role)) return true;
    if (role !== "verified") return false;
    return currentUserId !== null && item.uploaded_by === currentUserId;
  }

  const sectionCounts = useMemo(() => {
    const counts: Record<EventSection | "all", number> = {
      all: resources.length,
      photo: 0,
      video: 0,
      av: 0,
    };
    for (const r of resources) {
      if (r.section in counts) counts[r.section]++;
    }
    return counts;
  }, [resources]);

  const filteredResources = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return resources.filter((item) => {
      if (activeSection !== "all" && item.section !== activeSection) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        (item.description && item.description.toLowerCase().includes(q)) ||
        item.file_name.toLowerCase().includes(q) ||
        (item.uploaded_by_name && item.uploaded_by_name.toLowerCase().includes(q)) ||
        (item.session_date && item.session_date.includes(q))
      );
    });
  }, [resources, activeSection, searchQuery]);

  function openUploadModal() {
    setSelectedFile(null);
    setUploadTitle("");
    setUploadSection(activeSection === "all" ? "photo" : activeSection);
    setUploadSessionDate("");
    setUploadDescription("");
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setUploadOpen(true);
  }

  function handleFileChosen(file: File | null | undefined) {
    if (!file) return;
    setUploadError(null);
    setSelectedFile(file);
    if (!uploadTitle.trim()) {
      setUploadTitle(file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " "));
    }
  }

  async function handleUploadSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFile) {
      setUploadError("Please select a file to upload.");
      return;
    }
    if (!uploadTitle.trim()) {
      setUploadError("Please enter a title for this session material.");
      return;
    }

    setUploading(true);
    setUploadError(null);

    try {
      const fd = new FormData();
      fd.append("file", selectedFile);
      fd.append("title", uploadTitle.trim());
      fd.append("section", uploadSection);
      if (uploadSessionDate.trim()) fd.append("session_date", uploadSessionDate.trim());
      if (uploadDescription.trim()) fd.append("description", uploadDescription.trim());

      const res = await fetch("/api/resources", {
        method: "POST",
        body: fd,
      });

      if (!res.ok) {
        setUploadError(await readErrorMessage(res, "Failed to upload session material."));
        return;
      }

      const created = (await res.json()) as ResourceItem;
      setResources((prev) => [created, ...prev]);
      setUploadOpen(false);
    } catch (err) {
      setUploadError(networkErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  function openEditModal(item: ResourceItem) {
    setEditingItem(item);
    setEditTitle(item.title);
    setEditSection(item.section);
    setEditSessionDate(item.session_date ?? "");
    setEditDescription(item.description ?? "");
    setEditError(null);
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingItem) return;
    if (!editTitle.trim()) {
      setEditError("Title is required.");
      return;
    }

    setSavingEdit(true);
    setEditError(null);

    try {
      const res = await fetch(`/api/resources/${editingItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle.trim(),
          section: editSection,
          session_date: editSessionDate.trim() || null,
          description: editDescription.trim() || null,
        }),
      });

      if (!res.ok) {
        setEditError(await readErrorMessage(res, "Failed to update resource."));
        return;
      }

      const updated = (await res.json()) as ResourceItem;
      setResources((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setEditingItem(null);
    } catch (err) {
      setEditError(networkErrorMessage(err));
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(item: ResourceItem) {
    if (!confirm(`Delete "${item.title}" (${item.file_name})? This also deletes the file from R2 storage.`)) {
      return;
    }
    setDeletingId(item.id);
    setBannerError(null);

    try {
      const res = await fetch(`/api/resources/${item.id}`, { method: "DELETE" });
      if (!res.ok) {
        setBannerError(await readErrorMessage(res, "Failed to delete resource."));
        return;
      }
      setResources((prev) => prev.filter((r) => r.id !== item.id));
    } catch (err) {
      setBannerError(networkErrorMessage(err));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="px-4 py-4 md:px-6 md:py-8 w-full space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <FolderArchive className="h-6 w-6 text-primary" />
            Resource Bank
          </h2>
          <p className="text-muted-foreground text-sm mt-0.5">
            Training slides, session handouts, and reference materials uploaded by Photo, Video, and AV sections.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canUpload && (
            <Button onClick={openUploadModal} className="gap-1.5">
              <Upload className="h-4 w-4" />
              Upload Material
            </Button>
          )}
        </div>
      </div>

      {bannerError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {bannerError}
          </span>
          <button type="button" onClick={() => setBannerError(null)} aria-label="Dismiss error">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Section Tabs & Search Toolbar */}
      <div className="flex flex-col md:flex-row gap-3 md:items-center justify-between">
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant={activeSection === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveSection("all")}
            className="text-xs h-8 gap-1.5"
          >
            All Sections
            <span className="text-[10px] opacity-80 font-mono">({sectionCounts.all})</span>
          </Button>

          {SECTIONS.map((sec) => {
            const Icon = sec.icon;
            const isSelected = activeSection === sec.id;
            return (
              <Button
                key={sec.id}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setActiveSection(sec.id)}
                className={`text-xs h-8 gap-1.5 ${isSelected ? sec.activeTabClass : ""}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {sec.label}
                <span className="text-[10px] opacity-80 font-mono">({sectionCounts[sec.id]})</span>
              </Button>
            );
          })}
        </div>

        <div className="relative flex-1 md:max-w-xs">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search slides, topic, filename..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-xs md:text-sm"
          />
        </div>
      </div>

      {/* Resource Cards Grid */}
      {filteredResources.length === 0 ? (
        <div className="p-12 text-center border rounded-xl bg-card space-y-3">
          <FolderArchive className="h-10 w-10 text-muted-foreground/40 mx-auto" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">No session materials found</p>
            <p className="text-xs text-muted-foreground">
              {searchQuery || activeSection !== "all"
                ? "Try clearing your search or switching sections."
                : "Upload training slides, PDFs, or session handouts for members to download."}
            </p>
          </div>
          {canUpload && !searchQuery && (
            <Button onClick={openUploadModal} size="sm" className="gap-1.5 mt-2">
              <Upload className="h-3.5 w-3.5" />
              Upload First Material
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredResources.map((item) => {
            const meta = SECTION_META[item.section];
            const SectionIcon = meta.icon;
            const ext = getExtBadge(item.file_name);
            const editable = canModify(item);

            return (
              <div
                key={item.id}
                className="border rounded-xl p-4 bg-card hover:shadow-md transition-shadow flex flex-col justify-between space-y-3"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="outline" className={`text-[11px] font-semibold gap-1 ${meta.badgeClass}`}>
                        <SectionIcon className="h-3 w-3" />
                        {meta.label}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px] font-mono">
                        {ext} · {formatBytes(item.file_size)}
                      </Badge>
                    </div>

                    {editable && (
                      <div className="flex items-center gap-0.5 -mr-1 -mt-1 shrink-0">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditModal(item)}
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          title="Edit material details"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={deletingId === item.id}
                          onClick={() => handleDelete(item)}
                          className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          title="Delete material"
                        >
                          {deletingId === item.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="font-bold text-sm text-foreground line-clamp-2 leading-snug">
                      {item.title}
                    </h3>
                    <p className="text-[11px] font-mono text-muted-foreground truncate mt-0.5 flex items-center gap-1">
                      <FileText className="h-3 w-3 shrink-0" />
                      {item.file_name}
                    </p>
                  </div>

                  {item.description && (
                    <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                      {item.description}
                    </p>
                  )}
                </div>

                <div className="pt-3 border-t space-y-2.5 text-[11px] text-muted-foreground">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {item.session_date ? `Session: ${item.session_date}` : formatDate(item.created_at)}
                    </span>
                    {item.uploaded_by_name && (
                      <span className="flex items-center gap-1 truncate">
                        <User className="h-3 w-3 shrink-0" />
                        {item.uploaded_by_name}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <a
                      href={`/api/resources/${item.id}/file?download=1`}
                      download
                      className={buttonVariants({
                        variant: "default",
                        size: "sm",
                        className: "flex-1 text-xs h-8 gap-1.5",
                      })}
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </a>
                    {isPreviewable(item) && (
                      <a
                        href={`/api/resources/${item.id}/file`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={buttonVariants({
                          variant: "outline",
                          size: "sm",
                          className: "text-xs h-8 px-2.5 gap-1 shrink-0",
                        })}
                        title="Open in browser"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        View
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload Session Material Modal */}
      <Dialog open={uploadOpen} onOpenChange={(o) => !uploading && setUploadOpen(o)}>
        <DialogContent className="max-w-lg w-[95vw]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <Upload className="h-4.5 w-4.5 text-primary" />
              Upload Session Material
            </DialogTitle>
            <DialogDescription className="text-xs">
              Files are uploaded directly to Cloudflare R2 object storage for members to view and download (max 50 MB).
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleUploadSubmit} className="space-y-4">
            {/* Section Picker */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Section</Label>
              <div className="grid grid-cols-3 gap-2">
                {SECTIONS.map((sec) => {
                  const Icon = sec.icon;
                  const active = uploadSection === sec.id;
                  return (
                    <button
                      key={sec.id}
                      type="button"
                      onClick={() => setUploadSection(sec.id)}
                      className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                        active
                          ? sec.activeTabClass
                          : "bg-background hover:bg-muted text-muted-foreground"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {sec.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* File Dropzone */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">File (Slides, PDF, Handout, ZIP)</Label>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  handleFileChosen(e.dataTransfer.files?.[0]);
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors ${
                  dragOver
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50 hover:bg-muted/30"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPT_EXTENSIONS}
                  className="hidden"
                  onChange={(e) => handleFileChosen(e.target.files?.[0])}
                />
                {selectedFile ? (
                  <div className="space-y-1">
                    <FileText className="h-7 w-7 text-primary mx-auto" />
                    <p className="text-xs font-semibold text-foreground break-all">{selectedFile.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatBytes(selectedFile.size)} · Click or drop another file to replace
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <FileUp className="h-7 w-7 text-muted-foreground mx-auto" />
                    <p className="text-xs font-medium text-foreground">
                      Click to choose a file or drag &amp; drop here
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Supports PPTX, PDF, Keynote, DOCX, Images, Audio/Video, ZIP (up to 50 MB)
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="res-title" className="text-xs font-semibold">
                Title
              </Label>
              <Input
                id="res-title"
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                placeholder="e.g., Week 3 Lighting & Exposure Slides"
                maxLength={200}
                required
              />
            </div>

            {/* Optional Session Date */}
            <div className="space-y-1.5">
              <Label htmlFor="res-date" className="text-xs font-semibold">
                Session Date <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="res-date"
                type="date"
                value={uploadSessionDate}
                onChange={(e) => setUploadSessionDate(e.target.value)}
              />
            </div>

            {/* Optional Description */}
            <div className="space-y-1.5">
              <Label htmlFor="res-desc" className="text-xs font-semibold">
                Notes / Summary <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <textarea
                id="res-desc"
                value={uploadDescription}
                onChange={(e) => setUploadDescription(e.target.value)}
                placeholder="Brief overview of what this session covers..."
                rows={3}
                maxLength={2000}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs md:text-sm shadow-xs focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </div>

            {uploadError && (
              <p className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2 flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {uploadError}
              </p>
            )}

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={uploading}
                onClick={() => setUploadOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={uploading || !selectedFile} className="gap-1.5">
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Uploading to R2…
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Upload Material
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Resource Metadata Modal */}
      <Dialog open={!!editingItem} onOpenChange={(o) => !o && !savingEdit && setEditingItem(null)}>
        <DialogContent className="max-w-md w-[95vw]">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Edit Material Details</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Section</Label>
              <div className="grid grid-cols-3 gap-2">
                {SECTIONS.map((sec) => {
                  const Icon = sec.icon;
                  const active = editSection === sec.id;
                  return (
                    <button
                      key={sec.id}
                      type="button"
                      onClick={() => setEditSection(sec.id)}
                      className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                        active
                          ? sec.activeTabClass
                          : "bg-background hover:bg-muted text-muted-foreground"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {sec.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-title" className="text-xs font-semibold">
                Title
              </Label>
              <Input
                id="edit-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                maxLength={200}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-date" className="text-xs font-semibold">
                Session Date
              </Label>
              <Input
                id="edit-date"
                type="date"
                value={editSessionDate}
                onChange={(e) => setEditSessionDate(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-desc" className="text-xs font-semibold">
                Notes / Summary
              </Label>
              <textarea
                id="edit-desc"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={3}
                maxLength={2000}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs md:text-sm shadow-xs focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </div>

            {editError && (
              <p className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2 flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {editError}
              </p>
            )}

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={savingEdit}
                onClick={() => setEditingItem(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={savingEdit}>
                {savingEdit ? "Saving…" : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
