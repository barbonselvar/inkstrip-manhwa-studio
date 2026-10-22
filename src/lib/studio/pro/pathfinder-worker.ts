/// <reference lib="webworker" />
import { pathfinder } from "./pathfinder";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({ result: pathfinder(data.document, data.ids, data.operation, data.options) });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "Pathfinder failed. Sources retained.",
    });
  }
};
