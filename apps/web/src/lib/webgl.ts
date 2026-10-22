export function webglAvailable(): string | null {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") ?? c.getContext("webgl");
    return gl ? null : "WebGL is not available in this browser.";
  } catch { return "WebGL is not available in this browser."; }
}
