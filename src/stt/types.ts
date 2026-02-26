export type STTInput = {
  text?: string;
  audioPath?: string;
  meta?: Record<string, unknown>;
};

export interface STTProvider {
  readonly name: string;
  ensureReady?(): Promise<void>;
  transcribe(input: STTInput): Promise<string>;
}
