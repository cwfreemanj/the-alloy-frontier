# Performance evidence: technical director's laptop, 2026-11-25

Three in-game reports (Esc → Copy performance report), taken by the technical director in a
normal Chrome window on the live build `v0.1.0 (a760a69)`. This is one of the target machines
for M4 (GDD v0.4 section 8.5).

**Machine:**
- Intel Arc 140V (integrated, 16 GB shared), Chrome 158 on Windows.
- 8 threads, 32 GB of memory.
- The same model as the development laptop in [2026-11-25-dev-laptop.md](2026-11-25-dev-laptop.md).
  These numbers come from a normal window, not a headless test browser.

| Preset | Screen | Where | Avg FPS | 1% low FPS | Worst frame | Draw calls | Triangles |
| --- | --- | --- | --- | --- | --- | --- | --- |
| high | 2880×1417 @1.5 | Ironwood Trail | 143 | 69 | 15.7 ms | 592 | 1818k |
| medium | 1920×945 @1.0 | Emberhold Village | 264 | 154 | 7.9 ms | 565 | 1411k |
| low | 1440×708 @0.75 | Emberhold Village | 245 | 144 | 7.4 ms | 93 | 667k |

**Result:**
- Every preset clears the GDD 6.6 target of a smooth 60 FPS, with 1% lows of 69–154 FPS and no
  frame over 16 ms.
- That includes high at a 2880×1417 window on the Ironwood Trail, the heaviest area.
- The 50–350 ms stutters in the headless measurements don't appear in real play. They came
  from the test environment, as suspected.

**Load:** 5.9 s to the first frame. On first load, the F3 overlay briefly shows a "worst frame" of a
few seconds and a "1% low" of 0. Those count the loading moment itself; reports taken after a
minute of play don't include it.

## Raw reports

```
Alloy Frontier performance report
Build: v0.1.0 (a760a69, 2026-11-25)
Taken: 2026-11-25T19:10:01.886Z
Browser: Chrome/158.0.0.0 · Windows
GPU: ANGLE (Intel, Intel(R) Arc(TM) 140V GPU (16GB) (0x000064A0) Direct3D11 vs_5_0 ps_5_0, D3D11)
CPU threads: 8 · device memory: 32 GB
Screen: 2880×1417 @ pixel ratio 1.50 · graphics preset: high
Where: Ironwood Trail · players online: 1
Frame rate (last 600 frames): average 143 FPS · 1% low 69 FPS · worst frame 15.7 ms
Scene: 592 draw calls · 1818k triangles · 181 textures
Memory: 66 MB JS heap · load 5.9 s
```

```
Alloy Frontier performance report
Build: v0.1.0 (a760a69, 2026-11-25)
Taken: 2026-11-25T19:14:04.114Z
Browser: Chrome/158.0.0.0 · Windows
GPU: ANGLE (Intel, Intel(R) Arc(TM) 140V GPU (16GB) (0x000064A0) Direct3D11 vs_5_0 ps_5_0, D3D11)
CPU threads: 8 · device memory: 32 GB
Screen: 1440×708 @ pixel ratio 0.75 · graphics preset: low
Where: Emberhold Village · players online: 1
Frame rate (last 600 frames): average 245 FPS · 1% low 144 FPS · worst frame 7.4 ms
Scene: 93 draw calls · 667k triangles · 177 textures
Memory: 60 MB JS heap · load 5.9 s
```

```
Alloy Frontier performance report
Build: v0.1.0 (a760a69, 2026-11-25)
Taken: 2026-11-25T19:18:52.608Z
Browser: Chrome/158.0.0.0 · Windows
GPU: ANGLE (Intel, Intel(R) Arc(TM) 140V GPU (16GB) (0x000064A0) Direct3D11 vs_5_0 ps_5_0, D3D11)
CPU threads: 8 · device memory: 32 GB
Screen: 1920×945 @ pixel ratio 1.00 · graphics preset: medium
Where: Emberhold Village · players online: 1
Frame rate (last 600 frames): average 264 FPS · 1% low 154 FPS · worst frame 7.9 ms
Scene: 565 draw calls · 1411k triangles · 192 textures
Memory: 66 MB JS heap · load 5.9 s
```
