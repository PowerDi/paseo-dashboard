import {
  ChevronDown,
  ChevronRight,
  Download,
  File,
  FileCode2,
  Folder,
  FolderOpen,
  LoaderCircle,
  Pencil,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CodeBlock } from "@/components/code-block";
import { useErrorAlert } from "@/components/error-alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  decodeTextFile,
  fileNameFromPath,
  MAX_TEXT_FILE_BYTES,
  parentDirectoryPath,
} from "@/lib/file-operations";
import type {
  DashboardFileDirectory,
  DashboardFileEntry,
  DashboardFileVersion,
} from "@/paseo/dashboardRuntime";
import { dashboardRuntime } from "@/paseo/dashboardRuntime";

interface WorkspaceFileExplorerProps {
  hostId: string;
  cwd: string;
}

type DirectoryState =
  | { status: "loading" }
  | { status: "ready"; directory: DashboardFileDirectory }
  | { status: "error"; message: string };

type FileState =
  | { status: "empty" }
  | { status: "loading"; path: string }
  | { status: "error"; path: string; message: string }
  | {
      status: "ready";
      path: string;
      content: string;
      size: number;
      modifiedAt: string;
      revision?: string;
      language: string;
    };

interface EditorState {
  draft: string;
  baseModifiedAt: string;
  baseRevision?: string;
  saving: boolean;
  error: string | null;
  conflict: DashboardFileVersion | null;
}

type PendingAction = "rename" | "delete" | "upload" | "download" | null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatModifiedAt(value: string, language: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function languageForPath(path: string): string {
  const fileName = fileNameFromPath(path).toLowerCase();
  const extension = fileName.includes(".") ? fileName.split(".").at(-1) : undefined;
  if (!extension) return "plaintext";

  switch (extension) {
    case "cjs":
    case "js":
    case "jsx":
    case "mjs":
      return "javascript";
    case "css":
      return "css";
    case "html":
    case "xml":
      return "xml";
    case "json":
      return "json";
    case "md":
    case "markdown":
      return "markdown";
    case "py":
      return "python";
    case "sh":
    case "bash":
      return "bash";
    case "ts":
    case "tsx":
      return "typescript";
    case "yaml":
    case "yml":
      return "yaml";
    default:
      return "plaintext";
  }
}

function entryIcon(entry: DashboardFileEntry) {
  if (entry.kind === "directory") return <Folder size={14} />;
  return languageForPath(entry.path) === "plaintext" ? <File size={14} /> : <FileCode2 size={14} />;
}

function updatedEntry(entry: DashboardFileEntry, path: string): DashboardFileEntry {
  return { ...entry, name: fileNameFromPath(path), path };
}

export function WorkspaceFileExplorer({ hostId, cwd }: WorkspaceFileExplorerProps) {
  const { t, i18n } = useTranslation();
  const showError = useErrorAlert();
  const [directories, setDirectories] = useState<Map<string, DirectoryState>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));
  const [selectedEntry, setSelectedEntry] = useState<DashboardFileEntry | null>(null);
  const [fileReloadRevision, setFileReloadRevision] = useState(0);
  const [fileState, setFileState] = useState<FileState>({ status: "empty" });
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [renameTarget, setRenameTarget] = useState<DashboardFileEntry | null>(null);
  const [renameName, setRenameName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DashboardFileEntry | null>(null);
  const requestGeneration = useRef(0);
  const editorRef = useRef<EditorState | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const downloadAnchorRef = useRef<HTMLAnchorElement | null>(null);
  const selectedPath = selectedEntry?.kind === "file" ? selectedEntry.path : null;
  const targetDirectoryPath = selectedEntry
    ? selectedEntry.kind === "directory"
      ? selectedEntry.path
      : parentDirectoryPath(selectedEntry.path)
    : "";

  const setEditorState = useCallback((next: EditorState | null) => {
    editorRef.current = next;
    setEditor(next);
  }, []);

  const loadDirectory = useCallback(
    async (path: string) => {
      const generation = requestGeneration.current;
      setDirectories((current) => new Map(current).set(path, { status: "loading" }));
      try {
        const directory = await dashboardRuntime.listDirectory(hostId, cwd, path);
        if (generation !== requestGeneration.current) return;
        setDirectories((current) => new Map(current).set(path, { status: "ready", directory }));
      } catch (error) {
        if (generation !== requestGeneration.current) return;
        setDirectories((current) =>
          new Map(current).set(path, { status: "error", message: errorMessage(error) }),
        );
      }
    },
    [cwd, hostId],
  );

  useEffect(() => {
    requestGeneration.current += 1;
    setDirectories(new Map([["", { status: "loading" }]]));
    setExpanded(new Set([""]));
    setSelectedEntry(null);
    setFileState({ status: "empty" });
    setEditorState(null);
    setRenameTarget(null);
    setDeleteTarget(null);
    void loadDirectory("");
  }, [loadDirectory, setEditorState]);

  const toggleDirectory = useCallback(
    (entry: DashboardFileEntry) => {
      setSelectedEntry(entry);
      setEditorState(null);
      const isExpanded = expanded.has(entry.path);
      setExpanded((current) => {
        const next = new Set(current);
        if (isExpanded) next.delete(entry.path);
        else next.add(entry.path);
        return next;
      });
      const directory = directories.get(entry.path);
      if (!isExpanded && (!directory || directory.status === "error")) {
        void loadDirectory(entry.path);
      }
    },
    [directories, expanded, loadDirectory, setEditorState],
  );

  const selectFile = useCallback(
    (entry: DashboardFileEntry) => {
      setSelectedEntry(entry);
      setEditorState(null);
      setFileReloadRevision((current) => current + 1);
    },
    [setEditorState],
  );

  useEffect(() => {
    const path = selectedPath;
    const generation = requestGeneration.current;
    if (!path) {
      setFileState({ status: "empty" });
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let readRevision = 0;
    setFileState({ status: "loading", path });

    const applyVersion = (version: DashboardFileVersion): void => {
      const currentEditor = editorRef.current;
      if (currentEditor) {
        if (
          version.status === "ready" &&
          (currentEditor.baseRevision
            ? version.revision === currentEditor.baseRevision
            : version.modifiedAt === currentEditor.baseModifiedAt)
        ) {
          return;
        }
        setEditorState({ ...currentEditor, conflict: version, error: null });
        return;
      }
      if (version.status === "missing") {
        setFileState({ status: "error", path, message: t("workspace.files.missing") });
      } else if (version.status === "error") {
        setFileState({ status: "error", path, message: version.error });
      }
    };

    const loadFile = async () => {
      const currentReadRevision = ++readRevision;
      try {
        const result = await dashboardRuntime.readFile(hostId, cwd, path);
        if (
          cancelled ||
          generation !== requestGeneration.current ||
          currentReadRevision !== readRevision
        ) {
          return;
        }
        if (result.kind !== "text") {
          setFileState({
            status: "error",
            path,
            message: t("workspace.files.unsupported", { kind: result.kind }),
          });
          return;
        }
        setFileState({
          status: "ready",
          path,
          content: new TextDecoder("utf-8").decode(result.bytes),
          size: result.size,
          modifiedAt: result.modifiedAt,
          revision: result.revision,
          language: languageForPath(path),
        });
      } catch (error) {
        if (
          cancelled ||
          generation !== requestGeneration.current ||
          currentReadRevision !== readRevision
        ) {
          return;
        }
        setFileState({
          status: "error",
          path,
          message: t("workspace.files.readError", { message: errorMessage(error) }),
        });
      }
    };

    const handleVersion = (version: DashboardFileVersion) => {
      if (cancelled || generation !== requestGeneration.current) return;
      if (version.status === "ready" && !editorRef.current) {
        void loadFile();
      } else {
        readRevision += 1;
        applyVersion(version);
      }
    };

    void (async () => {
      try {
        const subscription = await dashboardRuntime.subscribeFile(
          hostId,
          { cwd, path },
          handleVersion,
        );
        if (cancelled || generation !== requestGeneration.current) {
          subscription.unsubscribe();
          return;
        }
        unsubscribe = subscription.unsubscribe;
        if (subscription.initial.status === "ready") await loadFile();
        else applyVersion(subscription.initial);
      } catch (error) {
        if (cancelled || generation !== requestGeneration.current) return;
        setFileState({
          status: "error",
          path,
          message: t("workspace.files.subscribeError", { message: errorMessage(error) }),
        });
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [cwd, fileReloadRevision, hostId, selectedPath, t]);

  const beginEdit = useCallback(() => {
    if (fileState.status !== "ready") return;
    setEditorState({
      draft: fileState.content,
      baseModifiedAt: fileState.modifiedAt,
      baseRevision: fileState.revision,
      saving: false,
      error: null,
      conflict: null,
    });
  }, [fileState, setEditorState]);

  const reloadFile = useCallback(() => {
    setEditorState(null);
    setFileReloadRevision((current) => current + 1);
  }, [setEditorState]);

  async function saveFile(expectedVersion?: Extract<DashboardFileVersion, { status: "ready" }>) {
    if (fileState.status !== "ready" || !editor || editor.saving) return;
    if (editor.conflict && !expectedVersion) return;
    const saving = { ...editor, saving: true, error: null };
    setEditorState(saving);
    try {
      const result = await dashboardRuntime.writeFile(hostId, {
        cwd,
        path: fileState.path,
        content: editor.draft,
        expectedModifiedAt: expectedVersion?.modifiedAt ?? editor.baseModifiedAt,
        expectedRevision: expectedVersion?.revision ?? editor.baseRevision,
      });
      if (result.status === "error") {
        const currentEditor = editorRef.current ?? editor;
        setEditorState({ ...currentEditor, saving: false, error: result.error });
        return;
      }
      if (result.status === "conflict") {
        setEditorState({ ...editor, saving: false, error: null, conflict: result.version });
        return;
      }
      setFileState({
        ...fileState,
        content: editor.draft,
        size: result.size,
        modifiedAt: result.modifiedAt,
        revision: result.revision,
      });
      setEditorState(null);
    } catch (error) {
      const currentEditor = editorRef.current ?? editor;
      setEditorState({
        ...currentEditor,
        saving: false,
        error: t("workspace.files.writeError", { message: errorMessage(error) }),
      });
    }
  }

  function openRename() {
    if (!selectedEntry) return;
    setRenameName(selectedEntry.name);
    setRenameTarget(selectedEntry);
  }

  async function renameEntry(event: React.FormEvent) {
    event.preventDefault();
    const target = renameTarget;
    if (!target || pendingAction) return;
    const name = renameName.trim();
    if (!name) return;
    setPendingAction("rename");
    try {
      const result = await dashboardRuntime.renameFileEntry(hostId, {
        cwd,
        path: target.path,
        name,
      });
      if (!result.success || !result.renamedPath) {
        throw new Error(result.error ?? t("workspace.files.renameFailed"));
      }
      const parentPath = parentDirectoryPath(target.path);
      const nextEntry = updatedEntry(target, result.renamedPath);
      setSelectedEntry(nextEntry);
      setEditorState(null);
      setRenameTarget(null);
      if (target.kind === "directory") {
        setDirectories((current) => {
          const next = new Map(current);
          for (const path of next.keys()) {
            if (path === target.path || path.startsWith(`${target.path}/`)) next.delete(path);
          }
          return next;
        });
        setExpanded((current) => {
          const next = new Set(current);
          for (const path of next) {
            if (path === target.path || path.startsWith(`${target.path}/`)) next.delete(path);
          }
          return next;
        });
      }
      await loadDirectory(parentPath);
    } catch (error) {
      showError(t("workspace.files.renameError", { message: errorMessage(error) }));
    } finally {
      setPendingAction(null);
    }
  }

  async function deleteEntry() {
    const target = deleteTarget;
    if (!target || pendingAction) return;
    setPendingAction("delete");
    try {
      const result = await dashboardRuntime.deleteFileEntry(hostId, {
        cwd,
        path: target.path,
      });
      if (!result.success) throw new Error(result.error ?? t("workspace.files.deleteFailed"));
      const deletedPath = target.path;
      const parentPath = parentDirectoryPath(deletedPath);
      setDirectories((current) => {
        const next = new Map(current);
        for (const path of next.keys()) {
          if (path === deletedPath || path.startsWith(`${deletedPath}/`)) next.delete(path);
        }
        return next;
      });
      setExpanded((current) => {
        const next = new Set(current);
        for (const path of next) {
          if (path === deletedPath || path.startsWith(`${deletedPath}/`)) next.delete(path);
        }
        return next;
      });
      if (selectedEntry?.path === deletedPath) {
        setSelectedEntry(null);
        setEditorState(null);
      }
      setDeleteTarget(null);
      await loadDirectory(parentPath);
    } catch (error) {
      showError(t("workspace.files.deleteError", { message: errorMessage(error) }));
    } finally {
      setPendingAction(null);
    }
  }

  async function uploadTextFile(file: globalThis.File) {
    if (pendingAction) return;
    const parentPath = targetDirectoryPath;
    setPendingAction("upload");
    try {
      if (file.size > MAX_TEXT_FILE_BYTES) {
        throw new Error(t("workspace.files.uploadTooLarge"));
      }
      const decoded = decodeTextFile(new Uint8Array(await file.arrayBuffer()));
      if (decoded.status === "binary")
        throw new Error(t("workspace.files.binaryUploadUnsupported"));
      if (decoded.status === "too-large") throw new Error(t("workspace.files.uploadTooLarge"));

      const created = await dashboardRuntime.createFileEntry(hostId, {
        cwd,
        parentPath,
        name: file.name,
        kind: "file",
      });
      if (!created.success || !created.path) {
        throw new Error(created.error ?? t("workspace.files.uploadCreateFailed"));
      }
      const initial = await dashboardRuntime.readFile(hostId, cwd, created.path);
      if (initial.kind !== "text") throw new Error(t("workspace.files.binaryUploadUnsupported"));
      const written = await dashboardRuntime.writeFile(hostId, {
        cwd,
        path: created.path,
        content: decoded.content,
        expectedModifiedAt: initial.modifiedAt,
        expectedRevision: initial.revision,
      });
      if (written.status !== "written") {
        throw new Error(
          written.status === "error" ? written.error : t("workspace.files.uploadConflict"),
        );
      }
      await loadDirectory(parentPath);
      setSelectedEntry({
        name: fileNameFromPath(created.path),
        path: created.path,
        kind: "file",
        size: written.size,
        modifiedAt: written.modifiedAt,
      });
      setEditorState(null);
    } catch (error) {
      showError(t("workspace.files.uploadError", { message: errorMessage(error) }));
    } finally {
      setPendingAction(null);
    }
  }

  async function downloadSelectedFile() {
    const target = selectedEntry;
    if (!target || target.kind !== "file" || pendingAction) return;
    setPendingAction("download");
    try {
      const anchor = downloadAnchorRef.current;
      if (!anchor) throw new Error(t("workspace.files.downloadFailed"));
      const result = await dashboardRuntime.readFile(hostId, cwd, target.path);
      const copy = new Uint8Array(result.bytes.byteLength);
      copy.set(result.bytes);
      const href = URL.createObjectURL(
        new Blob([copy.buffer], { type: result.mime || "application/octet-stream" }),
      );
      anchor.href = href;
      anchor.download = target.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(href), 0);
    } catch (error) {
      showError(t("workspace.files.downloadError", { message: errorMessage(error) }));
    } finally {
      setPendingAction(null);
    }
  }

  const renderDirectory = (path: string, depth: number): ReactNode => {
    const state = directories.get(path);
    if (!state || state.status === "loading") {
      return (
        <div className="workspace-file-tree-state" style={{ paddingLeft: `${12 + depth * 16}px` }}>
          <LoaderCircle size={13} className="workspace-file-spinner" />
          {t("workspace.files.loading")}
        </div>
      );
    }
    if (state.status === "error") {
      return (
        <div
          className="workspace-file-tree-state workspace-file-tree-error"
          style={{ paddingLeft: `${12 + depth * 16}px` }}
        >
          <span>{t("workspace.files.directoryError", { message: state.message })}</span>
          <Button type="button" size="xs" variant="ghost" onClick={() => void loadDirectory(path)}>
            {t("workspace.files.retry")}
          </Button>
        </div>
      );
    }

    const entries = [...state.directory.entries].sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
      return left.name.localeCompare(right.name, i18n.language);
    });

    return entries.map((entry) => {
      const isDirectory = entry.kind === "directory";
      const isExpanded = expanded.has(entry.path);
      return (
        <div key={entry.path}>
          <button
            type="button"
            className={`workspace-file-tree-row${selectedEntry?.path === entry.path ? " is-selected" : ""}`}
            style={{ paddingLeft: `${8 + depth * 16}px` }}
            aria-expanded={isDirectory ? isExpanded : undefined}
            onClick={() => (isDirectory ? toggleDirectory(entry) : selectFile(entry))}
          >
            {isDirectory ? (
              isExpanded ? (
                <ChevronDown size={13} />
              ) : (
                <ChevronRight size={13} />
              )
            ) : (
              <span className="workspace-file-tree-spacer" aria-hidden="true" />
            )}
            <span className="workspace-file-tree-icon" aria-hidden="true">
              {isDirectory && isExpanded ? <FolderOpen size={14} /> : entryIcon(entry)}
            </span>
            <span className="workspace-file-tree-name" title={entry.name}>
              {entry.name}
            </span>
          </button>
          {isDirectory && isExpanded && renderDirectory(entry.path, depth + 1)}
        </div>
      );
    });
  };

  const conflictReady = editor?.conflict?.status === "ready" ? editor.conflict : null;

  return (
    <>
      <div className="workspace-file-explorer">
        <aside className="workspace-file-tree" aria-label={t("workspace.files.treeAria")}>
          <div className="workspace-file-tree-header">
            <FolderOpen size={14} />
            <span title={cwd}>{cwd}</span>
          </div>
          <div className="workspace-file-tree-actions">
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              title={t("workspace.files.uploadText")}
              aria-label={t("workspace.files.uploadText")}
              disabled={pendingAction !== null || editor !== null}
              onClick={() => uploadInputRef.current?.click()}
            >
              {pendingAction === "upload" ? (
                <LoaderCircle className="workspace-file-spinner" />
              ) : (
                <Upload />
              )}
            </Button>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              title={t("workspace.files.rename")}
              aria-label={t("workspace.files.rename")}
              disabled={!selectedEntry || pendingAction !== null || editor !== null}
              onClick={openRename}
            >
              <Pencil />
            </Button>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              title={t("workspace.files.download")}
              aria-label={t("workspace.files.download")}
              disabled={selectedEntry?.kind !== "file" || pendingAction !== null}
              onClick={() => void downloadSelectedFile()}
            >
              {pendingAction === "download" ? (
                <LoaderCircle className="workspace-file-spinner" />
              ) : (
                <Download />
              )}
            </Button>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="hover:text-[var(--danger)]"
              title={t("workspace.files.delete")}
              aria-label={t("workspace.files.delete")}
              disabled={!selectedEntry || pendingAction !== null || editor !== null}
              onClick={() => {
                if (selectedEntry) setDeleteTarget(selectedEntry);
              }}
            >
              <Trash2 />
            </Button>
            <span className="workspace-file-tree-target" title={targetDirectoryPath || cwd}>
              {targetDirectoryPath || "."}
            </span>
            <input
              ref={uploadInputRef}
              hidden
              type="file"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void uploadTextFile(file);
              }}
            />
            <a ref={downloadAnchorRef} hidden aria-hidden="true" />
          </div>
          <div className="workspace-file-tree-content">{renderDirectory("", 0)}</div>
        </aside>
        <section className="workspace-file-viewer" aria-label={t("workspace.files.viewerAria")}>
          {fileState.status === "empty" && (
            <div className="workspace-file-state">
              <FileCode2 size={22} />
              <p>{t("workspace.files.selectFile")}</p>
            </div>
          )}
          {fileState.status === "loading" && (
            <div className="workspace-file-state">
              <LoaderCircle size={18} className="workspace-file-spinner" />
              <p>{t("workspace.files.reading")}</p>
            </div>
          )}
          {fileState.status === "error" && (
            <div className="workspace-file-state workspace-file-viewer-error">
              <FileCode2 size={22} />
              <p>{fileState.message}</p>
              <Button type="button" size="xs" variant="ghost" onClick={reloadFile}>
                {t("workspace.files.retry")}
              </Button>
            </div>
          )}
          {fileState.status === "ready" && (
            <>
              <div className="workspace-file-viewer-header">
                <div className="workspace-file-viewer-path" title={fileState.path}>
                  {fileState.path}
                </div>
                <div className="workspace-file-viewer-header-tools">
                  <div className="workspace-file-viewer-meta">
                    <span>{formatFileSize(fileState.size)}</span>
                    <span>{formatModifiedAt(fileState.modifiedAt, i18n.language)}</span>
                  </div>
                  {!editor && (
                    <Button type="button" size="xs" variant="ghost" onClick={beginEdit}>
                      <Pencil />
                      {t("workspace.files.edit")}
                    </Button>
                  )}
                </div>
              </div>
              {editor ? (
                <div className="workspace-file-editor">
                  {editor.conflict && (
                    <div className="workspace-file-conflict">
                      <span>{t("workspace.files.conflict")}</span>
                      <div className="workspace-file-conflict-actions">
                        <Button type="button" size="xs" variant="ghost" onClick={reloadFile}>
                          {t("workspace.files.reload")}
                        </Button>
                        {conflictReady && (
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            disabled={editor.saving}
                            onClick={() => void saveFile(conflictReady)}
                          >
                            {t("workspace.files.overwrite")}
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                  {editor.error && (
                    <div className="workspace-file-editor-error">{editor.error}</div>
                  )}
                  <Textarea
                    className="workspace-file-editor-input"
                    value={editor.draft}
                    disabled={editor.saving}
                    onChange={(event) => {
                      const next = { ...editor, draft: event.target.value, error: null };
                      setEditorState(next);
                    }}
                  />
                  <div className="workspace-file-editor-actions">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={editor.saving}
                      onClick={reloadFile}
                    >
                      <X />
                      {t("workspace.files.cancelEdit")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={editor.saving || editor.conflict !== null}
                      onClick={() => void saveFile()}
                    >
                      {editor.saving ? (
                        <LoaderCircle className="workspace-file-spinner" />
                      ) : (
                        <Save />
                      )}
                      {t("workspace.files.save")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="workspace-file-viewer-content">
                  <CodeBlock code={fileState.content} language={fileState.language} />
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open && pendingAction !== "rename") setRenameTarget(null);
        }}
      >
        <DialogContent>
          <form onSubmit={(event) => void renameEntry(event)}>
            <DialogHeader>
              <DialogTitle>{t("workspace.files.renameTitle")}</DialogTitle>
              <DialogDescription>{renameTarget?.path}</DialogDescription>
            </DialogHeader>
            <input
              autoFocus
              className="workspace-file-dialog-input"
              value={renameName}
              disabled={pendingAction === "rename"}
              onChange={(event) => setRenameName(event.target.value)}
            />
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="ghost"
                disabled={pendingAction === "rename"}
                onClick={() => setRenameTarget(null)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={pendingAction === "rename" || renameName.trim().length === 0}
              >
                {pendingAction === "rename" && <LoaderCircle className="workspace-file-spinner" />}
                {t("workspace.files.rename")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && pendingAction !== "delete") setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("workspace.files.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.kind === "directory"
                ? t("workspace.files.deleteDirectoryDescription", { path: deleteTarget.path })
                : t("workspace.files.deleteFileDescription", { path: deleteTarget?.path ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendingAction === "delete"}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pendingAction === "delete"}
              onClick={(event) => {
                event.preventDefault();
                void deleteEntry();
              }}
            >
              {pendingAction === "delete" && <LoaderCircle className="workspace-file-spinner" />}
              {t("workspace.files.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
