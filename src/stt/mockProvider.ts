import { mockSTT } from "../mockSTT";
import { STTInput, STTProvider } from "./types";

export class MockSTTProvider implements STTProvider {
  readonly name = "mock";

  async transcribe(input: STTInput): Promise<string> {
    return mockSTT(input.text, input.audioPath);
  }
}
