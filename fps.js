export class FPSCounter {
  constructor() {
    this.domElement = document.createElement("div");
    this.domElement.style.cssText = "position:fixed;top:10px;left:10px;color:#0f0;font-family:monospace";
    this.lastTime = performance.now();
    this.frames = 0;
  }
  update() {
    this.frames++;
    const now = performance.now();
    if (now - this.lastTime >= 1000) {
      this.domElement.textContent = `FPS: ${this.frames}`;
      this.frames = 0;
      this.lastTime = now;
    }
  }
}
