# MathViz

> MathViz — teach the model to draw math, then render it live: plots, 3D solids, and graphs, right inside the chat.

[中文说明](README.md) · English

**MathViz does two things:**

1. **Teaches large language models to draw mathematical figures.** When models hand-write SVG for functions, solids, or graphs, errors cluster into a few patterns — forgetting to flip the y-axis, hand-computing sample points, hard-coding 3D projections, edges cutting through nodes. MathViz hands the model an "drawing protocol + runtime": the model only writes math expressions (`x => x*x - 2`, `edges:[["A","B",4]]`), while sampling, projection, layout, breakpoints, and hidden-edge detection are all computed by code. **This is not just a tool for the model — it's an iterable training methodology**: every drawing mistake the model makes becomes either a new fault-tolerance layer in the runtime or a new case in the test suite. The "legend passed as a string array" and "tapping a freed node" bugs fixed yesterday are tomorrow's explicit prohibitions in the protocol.
2. **Gives the DeepSeek web client a drawing capability.** The DeepSeek web app has no Artifacts, no code sandbox, and no graphical output beyond formulas. MathViz ships as an MV3 browser extension plus an Android WebView shell: it injects the drawing protocol into the input box on demand (**once per conversation is enough**), then renders the ` ```mathviz ` code blocks in the model's reply **in place, as figures** — calling no private APIs and never touching login state. 2D curves, drag-to-rotate 3D solids, and click-to-highlight graphs grow directly inside the chat bubbles.

**In one line: the model writes only math, the runtime computes the coordinates, and the extension puts the figure back into the chat.**

---

## What it solves

When models hand-write SVG for math figures, errors concentrate in five categories:

| Mistake | Consequence |
|---|---|
| Forgetting to flip the y-axis | Function plots come out upside down |
| Hand-computing sample points | Uneven curvature, abrupt endpoints, a fake vertical line at asymptotes |
| Hard-coding 3D coordinates with "isometric projection" | Move one vertex and the whole figure misaligns; hidden edges drawn as solid |
| Graph edges connecting node centers | Edges cut through nodes; topology becomes unreadable |
| Estimating CJK width with Latin metrics | Labels overlap lines or get clipped |

MathViz's answer is to hand coordinate computation to code — and **keep verifying in a real browser**: typical model outputs are captured into reproduction scripts (e.g. the 10 legend-writing variants in `test/q10-repro.mjs`); when one crashes, the runtime gains a fault-tolerance layer, and nothing ships until the full regression is green.

## Three pipelines

Not every figure is worth a runtime. Picking the wrong pipeline is the most common waste of time.

| Situation | Pipeline | Cost |
|---|---|---|
| ≤ 8 primitives, simple coordinates, no interaction | hand-written SVG | zero dependency |
| Functions / parametric / polar / needs axes ticks | `mk-core.js` | sampling & breakpoints computed by code |
| Solid geometry | `mk-3d.js` | orthographic projection + automatic hidden-edge detection |
| Graphs / Hasse diagrams / automata | `mk-graph.js` | layout + edge avoidance |
| Venn diagrams / adjacency matrices | built into `mk-graph.js` | mathematically exact region positions |

## Two distributions, one runtime

| | `app/` (application) | `skill/` (skill pack) |
|---|---|---|
| Host | MV3 browser extension (DeepSeek web) + Android WebView shell | WorkBuddy skill pack (in-conversation figures) |
| Protocol delivery | panel inserts into the input box, once per conversation | SKILL.md enters the system context directly |
| Rendering | the extension renders ` ```mathviz ` blocks in place | runtime inlined, shown via `show_widget` / HTML |
| Interaction | 3D drag-rotate, double-click reset, face/node tap highlight + info bar | same (shared runtime) |

`app/assets/` and `skill/assets/` hold the same runtime snapshot; `sync-runtime.mjs` verifies sha256 hashes to prevent drift.

## Layout

```
MathViz/
├── app/                       [application] browser extension + Android shell
│   ├── src/                   extension source (prompt.js holds the drawing-protocol prompt)
│   ├── assets/                runtime snapshot (same as skill/assets; after edits run node ../sync-runtime.mjs copy)
│   ├── android/               mobile: WebView shell + real-device CDP verification scripts
│   ├── test/                  61 unit / 15 interaction / 19 capability test cases
│   ├── testset.md             test-set doc; testset-paste.md is the paste-ready version
│   └── dist/                  build output (extension/ + extension.zip)
├── skill/                     installable skill pack (in-conversation figures; runtime shared with app)
│   ├── SKILL.md               trigger rules / pipeline choice / workflow
│   ├── references/            seven topic-specific drawing references
│   │   ├── mathkit-api.md     full runtime API
│   │   ├── plot-2d.md         functions, parametric, polar, derivatives, integrals
│   │   ├── geometry.md        plane geometry, triangles, circles, conics
│   │   ├── solid-3d.md        projection, polyhedra, cross-sections, dihedral angles, views
│   │   ├── discrete.md        graphs, Hasse diagrams, Venn, matrices, automata, logic gates
│   │   ├── linear-algebra.md  vectors, projection, span, transforms, eigenvectors
│   │   └── checklist.md       ten-point self-check + symptom table + symbol reference
│   ├── assets/                the three runtimes (readable source, ~1600 lines)
│   │   ├── mk-core.js
│   │   ├── mk-3d.js
│   │   └── mk-graph.js
│   └── scripts/
│       ├── verify.mjs         headless-browser getBBox checks: overflow & font size
│       └── build-standalone.mjs  inline external scripts into a single file
├── examples/                  six double-clickable examples
│   ├── 01-function-tangent.html
│   ├── 02-vector-projection.html
│   ├── 03-triangle-incenter.html
│   ├── 04-cube-hexagon.html
│   ├── 05-graph-shortest-path.html
│   ├── 06-dfa.html
│   └── dist/                  inlined standalone versions
└── docs/design.md             design decisions and trade-offs
```

## Install

**DeepSeek web extension** (details in [`app/README.md`](app/README.md)):

1. Open `edge://extensions/` (`chrome://extensions/` in Chrome) → enable "Developer mode"
2. "Load unpacked" → select `app/dist/extension/`
3. Open <https://chat.deepseek.com> — the `∑ MathViz` button at the bottom left means success

**Android**: build `app/android/` to get the APK. The shell bundles the same runtime — the fallback for phones where extensions can't be installed.

**WorkBuddy skill**:

```bash
cp -r skill ~/.workbuddy/skills/math-visualizer
```

The directory name must match `name: math-visualizer` in `SKILL.md`, or the skill won't load.

## Usage (extension)

1. Click `∑ MathViz` at the bottom left (or press **`Alt + M`**)
2. Pick a **drawing mode** (see table below)
3. Click "Insert prompt" — the protocol is inserted into the input box as plain text (**visible and editable**), with your question kept at the end
4. Send normally. **One injection per conversation is enough**; afterwards just ask "now draw an ellipse with eccentricity 0.8"
5. For a new conversation, click "**New chat**" on the panel and inject once more

| Mode | Effect |
|---|---|
| General · auto pipeline | the model picks hand-written SVG / 2D / 3D / graph itself |
| Functions & 2D | forces `MK.frame` — curves, parametric, vectors |
| Solids & 3D | forces `MK.space` — polyhedra, cross-sections, spatial vectors |
| Graphs & discrete | forces `MK.graph` / `MK.venn` / `MK.matrix` |
| Pure SVG · simple | zero runtime; only for ≤ 8-primitive sketches |
| Off | no injection; existing code blocks still render |

Figures render **inside the model's own code block**: the original code collapses (click "source" to bring it back), leaving source / copy / re-render / collapse buttons at the top right.

**3D & graph interaction**: canvases ship with drag-to-rotate and double-click reset; `S.face(pt,{info:'...'})`, `S.solid(v,f,{faceInfo:[...]})`, and graph-node `info` fields — tapping highlights the face/node and shows its description in an info bar.

**Skill-pack usage**: just say "draw the tangent of y = x³ − 3x at x = 1.5" — the skill picks the pipeline, inlines the runtime, and renders. Say "export as HTML" for a standalone file.

## Testing

```bash
cd app
npm test                        # 61 unit tests
node test/interact.test.mjs     # 15 interaction tests (real Chromium, synthetic pointer events)
node test/verify-testset.mjs    # 19 capability test cases
```

A real-device verification chain also exists: `app/android/{verify,interact-check,diagnose,grab-q28}.mjs` connect over CDP to the on-device WebView, covering injection, rendering, and interaction.

## What has been verified

The three runtimes were not "written and shipped" — every capability was rendered in a headless browser and checked by eye:

- 2D: no fake vertical line at `tan` asymptotes; parabola proportions correct; ticks never overlap axis labels; text has halo strokes for readability.
- 3D: a cube shows exactly 3 hidden edges, a pyramid 5 — matching normal-vector derivation; the regular-hexagon cross-section is clearly visible at `yaw 26 / pitch 36`.
- Graphs: arrow directions, edge avoidance (highlighted paths detour around intermediate nodes), Hasse-diagram barycenter ordering reduces crossings, and all seven Venn-region labels verified in their correct regions.
- All examples pass `verify.mjs`.

## Known limitations

- **Canvas width is fixed at 680**. A hard constraint of the host environment; making it adaptive would break every coordinate assumption.
- **The inlined runtime costs tokens**. `mk-core.js` is ~500 lines; complex figures add the 3D / graph modules. Simple figures should use the hand-written SVG pipeline. This is a deliberate trade: spend ~10k tokens once instead of redrawing dozens of coordinate mistakes.
- **3D is orthographic only** — no perspective. Fine for teaching figures; not for realistic rendering.
- **`force` layout is nondeterministic** and gets messy with many nodes. Use `circle` or manual coordinates for stable output.
- **Conics support parametric drawing only** — no implicit-equation solving. Convert `x²+y²=1` to `t => [cos t, sin t]` yourself.
- **CJK width is estimated as 1em**; narrow Latin mixes may still be off by 1–2px, caught by `verify.mjs` as a backstop.
- Fonts rely on system `--font-sans` / `--font-serif`; math italics use serif and may fall back to a default serif in some environments.

## License

[MIT](LICENSE)
