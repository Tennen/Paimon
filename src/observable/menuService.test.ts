import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import test from "node:test";
import { WeComMenuPublishPayload } from "../integrations/wecom/menuClient";
import { ObservableMenuService } from "./menuService";

test("ObservableMenuService saves config, builds publish payload, and dispatches click events", async () => {
  const previousCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paimon-observable-menu-"));
  let publishedPayload: WeComMenuPublishPayload | null = null;

  process.chdir(tempDir);
  try {
    const service = new ObservableMenuService({
      createMenu: async (payload) => {
        publishedPayload = payload;
      }
    });

    const saved = service.saveConfig({
      buttons: [
        {
          id: "root-shortcuts",
          name: "快捷操作",
          enabled: true,
          subButtons: [
            {
              id: "sub-ha-on",
              name: "客厅开灯",
              key: "ha-living-room-on",
              enabled: true,
              dispatchText: "打开客厅主灯"
            }
          ]
        }
      ]
    });

    assert.deepEqual(saved.publishPayload, {
      button: [
        {
          name: "快捷操作",
          sub_button: [
            {
              type: "click",
              name: "客厅开灯",
              key: "ha-living-room-on"
            }
          ]
        }
      ]
    });

    const handled = service.handleWeComClickEvent({
      eventKey: "ha-living-room-on",
      fromUser: "zhangsan",
      toUser: "wwcorp"
    });
    assert.equal(handled.dispatchText, "打开客厅主灯");
    assert.equal(handled.event.status, "dispatched");

    const snapshotAfterEvent = service.getSnapshot();
    assert.equal(snapshotAfterEvent.recentEvents[0]?.eventKey, "ha-living-room-on");
    assert.equal(snapshotAfterEvent.recentEvents[0]?.matchedButtonName, "客厅开灯");

    const published = await service.publishConfig();
    assert.deepEqual(publishedPayload, saved.publishPayload);
    assert.equal(Boolean(published.config.lastPublishedAt), true);
  } finally {
    process.chdir(previousCwd);
  }
});
