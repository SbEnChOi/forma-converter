export type Category = 'image' | 'document' | 'spreadsheet' | 'presentation' | 'pdf';
export type JobStatus = 'pending' | 'processing' | 'cancelling' | 'completed' | 'failed' | 'cancelled';
export type PageSize = 'original' | 'a3' | 'a4' | 'a5' | 'b4' | 'b5' | 'letter' | 'legal';

export interface ConversionOptions {
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  background?: string;
  pages?: string;
  pageSize?: PageSize;
}

export interface Settings {
  destination: string | null;
  quality: number;
  maxWidth: number | null;
  maxHeight: number | null;
  background: string;
  theme: 'system' | 'light' | 'dark';
  combineImages: boolean;
  pageSize: PageSize;
}

export interface Job {
  id: string;
  source: string;
  name: string;
  extension: string;
  category: Category;
  size: number;
  format: string;
  outputs: string[];
  options: ConversionOptions;
  status: JobStatus;
  error?: string;
  warnings: string[];
  createdAt: string;
  completedAt?: string;
  phase?: string;
  thumbnail?: string;
  sourceCount?: number;
  availableFormats: string[];
}

export interface AppState {
  jobs: Job[];
  history: Job[];
  settings: Settings;
  running: boolean;
  total: number;
  finished: number;
}

export interface Capabilities {
  word: boolean;
  excel: boolean;
  powerpoint: boolean;
  version: string;
}

export interface FormaBridge {
  getState(): Promise<AppState>;
  chooseFiles(preferredFormat?: string): Promise<void>;
  addPaths(paths: string[], preferredFormat?: string): Promise<void>;
  chooseFolder(): Promise<void>;
  updateJob(update: { id: string; format?: string; options?: ConversionOptions }): Promise<void>;
  removeJob(id: string): Promise<void>;
  start(ids?: string[]): Promise<void>;
  cancel(id?: string): Promise<void>;
  clearCompleted(): Promise<void>;
  retryFailed(): Promise<void>;
  openOutput(id: string): Promise<void>;
  showInFolder(id: string): Promise<void>;
  getSettings(): Promise<Settings>;
  saveSettings(settings: Partial<Settings>): Promise<void>;
  clearHistory(): Promise<void>;
  getCapabilities(): Promise<Capabilities>;
  subscribe(listener: (state: AppState) => void): () => void;
  minimize(): void;
  maximize(): void;
  close(): void;
  droppedPaths(files: File[]): string[];
}

declare global {
  interface Window {
    forma: FormaBridge;
  }
}
