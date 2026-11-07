/** Keep the app unchanged; attach Chromium only after both initial pages loaded. */
export class StartupOutputGate {
  constructor(write) {
    this.write = write;
    this.ready = false;
    this.pending = { stdout: "", stderr: "" };
    this.endpoints = [];
  }

  push(channel, chunk) {
    this.pending[channel] += chunk;
    let end;
    while ((end = this.pending[channel].indexOf("\n")) !== -1) {
      const line = this.pending[channel].slice(0, end + 1);
      this.pending[channel] = this.pending[channel].slice(end + 1);
      this.line(channel, line);
    }
  }

  line(channel, line) {
    if (!this.ready && /^DevTools listening on ws:\/\//.test(line)) {
      this.endpoints.push([channel, line]);
      return;
    }
    this.write(channel, line);
    if (/\bINFO Inkstrip \S+ started \(Electron [^)]+\)/.test(line)) {
      this.ready = true;
      for (const [target, endpoint] of this.endpoints) this.write(target, endpoint);
      this.endpoints = [];
    }
  }

  end() {
    for (const channel of ["stdout", "stderr"]) {
      if (this.pending[channel]) this.line(channel, this.pending[channel]);
      this.pending[channel] = "";
    }
    if (!this.ready && this.endpoints.length)
      this.write("stderr", "[desktop driver] App exited before its startup-ready log; browser attachment was not released.\n");
  }
}
