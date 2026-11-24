# ♞ Chess Arena

A **Chess.com-inspired** web chess game powered by **your own custom JavaScript chess engine**, featuring ELO-calibrated bots (400–2200+), live move-by-move Coach feedback for both your moves and the bot's moves, and a fully customizable sound system with persistent audio uploads.

Zero external runtime dependencies — runs locally with Node or deploys straight to **GitHub Pages**.

---

## ✨ Features

- **Custom From-Scratch Chess Engine (`src/engine/`)**
  - Complete perft-verified rules engine (`src/chess/board.js`) with castling, en passant, promotions, checkmate, stalemate, 50-move rule, threefold repetition, insufficient material, FEN, SAN, and PGN.
  - Negamax + Alpha-Beta + Principal Variation Search (PVS) with Iterative Deepening, Transposition Table (Zobrist hashing), Quiescence Search (MVV-LVA), Null-Move Pruning, Killer Moves, History Heuristic, and Late Move Reductions.
  - Tapered PeSTO-inspired middlegame/endgame evaluation with pawn structure, passed pawns, bishop pair, rook open files, king pawn shield, and endgame mop-up.
  - Runs off the main thread in a Web Worker (`src/engine/worker.js`) so animations stay smooth.
- **ELO-Calibrated Bot Roster (`400` to `2200+ ELO`)**
  - 10 Chess.com-style bot presets (from *Martin 400* up to *Arena Max 2200*) plus a **Custom ELO Slider** (`400–2200` in 50-point steps).
  - Scales search depth, opening book theory, tactical sharpness, and human-like blunder/noise rates realistically by ELO.
- **Live Chess.com-Style Coach & Game Review (`src/engine/coach.js`)**
  - Analyzes **both your moves and the bot's moves** in real time.
  - Classifies every ply: **Book (`📖`)**, **Brilliant (`!!`)**, **Great (`!`)**, **Best (`★`)**, **Excellent (`✓`)**, **Good (`○`)**, **Inaccuracy (`?!`)**, **Mistake (`?`)**, **Miss (`✕`)**, and **Blunder (`??`)**.
  - Floating classification badges right on the board, vertical **Eval Bar**, clickable **Eval Graph**, live **White & Black Accuracy %**, opening ECO detection, and a **"Show Best Move"** arrow toggle.
- **Customizable Sound System (`src/audio/soundManager.js`)**
  - 5 built-in Web Audio API sound packs (*Classic Wood*, *Crisp Marble*, *Retro Arcade*, *Soft Felt*, *Silent*).
  - **Upload your own custom audio files** (`.mp3`, `.wav`, `.ogg`, `.webm`) individually for **Move**, **Capture (Taking)**, **Check**, **Castle**, **Promotion**, **Game Start**, **Game Over**, and **Illegal Move**.
  - Custom sounds persist across page reloads via `IndexedDB`, with per-event volume, master volume, pitch/speed control, and instant **Test** buttons.
- **Chess.com-Style Board UX & Engine Lab**
  - Drag-and-drop or click-to-move, right-click arrows & square highlighting, 5 board color themes, time controls (Unlimited, Blitz, Rapid), hints, takeback, PGN export, FEN import/export, and an **Engine Lab** tab to tune evaluation weights live.

---

## 🚀 Quick Start

Requires **Node.js 18+** (no `npm install` needed!).

```bash
npm run dev
```

Then open **http://127.0.0.1:3000** in your browser.

### Run Tests (Perft + Engine + Coach)

```bash
npm test
```

---

## 📁 Project Structure

```text
chess-arena/
├── index.html                  # Chess.com-style 3-column UI layout
├── styles.css                  # Dark slate theme, board themes, responsive CSS
├── server.js                   # Zero-dependency local HTTP dev server
├── src/
│   ├── main.js                 # UI controller, board interactions, clocks, review
│   ├── chess/
│   │   ├── constants.js        # Piece encodings, flags, compact 32-bit moves
│   │   └── board.js            # Legal move gen, Zobrist hashing, FEN/SAN, perft
│   ├── engine/
│   │   ├── evaluate.js         # Tapered PST + positional evaluation + tunable weights
│   │   ├── search.js           # Iterative deepening alpha-beta/PVS + TT + quiescence
│   │   ├── openingBook.js      # ECO opening recognizer + weighted book moves
│   │   ├── elo.js              # Bot roster & smooth 400-2200 ELO calibration
│   │   ├── coach.js            # Move classification, accuracy %, natural-language feedback
│   │   └── worker.js           # Web Worker host for non-blocking search & analysis
│   ├── audio/
│   │   └── soundManager.js     # Web Audio synth packs + IndexedDB custom audio uploads
│   └── ui/
│       └── pieces.js           # Embedded crisp Staunton SVG pieces
├── tests/
│   ├── chess.test.js           # Perft & rules verification tests
│   └── engine.test.js          # Mate puzzles, ELO calibration, Coach & game sim tests
└── .github/workflows/pages.yml # Auto-deploy to GitHub Pages on push to main
```

---

## 🛠️ Customizing Your Engine

- **Live in the UI**: Open the **Engine Lab** tab to tweak `Bishop Pair`, `Passed Pawns`, `King Safety`, `Rook Open Files`, and `Aggression Bias` in real time.
- **In Code**: Edit piece-square tables or add new positional terms in `src/engine/evaluate.js`, adjust pruning/search depth in `src/engine/search.js`, or expand the opening repertoire in `src/engine/openingBook.js`.

---

## 🌐 Publish to GitHub (and GitHub Pages)

1. Create a new empty repository on GitHub (e.g. `chess-arena`).
2. Link and push your local repo:

```bash
git remote add origin https://github.com/jwu-dev/chess_arena.git
git push -u origin main
```

3. *(Optional)* To play it live on the web for free, go to your GitHub repo **Settings → Pages → Build and deployment → Source: GitHub Actions**. The included `.github/workflows/pages.yml` workflow will deploy it automatically.

---

## 📄 License

MIT
