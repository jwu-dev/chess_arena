import { ChessBoard } from './chess/board.js';
import {
  WHITE, BLACK, EMPTY, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING,
  START_FEN, FILES, RANKS,
  FLAG_CASTLE_K, FLAG_CASTLE_Q, FLAG_PROMOTION,
  moveFrom, moveTo, moveFlags, movePromo, isCapture, moveToUCI, sqToAlgebraic
} from './chess/constants.js';
import { BOT_PROFILES } from './engine/elo.js';
import { DEFAULT_EVAL_WEIGHTS } from './engine/evaluate.js';
import { lookupOpening } from './engine/openingBook.js';
import { cpToWinPercent, formatEval } from './engine/coach.js';
import { SoundManager, SOUND_EVENTS, SOUND_PACKS } from './audio/soundManager.js';
import { getPieceSVG } from './ui/pieces.js';

// ---------- Web Worker RPC Client ----------
class EngineClient {
  constructor() {
    this.worker = new Worker(new URL('./engine/worker.js', import.meta.url), { type: 'module' });
    this.nextId = 1;
    this.pending = new Map();

    this.worker.onmessage = (event) => {
      const { id, ok, result, error } = event.data;
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      if (ok) entry.resolve(result);
      else entry.reject(new Error(error));
    };

    this.worker.onerror = (err) => {
      console.error('Engine Worker Error:', err);
    };
  }

  request(type, payload) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, payload });
    });
  }
}

// ---------- App State ----------
const engineClient = new EngineClient();
const soundManager = new SoundManager();

const state = {
  board: new ChessBoard(START_FEN),
  startFen: START_FEN,
  playerColor: WHITE,
  colorPref: 'white',
  flipped: false,

  selectedBot: BOT_PROFILES.find((b) => b.id === 'nelson') || BOT_PROFILES[4],
  customElo: 1200,
  isCustomElo: false,

  // Move history: each item represents one played ply (1-indexed via viewPly)
  // { move, uci, san, fenBefore, fenAfter, color, isPlayerMove, moverLabel, analysis, evalWhite }
  moves: [],
  viewPly: 0, // 0 = initial position, moves.length = live position
  gameId: 1,
  gameOver: false,
  gameResult: '*',
  gameOverReason: null,

  // Interaction
  selectedSq: -1,
  legalMovesForSelected: [],
  botThinking: false,
  pendingPromo: null, // { from, to, moves }
  showBestArrow: false,
  hintArrow: null, // { from, to }

  // User right-click annotations (cleared on left click / move)
  userArrows: [], // [{ from, to }]
  userHighlights: new Set(),
  rightDragStart: -1,

  // Clocks (seconds)
  timeBaseSec: 0,
  timeIncSec: 0,
  whiteTimeSec: 0,
  blackTimeSec: 0,
  clockInterval: null,

  // Engine weights
  weights: { ...DEFAULT_EVAL_WEIGHTS },
  lastEvalWhite: 0
};

// ---------- DOM References ----------
const $ = (id) => document.getElementById(id);

const els = {
  chessboard: $('chessboard'),
  arrowLayer: $('arrowLayer'),
  evalBar: $('evalBar'),
  evalFillWhite: $('evalFillWhite'),
  evalTextTop: $('evalTextTop'),
  evalTextBottom: $('evalTextBottom'),

  topAvatar: $('topAvatar'),
  topName: $('topName'),
  topElo: $('topElo'),
  topCaptured: $('topCaptured'),
  topMatDiff: $('topMatDiff'),
  topClock: $('topClock'),
  botThinkingBadge: $('botThinkingBadge'),

  bottomAvatar: $('bottomAvatar'),
  bottomName: $('bottomName'),
  bottomElo: $('bottomElo'),
  bottomAccPill: $('bottomAccPill'),
  bottomCaptured: $('bottomCaptured'),
  bottomMatDiff: $('bottomMatDiff'),
  bottomClock: $('bottomClock'),

  promoOverlay: $('promoOverlay'),
  promoModal: $('promoModal'),
  gameOverOverlay: $('gameOverOverlay'),
  gameOverIcon: $('gameOverIcon'),
  gameOverTitle: $('gameOverTitle'),
  gameOverSubtitle: $('gameOverSubtitle'),
  goWhiteAcc: $('goWhiteAcc'),
  goBlackAcc: $('goBlackAcc'),

  coachBadge: $('coachBadge'),
  coachEvalPill: $('coachEvalPill'),
  coachTitle: $('coachTitle'),
  coachBody: $('coachBody'),
  coachActions: $('coachActions'),
  showBestBtn: $('showBestBtn'),
  coachBestLine: $('coachBestLine'),

  openingEco: $('openingEco'),
  openingName: $('openingName'),
  whiteAccDisplay: $('whiteAccDisplay'),
  blackAccDisplay: $('blackAccDisplay'),

  evalGraphSvg: $('evalGraphSvg'),
  evalGraphArea: $('evalGraphArea'),
  evalGraphLine: $('evalGraphLine'),
  evalGraphMarker: $('evalGraphMarker'),

  moveList: $('moveList'),
  moveListEmpty: $('moveListEmpty'),
  moveListWrap: $('moveListWrap'),

  botGrid: $('botGrid'),
  customEloSlider: $('customEloSlider'),
  customEloValue: $('customEloValue'),
  startBotMatchBtn: $('startBotMatchBtn'),
  timeControlSelect: $('timeControlSelect'),

  soundPackSelect: $('soundPackSelect'),
  masterVolumeSlider: $('masterVolumeSlider'),
  masterVolumeLabel: $('masterVolumeLabel'),
  pitchSlider: $('pitchSlider'),
  pitchLabel: $('pitchLabel'),
  soundEventsList: $('soundEventsList'),
  quickMuteBtn: $('quickMuteBtn'),
  quickMuteIcon: $('quickMuteIcon'),

  statDepth: $('statDepth'),
  statNodes: $('statNodes'),
  statNps: $('statNps'),
  statEval: $('statEval'),
  engineLinesList: $('engineLinesList'),
  fenInput: $('fenInput'),
  toast: $('toast')
};

// ---------- Helpers ----------
let toastTimer = null;
function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 2400);
}

function getActiveBotName() {
  if (state.isCustomElo) return `Custom Bot`;
  return state.selectedBot.name;
}

function getActiveBotElo() {
  return state.isCustomElo ? state.customElo : state.selectedBot.elo;
}

function getActiveBotAvatar() {
  return state.isCustomElo ? '🤖' : state.selectedBot.avatar;
}

function getViewedBoard() {
  if (state.viewPly === state.moves.length) {
    return state.board;
  }
  if (state.viewPly === 0) {
    return new ChessBoard(state.startFen);
  }
  return new ChessBoard(state.moves[state.viewPly - 1].fenAfter);
}

function isLiveView() {
  return state.viewPly === state.moves.length;
}

function formatClock(sec) {
  if (state.timeBaseSec <= 0) return '∞';
  const clamped = Math.max(0, Math.ceil(sec));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function computeAccuracies() {
  const whiteScores = [];
  const blackScores = [];
  for (const m of state.moves) {
    if (m.analysis && typeof m.analysis.accuracy === 'number') {
      if (m.color === WHITE) whiteScores.push(m.analysis.accuracy);
      else blackScores.push(m.analysis.accuracy);
    }
  }
  const avg = (arr) =>
    arr.length ? `${(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)}%` : '—';
  return { white: avg(whiteScores), black: avg(blackScores) };
}

function generatePGN() {
  const whiteName = state.playerColor === WHITE ? 'You' : `${getActiveBotName()} (${getActiveBotElo()})`;
  const blackName = state.playerColor === BLACK ? 'You' : `${getActiveBotName()} (${getActiveBotElo()})`;
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
  const headers = [
    `[Event "Chess Arena Match"]`,
    `[Site "Local Engine"]`,
    `[Date "${date}"]`,
    `[White "${whiteName}"]`,
    `[Black "${blackName}"]`,
    `[Result "${state.gameResult}"]`
  ];
  if (state.startFen !== START_FEN) {
    headers.push(`[SetUp "1"]`, `[FEN "${state.startFen}"]`);
  }

  let body = '';
  for (let i = 0; i < state.moves.length; i++) {
    if (i % 2 === 0) {
      body += `${Math.floor(i / 2) + 1}. `;
    }
    body += `${state.moves[i].san} `;
  }
  body += state.gameResult;
  return `${headers.join('\n')}\n\n${body.trim()}`;
}

// ---------- Tabs & Themes ----------
function switchTab(tabId) {
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.panel-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-content').forEach((sec) => {
    sec.classList.toggle('active', sec.id === `tab-${tabId}`);
  });
}

function initNavigationAndThemes() {
  document.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  const savedTheme = localStorage.getItem('chessArena.boardTheme') || 'green';
  document.body.dataset.boardTheme = savedTheme;
  document.querySelectorAll('#themeSwatches .swatch').forEach((sw) => {
    sw.classList.toggle('active', sw.dataset.theme === savedTheme);
    sw.addEventListener('click', () => {
      document.body.dataset.boardTheme = sw.dataset.theme;
      localStorage.setItem('chessArena.boardTheme', sw.dataset.theme);
      document.querySelectorAll('#themeSwatches .swatch').forEach((s) =>
        s.classList.toggle('active', s === sw)
      );
    });
  });
}

// ---------- Board Rendering & Interaction ----------
function sqToVisualCoords(sq) {
  const rank = sq >> 3;
  const file = sq & 7;
  const vr = state.flipped ? 7 - rank : rank;
  const vf = state.flipped ? 7 - file : file;
  return { vr, vf };
}

function renderArrows() {
  const layer = els.arrowLayer;
  layer.innerHTML = '';

  const drawArrow = (fromSq, toSq, color, markerId, width = 15) => {
    const f = sqToVisualCoords(fromSq);
    const t = sqToVisualCoords(toSq);
    const x1 = f.vf * 100 + 50;
    const y1 = f.vr * 100 + 50;
    const x2 = t.vf * 100 + 50;
    const y2 = t.vr * 100 + 50;

    // Shorten tip slightly so arrowhead aligns neatly on center of destination
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 10) return;
    const tx = x2 - (dx / len) * 20;
    const ty = y2 - (dy / len) * 20;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', tx);
    line.setAttribute('y2', ty);
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', String(width));
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('marker-end', `url(#${markerId})`);
    layer.appendChild(line);
  };

  // Coach best move arrow
  if (state.showBestArrow && state.viewPly > 0) {
    const entry = state.moves[state.viewPly - 1];
    const bestUci = entry?.analysis?.bestMoveUci;
    if (bestUci && bestUci.length >= 4) {
      const bBoard = new ChessBoard(entry.fenBefore);
      const bm = bBoard.uciToMove(bestUci);
      if (bm) {
        drawArrow(moveFrom(bm), moveTo(bm), 'rgba(129, 182, 76, 0.88)', 'arrowHeadGreen', 16);
      }
    }
  }

  // Hint arrow
  if (state.hintArrow) {
    drawArrow(state.hintArrow.from, state.hintArrow.to, 'rgba(66, 165, 245, 0.88)', 'arrowHeadBlue', 16);
  }

  // User right-click arrows
  for (const a of state.userArrows) {
    drawArrow(a.from, a.to, 'rgba(255, 170, 0, 0.82)', 'arrowHeadOrange', 15);
  }
}

function renderBoard() {
  const viewedBoard = getViewedBoard();
  const container = els.chessboard;
  container.innerHTML = '';

  const viewedMove = state.viewPly > 0 ? state.moves[state.viewPly - 1] : null;
  const lastFrom = viewedMove ? moveFrom(viewedMove.move) : -1;
  const lastTo = viewedMove ? moveTo(viewedMove.move) : -1;
  const kingInCheckSq = viewedBoard.inCheck(viewedBoard.turn)
    ? viewedBoard.turn === WHITE
      ? viewedBoard.whiteKingSq
      : viewedBoard.blackKingSq
    : -1;

  const legalTargets = new Map();
  for (const m of state.legalMovesForSelected) {
    const to = moveTo(m);
    if (!legalTargets.has(to)) legalTargets.set(to, m);
  }

  for (let vr = 0; vr < 8; vr++) {
    for (let vf = 0; vf < 8; vf++) {
      const rank = state.flipped ? 7 - vr : vr;
      const file = state.flipped ? 7 - vf : vf;
      const sq = (rank << 3) | file;
      const isLight = ((rank + file) & 1) === 0;

      const sqEl = document.createElement('div');
      sqEl.className = `square ${isLight ? 'light' : 'dark'}`;
      sqEl.dataset.sq = String(sq);

      if (sq === lastFrom || sq === lastTo) sqEl.classList.add('last-move');
      if (sq === state.selectedSq) sqEl.classList.add('selected');
      if (sq === kingInCheckSq) sqEl.classList.add('in-check');
      if (state.userHighlights.has(sq)) sqEl.classList.add('right-hl');

      // Coordinates on outer edges (Chess.com style)
      if (vf === 0) {
        const rCoord = document.createElement('span');
        rCoord.className = 'coord coord-rank';
        rCoord.textContent = RANKS[rank];
        sqEl.appendChild(rCoord);
      }
      if (vr === 7) {
        const fCoord = document.createElement('span');
        fCoord.className = 'coord coord-file';
        fCoord.textContent = FILES[file];
        sqEl.appendChild(fCoord);
      }

      // Piece
      const piece = viewedBoard.squares[sq];
      if (piece !== EMPTY) {
        const pieceEl = document.createElement('div');
        pieceEl.className = 'piece-el';
        pieceEl.innerHTML = getPieceSVG(piece);
        sqEl.appendChild(pieceEl);
      }

      // Legal move dot / capture ring
      if (legalTargets.has(sq)) {
        const hintEl = document.createElement('div');
        const m = legalTargets.get(sq);
        hintEl.className = isCapture(m) ? 'legal-ring' : 'legal-dot';
        sqEl.appendChild(hintEl);
      }

      // Classification badge pinned on destination square
      if (viewedMove && sq === lastTo && viewedMove.analysis) {
        const badge = document.createElement('div');
        badge.className = 'move-badge-on-board';
        badge.style.background = viewedMove.analysis.color;
        badge.textContent = viewedMove.analysis.symbol;
        badge.title = `${viewedMove.analysis.label}: ${viewedMove.analysis.title}`;
        sqEl.appendChild(badge);
      }

      container.appendChild(sqEl);
    }
  }

  renderArrows();
  renderPlayerStrips(viewedBoard);
  els.fenInput.value = viewedBoard.toFEN();
}

function renderPlayerStrips(viewedBoard) {
  const mat = viewedBoard.getMaterialBalance();
  const topIsWhite = state.flipped;

  const whiteIsHuman = state.playerColor === WHITE;
  const topIsHuman = topIsWhite ? whiteIsHuman : !whiteIsHuman;

  // Avatars, names, ELO pills
  if (topIsHuman) {
    els.topAvatar.textContent = '♟';
    els.topAvatar.classList.add('user-avatar');
    els.topName.textContent = 'You';
    els.topElo.textContent = topIsWhite ? 'White' : 'Black';
    els.bottomAvatar.textContent = getActiveBotAvatar();
    els.bottomAvatar.classList.remove('user-avatar');
    els.bottomName.textContent = getActiveBotName();
    els.bottomElo.textContent = `${getActiveBotElo()} ELO`;
  } else {
    els.topAvatar.textContent = getActiveBotAvatar();
    els.topAvatar.classList.remove('user-avatar');
    els.topName.textContent = getActiveBotName();
    els.topElo.textContent = `${getActiveBotElo()} ELO`;
    els.bottomAvatar.textContent = '♟';
    els.bottomAvatar.classList.add('user-avatar');
    els.bottomName.textContent = 'You';
    els.bottomElo.textContent = topIsWhite ? 'Black' : 'White';
  }

  // Captured pieces
  const renderCaptured = (el, pieces) => {
    el.innerHTML = pieces
      .map((p) => `<span class="cap-svg">${getPieceSVG(p)}</span>`)
      .join('');
  };

  if (topIsWhite) {
    renderCaptured(els.topCaptured, mat.capturedByWhite);
    renderCaptured(els.bottomCaptured, mat.capturedByBlack);
    els.topMatDiff.textContent = mat.whiteAdvantage > 0 ? `+${mat.whiteAdvantage}` : '';
    els.bottomMatDiff.textContent = mat.whiteAdvantage < 0 ? `+${-mat.whiteAdvantage}` : '';
  } else {
    renderCaptured(els.topCaptured, mat.capturedByBlack);
    renderCaptured(els.bottomCaptured, mat.capturedByWhite);
    els.topMatDiff.textContent = mat.whiteAdvantage < 0 ? `+${-mat.whiteAdvantage}` : '';
    els.bottomMatDiff.textContent = mat.whiteAdvantage > 0 ? `+${mat.whiteAdvantage}` : '';
  }

  // Clocks & Active Turn Highlight
  const topTurn = topIsWhite ? WHITE : BLACK;
  const bottomTurn = -topTurn;
  const topSec = topTurn === WHITE ? state.whiteTimeSec : state.blackTimeSec;
  const bottomSec = bottomTurn === WHITE ? state.whiteTimeSec : state.blackTimeSec;

  els.topClock.textContent = formatClock(topSec);
  els.bottomClock.textContent = formatClock(bottomSec);
  els.topClock.classList.toggle('active-turn', !state.gameOver && state.board.turn === topTurn);
  els.bottomClock.classList.toggle('active-turn', !state.gameOver && state.board.turn === bottomTurn);
  els.topClock.classList.toggle('low-time', state.timeBaseSec > 0 && topSec <= 20);
  els.bottomClock.classList.toggle('low-time', state.timeBaseSec > 0 && bottomSec <= 20);

  // Accuracy display
  const acc = computeAccuracies();
  els.whiteAccDisplay.textContent = acc.white;
  els.blackAccDisplay.textContent = acc.black;
  const userAcc = state.playerColor === WHITE ? acc.white : acc.black;
  if (userAcc !== '—') {
    els.bottomAccPill.textContent = `Acc: ${userAcc}`;
    els.bottomAccPill.classList.remove('hidden');
  } else {
    els.bottomAccPill.classList.add('hidden');
  }
}

function updateEvalBar(whiteCp) {
  state.lastEvalWhite = whiteCp;
  const winPct = cpToWinPercent(whiteCp); // 0..100 for White
  const clampedPct = Math.max(4, Math.min(96, winPct));

  els.evalBar.classList.toggle('flipped', state.flipped);
  els.evalFillWhite.style.height = `${clampedPct}%`;

  const formatted = formatEval(whiteCp);
  const whiteWinning = whiteCp >= 0;

  if (!state.flipped) {
    els.evalTextBottom.textContent = whiteWinning ? formatted : '';
    els.evalTextTop.textContent = !whiteWinning ? formatted : '';
  } else {
    els.evalTextTop.textContent = whiteWinning ? formatted : '';
    els.evalTextBottom.textContent = !whiteWinning ? formatted : '';
  }

  els.statEval.textContent = formatted;
}

function renderEvalGraph() {
  const width = 320;
  const height = 68;
  const pts = [{ ply: 0, pct: 50 }];
  for (let i = 0; i < state.moves.length; i++) {
    const ev = state.moves[i].evalWhite ?? 0;
    pts.push({ ply: i + 1, pct: cpToWinPercent(ev) });
  }

  if (pts.length <= 1) {
    els.evalGraphLine.setAttribute('d', '');
    els.evalGraphArea.setAttribute('d', '');
    els.evalGraphMarker.classList.add('hidden');
    return;
  }

  const maxPly = Math.max(pts.length - 1, 1);
  const coords = pts.map((p) => {
    const x = (p.ply / maxPly) * width;
    const y = height - (p.pct / 100) * height;
    return { x, y };
  });

  const lineD = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ');
  const areaD = `${lineD} L ${coords[coords.length - 1].x.toFixed(1)} ${height} L 0 ${height} Z`;

  els.evalGraphLine.setAttribute('d', lineD);
  els.evalGraphArea.setAttribute('d', areaD);

  const cur = coords[Math.min(state.viewPly, coords.length - 1)];
  els.evalGraphMarker.setAttribute('cx', cur.x.toFixed(1));
  els.evalGraphMarker.setAttribute('cy', cur.y.toFixed(1));
  els.evalGraphMarker.classList.remove('hidden');
}

function renderMoveList() {
  if (state.moves.length === 0) {
    els.moveListEmpty.classList.remove('hidden');
    els.moveList.innerHTML = '';
    return;
  }
  els.moveListEmpty.classList.add('hidden');

  let html = '';
  for (let i = 0; i < state.moves.length; i += 2) {
    const moveNum = Math.floor(i / 2) + 1;
    const w = state.moves[i];
    const b = state.moves[i + 1];

    const renderCell = (entry, ply) => {
      if (!entry) return `<div></div>`;
      const active = state.viewPly === ply ? 'active-ply' : '';
      const badge = entry.analysis
        ? `<span class="move-class-dot" style="color:${entry.analysis.color};background:${entry.analysis.bg}">${entry.analysis.symbol}</span>`
        : '';
      return `<div class="move-cell ${active}" data-ply="${ply}"><span>${entry.san}</span>${badge}</div>`;
    };

    html += `
      <div class="move-row">
        <div class="move-num">${moveNum}.</div>
        ${renderCell(w, i + 1)}
        ${renderCell(b, i + 2)}
      </div>
    `;
  }

  els.moveList.innerHTML = html;
  els.moveList.querySelectorAll('.move-cell').forEach((cell) => {
    cell.addEventListener('click', () => {
      const ply = Number(cell.dataset.ply);
      jumpToPly(ply);
    });
  });

  if (isLiveView()) {
    els.moveListWrap.scrollTop = els.moveListWrap.scrollHeight;
  }
}

function renderCoachPanel() {
  const uciSlice = state.moves.slice(0, state.viewPly).map((m) => m.uci);
  const opening = lookupOpening(uciSlice);
  els.openingEco.textContent = opening.eco || '—';
  els.openingName.textContent = opening.name;

  if (state.viewPly === 0) {
    els.coachBadge.textContent = 'Coach Ready';
    els.coachBadge.style.color = '#81b64c';
    els.coachBadge.style.background = 'rgba(129, 182, 76, 0.18)';
    els.coachEvalPill.textContent = '0.0';
    els.coachTitle.textContent = 'Make your first move!';
    els.coachBody.textContent = `Playing against ${getActiveBotName()} (${getActiveBotElo()} ELO). Every move you or the bot makes will be analyzed live by your custom engine.`;
    els.coachActions.classList.add('hidden');
    updateEvalBar(0);
    return;
  }

  const entry = state.moves[state.viewPly - 1];
  const a = entry.analysis;

  if (!a) {
    els.coachBadge.textContent = 'Analyzing…';
    els.coachBadge.style.color = '#a6a39e';
    els.coachBadge.style.background = 'rgba(255,255,255,0.08)';
    els.coachTitle.textContent = `${entry.moverLabel} played ${entry.san}`;
    els.coachBody.textContent = 'Evaluating move accuracy and calculating best lines…';
    els.coachActions.classList.add('hidden');
    return;
  }

  els.coachBadge.textContent = `${a.symbol} ${a.label} · ${entry.isPlayerMove ? 'Your Move' : entry.moverLabel}`;
  els.coachBadge.style.color = a.color;
  els.coachBadge.style.background = a.bg;
  els.coachEvalPill.textContent = a.evalFormatted;
  els.coachTitle.textContent = a.title;
  els.coachBody.textContent = a.body;

  if (a.bestMoveSan && a.bestMoveUci !== entry.uci) {
    els.coachActions.classList.remove('hidden');
    els.showBestBtn.textContent = state.showBestArrow ? '✕ Hide Best Move' : `↗ Show Best (${a.bestMoveSan})`;
    els.coachBestLine.textContent = a.bestLineSan?.length ? `Line: ${a.bestLineSan.slice(0, 4).join(' ')}` : '';
  } else if (a.bestLineSan?.length > 1) {
    els.coachActions.classList.remove('hidden');
    els.showBestBtn.textContent = state.showBestArrow ? '✕ Hide Arrow' : '↗ Highlight Move';
    els.coachBestLine.textContent = `PV: ${a.bestLineSan.slice(0, 4).join(' ')}`;
  } else {
    els.coachActions.classList.add('hidden');
  }

  updateEvalBar(a.evalAfterWhite);
}

function jumpToPly(ply) {
  const clamped = Math.max(0, Math.min(state.moves.length, ply));
  state.viewPly = clamped;
  state.selectedSq = -1;
  state.legalMovesForSelected = [];
  state.showBestArrow = false;
  state.hintArrow = null;
  state.userArrows = [];
  state.userHighlights.clear();

  renderBoard();
  renderMoveList();
  renderCoachPanel();
  renderEvalGraph();
}

// ---------- Pointer Drag & Click Move Input ----------
let dragState = null;

function canHumanInteract() {
  return (
    !state.gameOver &&
    !state.botThinking &&
    !state.pendingPromo &&
    isLiveView() &&
    state.board.turn === state.playerColor
  );
}

function squareFromPoint(clientX, clientY) {
  const rect = els.chessboard.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
    return -1;
  }
  const vf = Math.floor(((clientX - rect.left) / rect.width) * 8);
  const vr = Math.floor(((clientY - rect.top) / rect.height) * 8);
  if (vf < 0 || vf > 7 || vr < 0 || vr > 7) return -1;
  const rank = state.flipped ? 7 - vr : vr;
  const file = state.flipped ? 7 - vf : vf;
  return (rank << 3) | file;
}

function selectSquare(sq) {
  const piece = state.board.squares[sq];
  if (piece === EMPTY || (piece > 0 ? WHITE : BLACK) !== state.playerColor) {
    state.selectedSq = -1;
    state.legalMovesForSelected = [];
    renderBoard();
    return;
  }
  const allLegal = state.board.generateLegalMoves();
  state.selectedSq = sq;
  state.legalMovesForSelected = allLegal.filter((m) => moveFrom(m) === sq);
  renderBoard();
}

function attemptHumanMove(fromSq, toSq) {
  const matching = state.board
    .generateLegalMoves()
    .filter((m) => moveFrom(m) === fromSq && moveTo(m) === toSq);

  if (matching.length === 0) {
    soundManager.play('illegal');
    return false;
  }

  // Promotion choice modal
  if (matching.length > 1 && (moveFlags(matching[0]) & FLAG_PROMOTION)) {
    showPromotionPicker(fromSq, toSq, matching);
    return true;
  }

  executeMove(matching[0], true);
  return true;
}

function showPromotionPicker(fromSq, toSq, promoMoves) {
  state.pendingPromo = { from: fromSq, to: toSq, moves: promoMoves };
  els.promoModal.innerHTML = '';
  const color = state.board.turn;
  const order = [QUEEN, ROOK, BISHOP, KNIGHT];

  for (const type of order) {
    const move = promoMoves.find((m) => movePromo(m) === type);
    if (!move) continue;
    const btn = document.createElement('button');
    btn.className = 'promo-choice';
    btn.innerHTML = getPieceSVG(color * type);
    btn.addEventListener('click', () => {
      els.promoOverlay.classList.add('hidden');
      state.pendingPromo = null;
      executeMove(move, true);
    });
    els.promoModal.appendChild(btn);
  }
  els.promoOverlay.classList.remove('hidden');
}

function initBoardPointerEvents() {
  els.chessboard.addEventListener('contextmenu', (e) => e.preventDefault());

  els.chessboard.addEventListener('pointerdown', (e) => {
    const sq = squareFromPoint(e.clientX, e.clientY);
    if (sq < 0) return;

    // Right-click annotations (arrows & square highlights)
    if (e.button === 2) {
      state.rightDragStart = sq;
      return;
    }

    if (e.button !== 0) return;

    // Clear right-click annotations on left-click
    if (state.userArrows.length > 0 || state.userHighlights.size > 0) {
      state.userArrows = [];
      state.userHighlights.clear();
      renderBoard();
    }

    if (!canHumanInteract()) {
      if (!isLiveView() && !state.gameOver) {
        showToast('Viewing history — click ⏭ to return to live game');
      }
      return;
    }

    // If clicking a legal target of already-selected piece, move immediately
    if (state.selectedSq >= 0 && state.legalMovesForSelected.some((m) => moveTo(m) === sq)) {
      attemptHumanMove(state.selectedSq, sq);
      return;
    }

    const piece = state.board.squares[sq];
    if (piece !== EMPTY && (piece > 0 ? WHITE : BLACK) === state.playerColor) {
      selectSquare(sq);

      // Start drag
      const sqRect = els.chessboard.getBoundingClientRect();
      const pieceSize = (sqRect.width / 8) * 0.9;
      const ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      ghost.style.width = `${pieceSize}px`;
      ghost.style.height = `${pieceSize}px`;
      ghost.style.left = `${e.clientX}px`;
      ghost.style.top = `${e.clientY}px`;
      ghost.innerHTML = getPieceSVG(piece);
      document.body.appendChild(ghost);

      const sqNode = els.chessboard.querySelector(`.square[data-sq="${sq}"] .piece-el`);
      if (sqNode) sqNode.classList.add('dragging-source');

      dragState = { fromSq: sq, ghost, startX: e.clientX, startY: e.clientY, moved: false };
    } else {
      state.selectedSq = -1;
      state.legalMovesForSelected = [];
      renderBoard();
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (!dragState) return;
    if (Math.hypot(e.clientX - dragState.startX, e.clientY - dragState.startY) > 5) {
      dragState.moved = true;
    }
    dragState.ghost.style.left = `${e.clientX}px`;
    dragState.ghost.style.top = `${e.clientY}px`;
  });

  window.addEventListener('pointerup', (e) => {
    // Handle right-click release (highlight or arrow)
    if (e.button === 2 && state.rightDragStart >= 0) {
      const endSq = squareFromPoint(e.clientX, e.clientY);
      const startSq = state.rightDragStart;
      state.rightDragStart = -1;
      if (endSq >= 0) {
        if (endSq === startSq) {
          if (state.userHighlights.has(endSq)) state.userHighlights.delete(endSq);
          else state.userHighlights.add(endSq);
        } else {
          const idx = state.userArrows.findIndex((a) => a.from === startSq && a.to === endSq);
          if (idx >= 0) state.userArrows.splice(idx, 1);
          else state.userArrows.push({ from: startSq, to: endSq });
        }
        renderBoard();
      }
      return;
    }

    if (!dragState) return;
    const { fromSq, ghost, moved } = dragState;
    ghost.remove();
    dragState = null;

    const sqNode = els.chessboard.querySelector(`.square[data-sq="${fromSq}"] .piece-el`);
    if (sqNode) sqNode.classList.remove('dragging-source');

    if (moved) {
      const dropSq = squareFromPoint(e.clientX, e.clientY);
      if (dropSq >= 0 && dropSq !== fromSq) {
        if (!attemptHumanMove(fromSq, dropSq)) {
          renderBoard();
        }
      }
    }
  });
}

// ---------- Core Move Execution, Coach Analysis & Bot Turn ----------
function playMoveSound(move, boardAfter, status) {
  if (status.over) {
    soundManager.play('gameEnd');
    return;
  }
  const flags = moveFlags(move);
  if (boardAfter.inCheck(boardAfter.turn)) {
    soundManager.play('check');
  } else if (flags & FLAG_PROMOTION) {
    soundManager.play('promote');
  } else if (flags & (FLAG_CASTLE_K | FLAG_CASTLE_Q)) {
    soundManager.play('castle');
  } else if (isCapture(move)) {
    soundManager.play('capture');
  } else {
    soundManager.play('move');
  }
}

async function executeMove(move, isPlayerMove) {
  const currentGameId = state.gameId;
  const fenBefore = state.board.toFEN();
  const uciHistoryBefore = state.moves.map((m) => m.uci);
  const san = state.board.moveToSAN(move);
  const uci = moveToUCI(move);
  const moverColor = state.board.turn;
  const moverLabel = isPlayerMove ? 'You' : `${getActiveBotName()} (${getActiveBotElo()})`;

  // Apply time increment for the side that just moved
  if (state.timeBaseSec > 0 && state.moves.length >= 2) {
    if (moverColor === WHITE) state.whiteTimeSec += state.timeIncSec;
    else state.blackTimeSec += state.timeIncSec;
  }

  state.board.makeMove(move, true);
  const fenAfter = state.board.toFEN();
  const status = state.board.getGameStatus();

  const entry = {
    move,
    uci,
    san,
    fenBefore,
    fenAfter,
    color: moverColor,
    isPlayerMove,
    moverLabel,
    analysis: null,
    evalWhite: state.lastEvalWhite
  };

  state.moves.push(entry);
  state.viewPly = state.moves.length;
  state.selectedSq = -1;
  state.legalMovesForSelected = [];
  state.showBestArrow = false;
  state.hintArrow = null;
  state.userArrows = [];
  state.userHighlights.clear();

  playMoveSound(move, state.board, status);

  if (status.over) {
    finishGame(status.result, status.reason, status.winner);
  }

  renderBoard();
  renderMoveList();
  renderCoachPanel();
  renderEvalGraph();

  // Trigger live Coach Analysis asynchronously in the Web Worker (for BOTH player & bot moves!)
  const plyIndex = state.moves.length - 1;
  engineClient
    .request('ANALYZE_MOVE', {
      fenBefore,
      moveUci: uci,
      uciHistoryBefore,
      moverLabel,
      isPlayerMove,
      depth: 5,
      timeMs: 380
    })
    .then((analysis) => {
      if (state.gameId !== currentGameId) return;
      if (!state.moves[plyIndex] || state.moves[plyIndex].uci !== uci) return;

      state.moves[plyIndex].analysis = analysis;
      state.moves[plyIndex].evalWhite = analysis.evalAfterWhite;

      els.statDepth.textContent = `d${analysis.searchDepth}`;
      els.statNodes.textContent = analysis.searchNodes.toLocaleString();

      renderMoveList();
      renderEvalGraph();
      if (state.viewPly === plyIndex + 1) {
        renderBoard();
        renderCoachPanel();
      }
      if (state.gameOver) {
        updateGameOverAccuracies();
      }
    })
    .catch((err) => console.warn('Analysis skipped:', err));

  // If game continues and it's the bot's turn, request bot move
  if (!status.over && state.board.turn !== state.playerColor) {
    triggerBotTurn(currentGameId);
  }
}

async function triggerBotTurn(expectedGameId) {
  state.botThinking = true;
  els.botThinkingBadge.classList.remove('hidden');

  const startMs = performance.now();
  try {
    const res = await engineClient.request('BOT_MOVE', {
      fen: state.board.toFEN(),
      uciHistory: state.moves.map((m) => m.uci),
      positionHashHistory: state.board.positionHashHistory,
      elo: getActiveBotElo()
    });

    if (state.gameId !== expectedGameId || state.gameOver) return;

    // Brief natural pacing so instant book/depth-1 moves feel readable like Chess.com
    const elapsed = performance.now() - startMs;
    const minDelay = 340;
    if (elapsed < minDelay) {
      await new Promise((r) => setTimeout(r, minDelay - elapsed));
    }
    if (state.gameId !== expectedGameId || state.gameOver) return;

    if (res.nodes > 0) {
      els.statDepth.textContent = `d${res.depth}`;
      els.statNodes.textContent = res.nodes.toLocaleString();
      const nps = Math.round((res.nodes / Math.max(1, res.timeMs)) * 1000);
      els.statNps.textContent = `${(nps / 1000).toFixed(1)}k n/s`;
    }

    const botMove = res.uci ? state.board.uciToMove(res.uci) : 0;
    state.botThinking = false;
    els.botThinkingBadge.classList.add('hidden');

    if (botMove) {
      executeMove(botMove, false);
    }
  } catch (err) {
    console.error('Bot turn error:', err);
    state.botThinking = false;
    els.botThinkingBadge.classList.add('hidden');
  }
}

// ---------- Clocks & Game Lifecycle ----------
function stopClock() {
  if (state.clockInterval) {
    clearInterval(state.clockInterval);
    state.clockInterval = null;
  }
}

function startClockLoop() {
  stopClock();
  if (state.timeBaseSec <= 0) return;

  let lastTick = performance.now();
  state.clockInterval = setInterval(() => {
    if (state.gameOver || state.moves.length === 0) {
      lastTick = performance.now();
      return;
    }
    const now = performance.now();
    const dt = (now - lastTick) / 1000;
    lastTick = now;

    if (state.board.turn === WHITE) {
      state.whiteTimeSec = Math.max(0, state.whiteTimeSec - dt);
      if (state.whiteTimeSec <= 0) {
        soundManager.play('gameEnd');
        finishGame('0-1', 'timeout', BLACK);
      }
    } else {
      state.blackTimeSec = Math.max(0, state.blackTimeSec - dt);
      if (state.blackTimeSec <= 0) {
        soundManager.play('gameEnd');
        finishGame('1-0', 'timeout', WHITE);
      }
    }
    renderPlayerStrips(getViewedBoard());
  }, 150);
}

function updateGameOverAccuracies() {
  const acc = computeAccuracies();
  els.goWhiteAcc.textContent = acc.white;
  els.goBlackAcc.textContent = acc.black;
}

function finishGame(result, reason, winner) {
  state.gameOver = true;
  state.gameResult = result;
  state.gameOverReason = reason;
  state.botThinking = false;
  els.botThinkingBadge.classList.add('hidden');
  stopClock();

  const userWon = winner === state.playerColor;
  const isDraw = winner === 0;

  els.gameOverIcon.textContent = isDraw ? '🤝' : userWon ? '🏆' : '♚';
  if (reason === 'checkmate') {
    els.gameOverTitle.textContent = userWon ? 'You Won!' : 'Checkmate';
    els.gameOverSubtitle.textContent = `${winner === WHITE ? 'White' : 'Black'} wins by checkmate`;
  } else if (reason === 'resignation') {
    els.gameOverTitle.textContent = 'Game Resigned';
    els.gameOverSubtitle.textContent = `${winner === WHITE ? 'White' : 'Black'} wins by resignation`;
  } else if (reason === 'timeout') {
    els.gameOverTitle.textContent = 'Time Out';
    els.gameOverSubtitle.textContent = `${winner === WHITE ? 'White' : 'Black'} wins on time`;
  } else {
    els.gameOverTitle.textContent = 'Draw';
    const labels = {
      stalemate: 'Game drawn by stalemate',
      repetition: 'Game drawn by threefold repetition',
      'fifty-move': 'Game drawn by 50-move rule',
      'insufficient-material': 'Game drawn by insufficient material'
    };
    els.gameOverSubtitle.textContent = labels[reason] || 'Game ended in a draw';
  }

  updateGameOverAccuracies();
  els.gameOverOverlay.classList.remove('hidden');
}

function startNewGame(customFen = START_FEN) {
  state.gameId++;
  state.startFen = customFen;
  state.board = new ChessBoard(customFen);
  state.moves = [];
  state.viewPly = 0;
  state.gameOver = false;
  state.gameResult = '*';
  state.gameOverReason = null;
  state.selectedSq = -1;
  state.legalMovesForSelected = [];
  state.botThinking = false;
  state.pendingPromo = null;
  state.showBestArrow = false;
  state.hintArrow = null;
  state.userArrows = [];
  state.userHighlights.clear();
  state.lastEvalWhite = 0;

  if (state.colorPref === 'random') {
    state.playerColor = Math.random() < 0.5 ? WHITE : BLACK;
  } else {
    state.playerColor = state.colorPref === 'black' ? BLACK : WHITE;
  }
  state.flipped = state.playerColor === BLACK;

  // Time control
  const [baseStr, incStr] = els.timeControlSelect.value.split('|');
  state.timeBaseSec = Number(baseStr) || 0;
  state.timeIncSec = Number(incStr) || 0;
  state.whiteTimeSec = state.timeBaseSec;
  state.blackTimeSec = state.timeBaseSec;
  startClockLoop();

  els.promoOverlay.classList.add('hidden');
  els.gameOverOverlay.classList.add('hidden');
  els.botThinkingBadge.classList.add('hidden');

  soundManager.play('gameStart');
  renderBoard();
  renderMoveList();
  renderCoachPanel();
  renderEvalGraph();

  // If bot moves first (player chose Black)
  if (state.board.turn !== state.playerColor) {
    triggerBotTurn(state.gameId);
  }
}

// ---------- Bots & ELO UI ----------
function renderBotRoster() {
  els.botGrid.innerHTML = '';
  for (const bot of BOT_PROFILES) {
    const card = document.createElement('button');
    card.className = `bot-card ${!state.isCustomElo && state.selectedBot.id === bot.id ? 'selected' : ''}`;
    card.innerHTML = `
      <div class="bot-card-avatar" style="background:${bot.color}33;border:1px solid ${bot.color}88">${bot.avatar}</div>
      <div class="bot-card-info">
        <div class="bot-card-top">
          <span class="bot-card-name">${bot.name}</span>
          <span class="elo-pill" style="background:${bot.color}33;color:#fff">${bot.elo} · ${bot.tier}</span>
        </div>
        <div class="bot-card-bio">${bot.bio}</div>
      </div>
    `;
    card.addEventListener('click', () => {
      state.selectedBot = bot;
      state.isCustomElo = false;
      state.customElo = bot.elo;
      els.customEloSlider.value = String(bot.elo);
      els.customEloValue.textContent = `${bot.elo} ELO`;
      els.startBotMatchBtn.textContent = `Play vs ${bot.name} (${bot.elo} ELO)`;
      renderBotRoster();
    });
    els.botGrid.appendChild(card);
  }
}

function initBotsUI() {
  renderBotRoster();

  els.customEloSlider.addEventListener('input', () => {
    const elo = Number(els.customEloSlider.value);
    state.customElo = elo;
    const exactPreset = BOT_PROFILES.find((b) => b.elo === elo);
    if (exactPreset) {
      state.selectedBot = exactPreset;
      state.isCustomElo = false;
      els.startBotMatchBtn.textContent = `Play vs ${exactPreset.name} (${elo} ELO)`;
    } else {
      state.isCustomElo = true;
      els.startBotMatchBtn.textContent = `Play vs Custom Bot (${elo} ELO)`;
    }
    els.customEloValue.textContent = `${elo} ELO`;
    renderBotRoster();
  });

  document.querySelectorAll('#colorSelector .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.colorPref = btn.dataset.color;
      document.querySelectorAll('#colorSelector .seg-btn').forEach((b) =>
        b.classList.toggle('active', b === btn)
      );
    });
  });

  els.startBotMatchBtn.addEventListener('click', () => {
    switchTab('game');
    startNewGame(START_FEN);
    showToast(`Match started vs ${getActiveBotName()} (${getActiveBotElo()} ELO)`);
  });
}

// ---------- Customizable Sound Manager UI ----------
function renderSoundSlots() {
  els.soundEventsList.innerHTML = '';
  for (const ev of SOUND_EVENTS) {
    const customInfo = soundManager.customMeta[ev.id];
    const evVol = Math.round((soundManager.settings.perEventVolume[ev.id] ?? 1) * 100);

    const slot = document.createElement('div');
    slot.className = 'sound-slot';
    slot.innerHTML = `
      <div class="sound-slot-top">
        <div>
          <div class="sound-slot-title">${ev.label}</div>
          <div class="sound-slot-source ${customInfo ? 'is-custom' : ''}">
            ${customInfo ? `Custom: ${customInfo.name}` : `Built-in (${soundManager.settings.pack})`}
          </div>
        </div>
        <button class="btn btn-secondary btn-sm test-sound-btn" data-ev="${ev.id}">▶ Test</button>
      </div>
      <div class="sound-slot-controls">
        <label class="file-upload-label">
          ⬆ Upload Audio
          <input type="file" accept="audio/*" data-ev="${ev.id}" />
        </label>
        ${customInfo ? `<button class="btn btn-danger btn-sm clear-sound-btn" data-ev="${ev.id}">✕ Reset</button>` : ''}
        <input type="range" class="ev-vol-slider" data-ev="${ev.id}" min="0" max="100" value="${evVol}" title="Volume for ${ev.label}" style="flex:1;min-width:75px" />
      </div>
    `;

    slot.querySelector('.test-sound-btn').addEventListener('click', () => {
      soundManager.play(ev.id);
    });

    slot.querySelector('input[type="file"]').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        await soundManager.uploadCustomSound(ev.id, file);
        renderSoundSlots();
        soundManager.play(ev.id);
        showToast(`Custom "${ev.label}" sound saved!`);
      } catch (err) {
        showToast(`Could not decode audio file: ${err.message}`);
      }
    });

    const clearBtn = slot.querySelector('.clear-sound-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        await soundManager.clearCustomSound(ev.id);
        renderSoundSlots();
        showToast(`Reset "${ev.label}" to built-in sound`);
      });
    }

    slot.querySelector('.ev-vol-slider').addEventListener('input', (e) => {
      soundManager.setEventVolume(ev.id, Number(e.target.value) / 100);
    });

    els.soundEventsList.appendChild(slot);
  }
}

async function initSoundUI() {
  await soundManager.readyPromise;

  // Populate pack dropdown
  els.soundPackSelect.innerHTML = SOUND_PACKS.map(
    (p) => `<option value="${p.id}" ${p.id === soundManager.settings.pack ? 'selected' : ''}>${p.label}</option>`
  ).join('');

  els.masterVolumeSlider.value = String(Math.round(soundManager.settings.masterVolume * 100));
  els.masterVolumeLabel.textContent = `${Math.round(soundManager.settings.masterVolume * 100)}%`;
  els.pitchSlider.value = String(Math.round(soundManager.settings.pitch * 100));
  els.pitchLabel.textContent = `${soundManager.settings.pitch.toFixed(2)}×`;
  els.quickMuteIcon.textContent = soundManager.settings.muted ? '🔇' : '🔊';

  els.soundPackSelect.addEventListener('change', () => {
    soundManager.setPack(els.soundPackSelect.value);
    renderSoundSlots();
    soundManager.play('move');
  });

  els.masterVolumeSlider.addEventListener('input', () => {
    const val = Number(els.masterVolumeSlider.value);
    els.masterVolumeLabel.textContent = `${val}%`;
    soundManager.setMasterVolume(val / 100);
  });

  els.pitchSlider.addEventListener('input', () => {
    const val = Number(els.pitchSlider.value) / 100;
    els.pitchLabel.textContent = `${val.toFixed(2)}×`;
    soundManager.setPitch(val);
  });

  $('resetAllSoundsBtn').addEventListener('click', async () => {
    await soundManager.resetAllCustomSounds();
    renderSoundSlots();
    showToast('All custom sounds cleared');
  });

  els.quickMuteBtn.addEventListener('click', () => {
    const nextMuted = !soundManager.settings.muted;
    soundManager.setMuted(nextMuted);
    els.quickMuteIcon.textContent = nextMuted ? '🔇' : '🔊';
    showToast(nextMuted ? 'Audio muted' : 'Audio unmuted');
  });

  renderSoundSlots();
}

// ---------- Engine Lab & Game Controls ----------
async function analyzeCurrentPosition(showHintArrow = false) {
  const viewed = getViewedBoard();
  els.engineLinesList.textContent = 'Searching position…';
  try {
    const res = await engineClient.request('HINT', {
      fen: viewed.toFEN(),
      depth: 5,
      timeMs: 650
    });

    els.statDepth.textContent = `d${res.depth}`;
    els.statNodes.textContent = res.nodes.toLocaleString();
    const nps = Math.round((res.nodes / Math.max(1, res.timeMs)) * 1000);
    els.statNps.textContent = `${(nps / 1000).toFixed(1)}k n/s`;
    updateEvalBar(res.evalWhite);

    if (res.topMoves?.length) {
      els.engineLinesList.innerHTML = res.topMoves
        .map(
          (m, idx) => `
            <div class="pv-line-item">
              <span>#${idx + 1} <strong>${m.san}</strong> (${m.uci})</span>
              <span style="color:#81b64c;font-weight:700">${m.evalFormatted}</span>
            </div>
          `
        )
        .join('');
    }

    if (showHintArrow && res.bestMoveUci) {
      const m = viewed.uciToMove(res.bestMoveUci);
      if (m) {
        state.hintArrow = { from: moveFrom(m), to: moveTo(m) };
        renderArrows();
        showToast(`Engine Hint: ${res.bestMoveSan} (${res.evalFormatted})`);
      }
    }
  } catch (err) {
    els.engineLinesList.textContent = `Error: ${err.message}`;
  }
}

function syncEngineWeights() {
  engineClient.request('SET_WEIGHTS', { weights: state.weights }).catch(() => {});
}

function initEngineLabAndControls() {
  // Coach "Show Best Move" button
  els.showBestBtn.addEventListener('click', () => {
    state.showBestArrow = !state.showBestArrow;
    renderCoachPanel();
    renderArrows();
  });

  // Eval graph click-to-jump
  els.evalGraphSvg.addEventListener('click', (e) => {
    if (state.moves.length === 0) return;
    const rect = els.evalGraphSvg.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetPly = Math.round(ratio * state.moves.length);
    jumpToPly(targetPly);
  });

  // Playback buttons
  $('navStartBtn').addEventListener('click', () => jumpToPly(0));
  $('navPrevBtn').addEventListener('click', () => jumpToPly(state.viewPly - 1));
  $('navNextBtn').addEventListener('click', () => jumpToPly(state.viewPly + 1));
  $('navEndBtn').addEventListener('click', () => jumpToPly(state.moves.length));
  $('flipBoardBtn').addEventListener('click', () => {
    state.flipped = !state.flipped;
    renderBoard();
    updateEvalBar(state.lastEvalWhite);
  });

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'ArrowLeft') jumpToPly(state.viewPly - 1);
    else if (e.key === 'ArrowRight') jumpToPly(state.viewPly + 1);
    else if (e.key === 'Home') jumpToPly(0);
    else if (e.key === 'End') jumpToPly(state.moves.length);
    else if (e.key.toLowerCase() === 'f') {
      state.flipped = !state.flipped;
      renderBoard();
      updateEvalBar(state.lastEvalWhite);
    }
  });

  // Game action buttons
  $('newGameQuickBtn').addEventListener('click', () => startNewGame(START_FEN));
  $('goRematchBtn').addEventListener('click', () => startNewGame(START_FEN));
  $('goReviewBtn').addEventListener('click', () => {
    els.gameOverOverlay.classList.add('hidden');
    jumpToPly(state.moves.length);
  });

  $('hintBtn').addEventListener('click', () => {
    if (state.gameOver) return;
    analyzeCurrentPosition(true);
  });

  $('takebackBtn').addEventListener('click', () => {
    if (state.botThinking || state.moves.length === 0) return;
    // Undo back to player's turn (usually 2 plies, or 1 if bot hasn't moved yet)
    let pliesToUndo = 1;
    if (state.moves.length >= 2 && state.board.turn === state.playerColor) {
      pliesToUndo = 2;
    }
    state.gameId++; // cancel in-flight analyses
    for (let i = 0; i < pliesToUndo && state.moves.length > 0; i++) {
      const removed = state.moves.pop();
      state.board.unmakeMove(removed.move);
    }
    state.gameOver = false;
    state.gameResult = '*';
    els.gameOverOverlay.classList.add('hidden');
    jumpToPly(state.moves.length);
    showToast('Move taken back');
  });

  $('copyPgnBtn').addEventListener('click', async () => {
    const pgn = generatePGN();
    try {
      await navigator.clipboard.writeText(pgn);
      showToast('PGN copied to clipboard!');
    } catch {
      showToast('Copy failed — clipboard permission required');
    }
  });

  $('resignBtn').addEventListener('click', () => {
    if (state.gameOver) return;
    soundManager.play('gameEnd');
    const winner = -state.playerColor;
    finishGame(winner === WHITE ? '1-0' : '0-1', 'resignation', winner);
  });

  // Engine Lab controls
  $('analyzeNowBtn').addEventListener('click', () => analyzeCurrentPosition(true));

  const bindWeightSlider = (id, valId, key, formatFn, transformFn = (v) => v) => {
    const slider = $(id);
    const valEl = $(valId);
    slider.addEventListener('input', () => {
      const raw = Number(slider.value);
      const val = transformFn(raw);
      state.weights[key] = val;
      valEl.textContent = formatFn(val);
      syncEngineWeights();
    });
  };

  bindWeightSlider('wBishopPair', 'wBishopPairVal', 'bishopPair', (v) => `+${v} cp`);
  bindWeightSlider('wPassedPawn', 'wPassedPawnVal', 'passedPawnScale', (v) => `${v.toFixed(1)}×`, (r) => r / 100);
  bindWeightSlider('wKingSafety', 'wKingSafetyVal', 'kingSafetyScale', (v) => `${v.toFixed(1)}×`, (r) => r / 100);
  bindWeightSlider('wRookFile', 'wRookFileVal', 'rookFileBonus', (v) => `+${v} cp`);
  bindWeightSlider('wAggression', 'wAggressionVal', 'aggression', (v) => (v > 0 ? `+${v}` : `${v}`));

  $('resetWeightsBtn').addEventListener('click', () => {
    state.weights = { ...DEFAULT_EVAL_WEIGHTS };
    $('wBishopPair').value = String(DEFAULT_EVAL_WEIGHTS.bishopPair);
    $('wBishopPairVal').textContent = `+${DEFAULT_EVAL_WEIGHTS.bishopPair} cp`;
    $('wPassedPawn').value = '100';
    $('wPassedPawnVal').textContent = '1.0×';
    $('wKingSafety').value = '100';
    $('wKingSafetyVal').textContent = '1.0×';
    $('wRookFile').value = String(DEFAULT_EVAL_WEIGHTS.rookFileBonus);
    $('wRookFileVal').textContent = `+${DEFAULT_EVAL_WEIGHTS.rookFileBonus} cp`;
    $('wAggression').value = '0';
    $('wAggressionVal').textContent = '0';
    syncEngineWeights();
    showToast('Engine weights reset to defaults');
  });

  $('loadFenBtn').addEventListener('click', () => {
    const fen = els.fenInput.value.trim();
    if (!fen) return;
    try {
      const testBoard = new ChessBoard(fen);
      if (testBoard.generateLegalMoves().length === 0 && !testBoard.inCheck(testBoard.turn)) {
        // Stalemate FEN is still valid, allow loading
      }
      startNewGame(fen);
      switchTab('game');
      showToast('Custom FEN loaded!');
    } catch {
      showToast('Invalid FEN string');
    }
  });

  $('copyFenBtn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(els.fenInput.value);
      showToast('FEN copied to clipboard!');
    } catch {
      showToast('Could not copy FEN');
    }
  });
}

// ---------- Bootstrap ----------
async function init() {
  initNavigationAndThemes();
  initBoardPointerEvents();
  initBotsUI();
  await initSoundUI();
  initEngineLabAndControls();

  renderBoard();
  renderMoveList();
  renderCoachPanel();
  renderEvalGraph();
}

init();
