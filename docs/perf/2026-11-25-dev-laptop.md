# Performance evidence: development laptop, 2026-11-25

GDD v0.4 section 8.5 (M4) asks for performance measured on target machines, with the evidence
captured. This is the first capture, on the development laptop. Captures from the agreed target
machines (each partner's own computer) are still to come; see [../M4.md](../M4.md).

## Machine and build

- **GPU:** Intel Arc 140V (integrated, 16 GB shared), through ANGLE / Direct3D 11.
- **CPU and memory:** 8 threads, 32 GB.
- **Browser:** Chrome 159 on Windows, run headless by Playwright with the GPU enabled.
- **Build:** a local production build of the `m4-closeout` branch, on top of main `6ff3324`,
  played offline (`?world=off`).
- **Resolution:** 1920×1080.

## Method

- Each graphics preset was measured in a fresh page.
- All four areas were visited once first (4 s each) to warm up: shaders compile and textures
  upload the first time something comes into view.
- Then, in each area, the frame-time history was reset and 10 s were recorded, standing still.
- The numbers come from `PerfMonitor.snapshot()`, the same code behind the in-game report
  (Esc → Performance report).

## Results

| Preset | Area | Avg FPS | 1% low FPS | Worst frame (ms) | Draw calls | Triangles | JS heap (MB) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| low | Emberhold Village | 242 | 49 | 30.8 | 132 | 583k | 43 |
| low | Ironwood Trail | 161 | 36 | 31.4 | 436 | 1137k | 43 |
| low | Ironglass Quarry | 205 | 28 | 52.2 | 179 | 711k | 43 |
| low | Dormant Foundry | 222 | 32 | 43.7 | 113 | 653k | 43 |
| medium | Emberhold Village | 101 | 11 | 160.5 | 513 | 1346k | 61 |
| medium | Ironwood Trail | 84 | 14 | 107.4 | 831 | 2013k | 61 |
| medium | Ironglass Quarry | 120 | 19 | 75.9 | 466 | 1451k | 61 |
| medium | Dormant Foundry | 134 | 20 | 63.6 | 263 | 1271k | 61 |
| high | Emberhold Village | 91 | 12 | 167.7 | 513 | 1382k | 51 |
| high | Ironwood Trail | 48 | 12 | 100.1 | 831 | 2049k | 51 |
| high | Ironglass Quarry | 93 | 7 | 351.6 | 466 | 1487k | 51 |
| high | Dormant Foundry | 99 | 15 | 74.9 | 263 | 1307k | 51 |

**Load to first frame:** 3.3–8.7 s. The authored models then stream in over a few seconds,
while the game is already playable.

## What this shows, and what it doesn't

- **Averages:** they clear the GDD's 60 FPS goal (section 6.6) in every area on low and medium,
  and in every area but the trail on high (48 FPS).
- **1% lows: not trustworthy here.**
  - Medium and high show occasional 50–350 ms frames.
  - Repeated runs on this laptop were inconsistent: one run with the authored models turned off
    was perfectly smooth, and another, also with them off, stuttered just as much.
  - The browser recorded **no main-thread long tasks** (over 50 ms) during the stutters.
  - So the stutter comes from the measuring environment (headless browser, integrated GPU, other
    processes running), not from a frame-by-frame cost we can pin on the game.
- **The real 1% lows** have to come from a normal browser window on the target machines, using
  the in-game report.
- **First sight of new models was a real hitch.** The first time a model comes into view, its
  shaders compile and textures upload.
  - Before this change, the first visit to the trail on low averaged 24 FPS.
  - The game now does this work as soon as the models load (`EmberholdWorld.warmUp`).
  - Warmed up, the trail on low averages 161 FPS.
- **Triangle counts:** the authored scenery (PR #26) roughly tripled them, from about 0.5–0.6 M
  to 1.3–2.0 M. If the target machines struggle, the next steps are:
  - lower-detail versions of the trees and cliffs;
  - turning off shadows from distant scenery on medium.

## Sample in-game report

This is what Esc → Performance report → Copy produces:

```
Alloy Frontier performance report
Build: local release build
Taken: 2026-11-25T17:26:01.861Z
Browser: Chrome/159.0.8154.6 · Windows
GPU: ANGLE (Intel, Intel(R) Arc(TM) 140V GPU (16GB) (0x000064A0) Direct3D11 vs_5_0 ps_5_0, D3D11)
CPU threads: 8 · device memory: 32 GB
Screen: 1920×1080 @ pixel ratio 1.00 · graphics preset: medium
Where: Ironwood Trail · players online: 1
Frame rate (last 478 frames): average 84 FPS · 1% low 14 FPS · worst frame 107.4 ms
Scene: 831 draw calls · 2013k triangles · 171 textures
Memory: 61 MB JS heap · load 8.7 s
```
