/** Local inference is supplied by ExecuTorch on both supported platforms. */
export type SpeechPermission = 'granted' | 'denied' | 'restricted';
export type SpeechInputAvailability = 'available' | 'unavailable';
export type LanguageModelAvailability =
  | 'available'
  | 'modelsMissing'
  | 'unavailable';

export interface SpeechOutput {
  /** Resolves after playback ends or is stopped. Ranges refer to the original UTF-16 text. */
  speak(
    text: string,
    locale: string,
    onWord: (location: number, length: number) => void,
  ): Promise<void>;
  prepare(): Promise<void>;
  stop(): void;
}
export interface SpeechInput {
  requestPermission(): Promise<SpeechPermission>;
  /** Loads installed files only; never starts a network request. */
  prepare(locale: string): Promise<SpeechInputAvailability>;
  listen(
    locale: string,
    onPartial: (text: string) => void,
    onTurn: (text: string) => void,
    onLevel: (level: number) => void,
    onVoice: (speaking: boolean) => void,
    onStopped: (reason: string) => void,
  ): Promise<void>;
  /** Discards buffered speech and suppresses callbacks from the cancelled stream. */
  cancel(): void;
}
export interface LanguageModel {
  availability(): LanguageModelAvailability;
  prewarm(instructions: string): void;
  /** Each answer starts a fresh grounded session; cancelled or incomplete output rejects. */
  respond(
    instructions: string,
    prompt: string,
    onPartial: (text: string) => void,
  ): Promise<string>;
  cancel(): void;
}
export interface OfflineModelStatus {
  readonly state: 'checking' | 'missing' | 'downloading' | 'ready' | 'error';
  readonly progress: number;
  readonly bytes: number;
  readonly error: string | null;
}
export interface OfflineModels {
  getSnapshot(): OfflineModelStatus;
  subscribe(listener: () => void): () => void;
  /** Verifies installed files without networking. */
  restore(): Promise<void>;
  /** Explicit user action: downloads pinned files, verifies them, then marks ready. */
  prepare(): Promise<void>;
  cancel(): void;
  release(): void;
}
