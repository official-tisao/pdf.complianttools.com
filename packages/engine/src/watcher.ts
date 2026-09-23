import { PdfEngineError } from './errors.js';

export type WatcherState = 'running' | 'paused' | 'stopped';
export type FolderWatcherOptions = {
  intervalMs?: number;
  extensions?: readonly string[];
  onFile: (file: File) => Promise<void>;
};

export type PermissionedDirectoryHandle = {
  queryPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
  values: () => AsyncIterable<{
    kind: 'file' | 'directory';
    name: string;
    getFile: () => Promise<File>;
  }>;
};

export class FolderWatcher {
  readonly directory: PermissionedDirectoryHandle;
  readonly options: Required<Pick<FolderWatcherOptions, 'intervalMs' | 'extensions'>> &
    Pick<FolderWatcherOptions, 'onFile'>;
  private stateValue: WatcherState = 'stopped';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private seen = new Set<string>();

  constructor(directory: PermissionedDirectoryHandle, options: FolderWatcherOptions) {
    this.directory = directory;
    this.options = {
      intervalMs: options.intervalMs ?? 1000,
      extensions: options.extensions ?? ['.pdf'],
      onFile: options.onFile,
    };
  }
  get state(): WatcherState {
    return this.stateValue;
  }
  async start(): Promise<void> {
    const permission = await this.directory.queryPermission?.({ mode: 'read' });
    const granted =
      permission === 'granted'
        ? permission
        : await this.directory.requestPermission?.({ mode: 'read' });
    if (granted !== 'granted')
      throw new PdfEngineError({
        kind: 'permission-denied',
        resource: 'folder',
        remedy: 'Grant read permission to the selected folder before starting the watcher.',
      });
    this.stateValue = 'running';
    await this.scan();
  }
  pause(): void {
    if (this.stateValue === 'running') this.stateValue = 'paused';
    if (this.timer) clearTimeout(this.timer);
  }
  resume(): void {
    if (this.stateValue === 'paused') {
      this.stateValue = 'running';
      void this.scan();
    }
  }
  stop(): void {
    this.stateValue = 'stopped';
    if (this.timer) clearTimeout(this.timer);
  }
  private async scan(): Promise<void> {
    if (this.stateValue !== 'running') return;
    for await (const entry of this.directory.values()) {
      if (
        entry.kind !== 'file' ||
        !this.options.extensions.some((extension) => entry.name.toLowerCase().endsWith(extension))
      )
        continue;
      if (this.seen.has(entry.name)) continue;
      this.seen.add(entry.name);
      await this.options.onFile(await entry.getFile());
    }
    if (this.stateValue === 'running')
      this.timer = setTimeout(() => void this.scan(), this.options.intervalMs);
  }
}

export async function pickFolder(): Promise<PermissionedDirectoryHandle> {
  const picker = (
    globalThis as { showDirectoryPicker?: () => Promise<PermissionedDirectoryHandle> }
  ).showDirectoryPicker;
  if (!picker)
    throw new PdfEngineError({
      kind: 'unsupported-feature',
      feature: 'File System Access API',
      remedy:
        'Use a Chromium-based browser with folder access support, or run the batch tool with selected files.',
    });
  return picker();
}
