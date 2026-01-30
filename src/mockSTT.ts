export async function mockSTT(text?: string, _audioPath?: string): Promise<string> {
  if (text && text.trim().length > 0) {
    return text;
  }

  return "(mock stt)";
}
