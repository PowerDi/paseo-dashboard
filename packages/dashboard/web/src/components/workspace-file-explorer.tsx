import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode2,
  Folder,
  FolderOpen,
  LoaderCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CodeBlock } from "@/components/code-block";
import { Button } from "@/components/ui/button";
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
      language: string;
    };

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
  const fileName = path.split("/").at(-1)?.toLowerCase() ?? "";
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
    case "xml":
      return "xml";
    case "yaml":
    case "yml":
      return "yaml";
    default:
      return "plaintext";
  }
}

function entryIcon(entry: DashboardFileEntry) {
  if (entry.kind === "directory") return <Folder size={14} />;
  const language = languageForPath(entry.path);
  return language === "plaintext" ? <File size={14} /> : <FileCode2 size={14} />;
}

export function WorkspaceFileExplorer({ hostId, cwd }: WorkspaceFileExplorerProps) {
  const { t, i18n } = useTranslation();
  const [directories, setDirectories] = useState<Map<string, DirectoryState>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileReloadRevision, setFileReloadRevision] = useState(0);
  const [fileState, setFileState] = useState<FileState>({ status: "empty" });
  const requestGeneration = useRef(0);

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
    setSelectedPath(null);
    setFileState({ status: "empty" });
    void loadDirectory("");
  }, [loadDirectory]);

  const toggleDirectory = useCallback(
    (path: string) => {
      const isExpanded = expanded.has(path);
      setExpanded((current) => {
        const next = new Set(current);
        if (isExpanded) next.delete(path);
        else next.add(path);
        return next;
      });
      const directory = directories.get(path);
      if (!isExpanded && (!directory || directory.status === "error")) void loadDirectory(path);
    },
    [directories, expanded, loadDirectory],
  );

  const selectFile = useCallback((path: string) => {
    setSelectedPath(path);
    setFileReloadRevision((current) => current + 1);
  }, []);

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

    const setVersionState = (version: DashboardFileVersion): void => {
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
        const content = new TextDecoder("utf-8").decode(result.bytes);
        setFileState({
          status: "ready",
          path,
          content,
          size: result.size,
          modifiedAt: result.modifiedAt,
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
      if (version.status === "ready") {
        void loadFile();
      } else {
        readRevision += 1;
        setVersionState(version);
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
        if (subscription.initial.status === "ready") {
          await loadFile();
        } else {
          setVersionState(subscription.initial);
        }
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
  }, [cwd, fileReloadRevision, hostId, i18n.language, selectedPath, t]);

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
            className={`workspace-file-tree-row${selectedPath === entry.path ? " is-selected" : ""}`}
            style={{ paddingLeft: `${8 + depth * 16}px` }}
            aria-expanded={isDirectory ? isExpanded : undefined}
            onClick={() => (isDirectory ? toggleDirectory(entry.path) : selectFile(entry.path))}
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

  return (
    <div className="workspace-file-explorer">
      <aside className="workspace-file-tree" aria-label={t("workspace.files.treeAria")}>
        <div className="workspace-file-tree-header">
          <FolderOpen size={14} />
          <span title={cwd}>{cwd}</span>
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
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => setFileReloadRevision((current) => current + 1)}
            >
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
              <div className="workspace-file-viewer-meta">
                <span>{formatFileSize(fileState.size)}</span>
                <span>{formatModifiedAt(fileState.modifiedAt, i18n.language)}</span>
              </div>
            </div>
            <div className="workspace-file-viewer-content">
              <CodeBlock code={fileState.content} language={fileState.language} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
