/** Measured (not assumed) performance figures (GDD 6.6, 6.13; AF-009). */
import type * as THREE from 'three';

export interface PerfSnapshot {
  fps: number;
  low1: number;
  frameMs: number;
  worstMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  heapMB: number | null;
  loadMs: number;
  samples: number;
  pixelRatio: number;
  resolution: string;
}

export class PerfMonitor {
  private frames: number[] = [];
  loadMs = 0;
  constructor(private renderer: THREE.WebGLRenderer) {}

  frame(ms: number): void {
    this.frames.push(ms);
    if (this.frames.length > 600) this.frames.shift();
  }

  reset(): void {
    this.frames = [];
  }

  snapshot(): PerfSnapshot {
    const f = this.frames.slice();
    const avg = f.length ? f.reduce((a, b) => a + b, 0) / f.length : 0;
    const sorted = [...f].sort((a, b) => b - a);
    const worst1 = sorted.slice(0, Math.max(1, Math.floor(f.length * 0.01)));
    const low1Ms = worst1.length ? worst1.reduce((a, b) => a + b, 0) / worst1.length : 0;
    const info = this.renderer.info;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const canvas = this.renderer.domElement;
    return {
      fps: avg > 0 ? 1000 / avg : 0,
      low1: low1Ms > 0 ? 1000 / low1Ms : 0,
      frameMs: avg,
      worstMs: sorted[0] ?? 0,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      heapMB: mem ? mem.usedJSHeapSize / 1048576 : null,
      loadMs: this.loadMs,
      samples: f.length,
      pixelRatio: this.renderer.getPixelRatio(),
      resolution: `${canvas.width}×${canvas.height}`,
    };
  }

  /** The GPU as the browser reports it (null if the browser hides it). */
  gpu(): string | null {
    try {
      const gl = this.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    } catch {
      return null;
    }
  }

  /**
   * A plain-text report for M4 evidence (GDD 8.5: performance measured on target machines):
   * build, machine, settings and the last ~10 s of frame timing.
   */
  report(ctx: { build: string; quality: string; area: string; players: number }): string {
    const s = this.snapshot();
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const browser = /Edg\/([\d.]+)/.exec(ua)?.[0] ?? /Chrome\/([\d.]+)/.exec(ua)?.[0] ?? /Firefox\/([\d.]+)/.exec(ua)?.[0] ?? /Version\/([\d.]+).*Safari/.exec(ua)?.[0] ?? 'unknown';
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
    const memGB = typeof navigator !== 'undefined' ? (navigator as unknown as { deviceMemory?: number }).deviceMemory : undefined;
    return [
      'Alloy Frontier performance report',
      `Build: ${ctx.build}`,
      `Taken: ${new Date().toISOString()}`,
      `Browser: ${browser}${/Windows/.test(ua) ? ' · Windows' : /Mac OS/.test(ua) ? ' · macOS' : /Linux/.test(ua) ? ' · Linux' : ''}`,
      `GPU: ${this.gpu() ?? 'not reported'}`,
      `CPU threads: ${cores ?? '?'} · device memory: ${memGB ? memGB + ' GB' : '?'}`,
      `Screen: ${s.resolution} @ pixel ratio ${s.pixelRatio.toFixed(2)} · graphics preset: ${ctx.quality}`,
      `Where: ${ctx.area} · players online: ${ctx.players}`,
      `Frame rate (last ${s.samples} frames): average ${s.fps.toFixed(0)} FPS · 1% low ${s.low1.toFixed(0)} FPS · worst frame ${s.worstMs.toFixed(1)} ms`,
      `Scene: ${s.drawCalls} draw calls · ${(s.triangles / 1000).toFixed(0)}k triangles · ${s.textures} textures`,
      `Memory: ${s.heapMB === null ? 'n/a' : s.heapMB.toFixed(0) + ' MB JS heap'} · load ${(s.loadMs / 1000).toFixed(1)} s`,
    ].join('\n');
  }

  text(): string {
    const s = this.snapshot();
    return [
      `FPS ${s.fps.toFixed(0)}  1% low ${s.low1.toFixed(0)}`,
      `frame ${s.frameMs.toFixed(2)} ms  worst ${s.worstMs.toFixed(1)}`,
      `draws ${s.drawCalls}  tris ${(s.triangles / 1000).toFixed(0)}k`,
      `geo ${s.geometries}  tex ${s.textures}`,
      `heap ${s.heapMB === null ? 'n/a' : s.heapMB.toFixed(0) + ' MB'}`,
      `load ${s.loadMs.toFixed(0)} ms  ${s.resolution} @${s.pixelRatio.toFixed(2)}`,
    ].join('\n');
  }
}
