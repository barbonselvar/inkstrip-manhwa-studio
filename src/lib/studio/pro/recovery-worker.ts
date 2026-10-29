import { createCheckpoint, storeCheckpoint } from "./recovery";
import type { ProSession } from "./model";
self.onmessage = async ({ data }: { data: ProSession }) => {
  try {
    const header = await storeCheckpoint(await createCheckpoint(data));
    self.postMessage({ header });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "Recovery checkpoint could not be stored.",
      name: error instanceof Error ? error.name : "Error",
    });
  }
};
