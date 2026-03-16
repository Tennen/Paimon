import assert from "node:assert/strict";
import test from "node:test";
import { Response } from "../../types";
import { WeComSender } from "./sender";

class RecordingSender extends WeComSender {
  public readonly callOrder: string[] = [];
  public textCalls = 0;
  public imageCalls = 0;

  async sendImage(): Promise<void> {
    this.callOrder.push("image");
    this.imageCalls += 1;
    throw new Error("image upload failed");
  }

  async sendText(): Promise<void> {
    this.callOrder.push("text");
    this.textCalls += 1;
  }
}

test("sendResponse should not send text first when image sending fails", async () => {
  const sender = new RecordingSender();
  const response: Response = {
    text: "fallback text should not be sent first",
    data: {
      image: {
        data: "base64-payload",
        contentType: "image/png",
        filename: "report.png"
      }
    }
  };

  await assert.rejects(() => sender.sendResponse("user-a", response), /image upload failed/);
  assert.deepEqual(sender.callOrder, ["image"]);
  assert.equal(sender.imageCalls, 1);
  assert.equal(sender.textCalls, 0);
});
