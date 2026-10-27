/// <reference types="vite/client" />

// File System Access API — not yet in lib.dom.d.ts; used for the optional
// local-file open/save flow (Chromium only, feature-detected at call sites).
interface Window {
  showOpenFilePicker?(options?: {
    types?: { description?: string; accept?: Record<string, string[]> }[];
  }): Promise<FileSystemFileHandle[]>;
}

interface FileSystemFileHandle {
  getFile(): Promise<File>;
  createWritable(): Promise<FileSystemWritableFileStream>;
}

interface FileSystemWritableFileStream {
  write(data: string | Blob | ArrayBuffer): Promise<void>;
  close(): Promise<void>;
}
