import { Envelope, Response } from "../types";
import { WeComSender } from "../endpoints/wecom/sender";

export class CallbackDispatcher {
  private readonly wecomSender: WeComSender;

  constructor(wecomSender?: WeComSender) {
    this.wecomSender = wecomSender ?? new WeComSender();
  }

  async send(envelope: Envelope, response: Response): Promise<void> {
    if (!response || (!response.text && !response.data?.image && !response.data?.images?.length)) {
      return;
    }

    if (envelope.source === "wecom" || envelope.source === "scheduler") {
      const meta = (envelope.meta ?? {}) as Record<string, unknown>;
      const callbackUser = typeof meta.callback_to_user === "string" ? meta.callback_to_user : "";
      const toUser = callbackUser || envelope.sessionId;
      if (toUser) {
        await this.wecomSender.sendResponse(toUser, response);
      }
    }
  }
}
