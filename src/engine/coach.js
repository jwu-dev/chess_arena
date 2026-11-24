import {
  WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING,
  PIECE_NAMES, PIECE_VALUES,
  FLAG_CASTLE_K, FLAG_CASTLE_Q, FLAG_PROMOTION,
  moveFrom, moveTo, moveFlags, movePromo, moveCapturedType, isCapture,
  sqToAlgebraic, moveToUCI
} from '../chess/constants.js';
import { MATE_SCORE, MATE_THRESHOLD } from './search.js';
import { isOpeningBookMove, lookupOpening } from './openingBook.js';

export const CLASSIFICATIONS = {
  book: { label: 'Book', symbol: '📖', color: '#a88865', bg: 'rgba(168, 136, 101, 0.18)' },
  brilliant: { label: 'Brilliant', symbol: '!!', color: '#1baca6', bg: 'rgba(27, 172, 166, 0.2)' },
  great: { label: 'Great', symbol: '!', color: '#5c8bb0', bg: 'rgba(92, 139, 176, 0.2)' },
  best: { label: 'Best', symbol: '★', color: '#81b64c', bg: 'rgba(129, 182, 76, 0.2)' },
  excellent: { label: 'Excellent', symbol: '✓', color: '#96bc4b', bg: 'rgba(150, 188, 75, 0.16)' },
  good: { label: 'Good', symbol: '○', color: '#96af8b', bg: 'rgba(150, 175, 139, 0.15)' },
  inaccuracy: { label: 'Inaccuracy', symbol: '?!', color: '#f7c631', bg: 'rgba(247, 198, 49, 0.18)' },
  mistake: { label: 'Mistake', symbol: '?', color: '#e58f2a', bg: 'rgba(229, 143, 42, 0.2)' },
  miss: { label: 'Miss', symbol: '✕', color: '#ff7769', bg: 'rgba(255, 119, 105, 0.2)' },
  blunder: { label: 'Blunder', symbol: '??', color: '#ca3431', bg: 'rgba(202, 52, 49, 0.24)' }
};

/**
 * Convert centipawns (mover perspective) to Chess.com-style expected win percentage [0..100].
 */
export function cpToWinPercent(cp) {
  if (cp > MATE_THRESHOLD) return 100;
  if (cp < -MATE_THRESHOLD) return 0;
  const clamped = Math.max(-1800, Math.min(1800, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamped)) - 1);
}

/**
 * Convert win-percent drop into per-move CAPS-like accuracy [0..100].
 */
export function winDropToAccuracy(winDrop) {
  if (winDrop <= 0.3) return 100;
  const acc = 103.1668 * Math.exp(-0.04354 * winDrop) - 3.1669;
  return Math.max(0, Math.min(100, Math.round(acc * 10) / 10));
}

/**
 * Format centipawn / mate score from White's perspective.
 */
export function formatEval(whiteCp) {
  if (whiteCp > MATE_THRESHOLD) {
    const plies = Math.max(1, MATE_SCORE - whiteCp);
    const moves = Math.ceil(plies / 2);
    return `+M${moves}`;
  }
  if (whiteCp < -MATE_THRESHOLD) {
    const plies = Math.max(1, MATE_SCORE + whiteCp);
    const moves = Math.ceil(plies / 2);
    return `-M${moves}`;
  }
  const pawns = whiteCp / 100;
  const sign = pawns > 0.05 ? '+' : '';
  return `${sign}${pawns.toFixed(1)}`;
}

function pvToSAN(board, pvMoves, limit = 5) {
  const copy = board.clone();
  const sans = [];
  for (let i = 0; i < Math.min(pvMoves.length, limit); i++) {
    const m = pvMoves[i];
    const legal = copy.generateLegalMoves();
    if (!legal.includes(m)) break;
    sans.push(copy.moveToSAN(m, legal));
    copy.makeMove(m);
  }
  return sans;
}

/**
 * Detect if the moved piece landed on a square where it can be won cleanly (hanging/en prise).
 */
function detectHangingPiece(boardAfter, movedToSq, moverColor) {
  const piece = boardAfter.squares[movedToSq];
  if (!piece || Math.abs(piece) === KING || Math.abs(piece) === PAWN) return null;
  const attackers = boardAfter.getAttackers(movedToSq, -moverColor);
  if (attackers.length === 0) return null;
  const defenders = boardAfter.getAttackers(movedToSq, moverColor);

  const pieceVal = PIECE_VALUES[Math.abs(piece)];
  const minAttackerVal = Math.min(...attackers.map((a) => PIECE_VALUES[Math.abs(a.piece)]));

  if (defenders.length === 0 || minAttackerVal < pieceVal) {
    return {
      pieceName: PIECE_NAMES[Math.abs(piece)],
      square: sqToAlgebraic(movedToSq),
      undefended: defenders.length === 0
    };
  }
  return null;
}

/**
 * Detect if the move forks two or more valuable enemy pieces.
 */
function detectFork(boardAfter, movedToSq, moverColor) {
  const piece = boardAfter.squares[movedToSq];
  if (!piece) return [];
  const enemy = -moverColor;
  const attackedTargets = [];

  for (let sq = 0; sq < 64; sq++) {
    const p = boardAfter.squares[sq];
    if (p === 0 || (p > 0 ? WHITE : BLACK) !== enemy) continue;
    const type = Math.abs(p);
    if (type < KNIGHT) continue;
    const attackers = boardAfter.getAttackers(sq, moverColor);
    if (attackers.some((a) => a.sq === movedToSq)) {
      attackedTargets.push({ type, name: PIECE_NAMES[type], sq: sqToAlgebraic(sq) });
    }
  }

  return attackedTargets.length >= 2 ? attackedTargets : [];
}

/**
 * Analyze a played move and generate Chess.com-style classification + coach explanation.
 * Works identically for BOTH the player's moves and the bot's moves!
 */
export function analyzePlayedMove({
  boardBefore,
  move,
  uciHistoryBefore,
  moverLabel, // 'You' or bot name like 'Sven (1000)'
  isPlayerMove,
  engine,
  depth = 5,
  timeMs = 450
}) {
  const moverColor = boardBefore.turn;
  const moveUci = moveToUCI(move);
  const moveSan = boardBefore.moveToSAN(move);
  const flags = moveFlags(move);
  const toSq = moveTo(move);

  // 1. Evaluate position BEFORE the move (top 2+ lines to detect Great/Only moves)
  const beforeSearch = engine.search(boardBefore, {
    maxDepth: depth,
    maxTimeMs: timeMs,
    multiPV: 3
  });

  const bestMoveBefore = beforeSearch.bestMove || move;
  const bestMoveUci = moveToUCI(bestMoveBefore);
  const bestMoveSan = boardBefore.moveToSAN(bestMoveBefore);
  const bestLineSan = pvToSAN(boardBefore, beforeSearch.pv, 5);
  const bestScoreMover = beforeSearch.score;
  const secondBestScoreMover =
    beforeSearch.candidates.length > 1 ? beforeSearch.candidates[1].score : bestScoreMover - 200;

  // 2. Evaluate position AFTER the played move
  const boardAfter = boardBefore.clone();
  boardAfter.makeMove(move, true);
  const statusAfter = boardAfter.getGameStatus();

  let playedScoreMover;
  let afterPvSan = [];
  let afterBestUci = null;

  if (statusAfter.over) {
    if (statusAfter.reason === 'checkmate') {
      playedScoreMover = MATE_SCORE - 1;
    } else {
      playedScoreMover = 0;
    }
  } else if (move === bestMoveBefore) {
    playedScoreMover = bestScoreMover;
    afterPvSan = bestLineSan.slice(1);
    afterBestUci = beforeSearch.pv[1] ? moveToUCI(beforeSearch.pv[1]) : null;
  } else {
    const afterSearch = engine.search(boardAfter, {
      maxDepth: Math.max(3, depth - 1),
      maxTimeMs: Math.round(timeMs * 0.75),
      multiPV: 1
    });
    playedScoreMover = -afterSearch.score;
    afterPvSan = pvToSAN(boardAfter, afterSearch.pv, 4);
    afterBestUci = afterSearch.bestMove ? moveToUCI(afterSearch.bestMove) : null;
  }

  // Convert scores to White's perspective for Eval Bar & Graph
  const evalBeforeWhite = moverColor === WHITE ? bestScoreMover : -bestScoreMover;
  const evalAfterWhite = moverColor === WHITE ? playedScoreMover : -playedScoreMover;

  // Expected win probability before vs after (from mover's perspective)
  const winBefore = cpToWinPercent(bestScoreMover);
  const winAfter = cpToWinPercent(playedScoreMover);
  const winDrop = Math.max(0, winBefore - winAfter);
  const cpLoss = Math.max(0, bestScoreMover - playedScoreMover);
  const accuracy = winDropToAccuracy(winDrop);

  // Check opening book
  const inBook = uciHistoryBefore.length < 14 && isOpeningBookMove(uciHistoryBefore, moveUci);
  const openingAfter = lookupOpening([...uciHistoryBefore, moveUci]);

  // Tactical inspections
  const hanging = detectHangingPiece(boardAfter, toSq, moverColor);
  const forkTargets = detectFork(boardAfter, toSq, moverColor);
  const gaveCheck = boardAfter.inCheck(boardAfter.turn);
  const isMate = statusAfter.over && statusAfter.reason === 'checkmate';
  const missedMate = bestScoreMover > MATE_THRESHOLD && playedScoreMover < MATE_THRESHOLD;
  const blunderedIntoMate = bestScoreMover > -MATE_THRESHOLD && playedScoreMover < -MATE_THRESHOLD;
  const isOnlyMove = bestScoreMover - secondBestScoreMover >= 140 && bestScoreMover >= -60;

  // Material sacrifice check for Brilliant (!!)
  const isMaterialSacrifice =
    move === bestMoveBefore &&
    hanging !== null &&
    playedScoreMover >= 150 &&
    !inBook &&
    uciHistoryBefore.length >= 6;

  // 3. Classify the move
  let classification = 'good';
  if (inBook) {
    classification = 'book';
  } else if (isMate) {
    classification = 'best';
  } else if (isMaterialSacrifice) {
    classification = 'brilliant';
  } else if (move === bestMoveBefore && isOnlyMove && bestScoreMover > -100) {
    classification = 'great';
  } else if (move === bestMoveBefore || winDrop <= 0.8) {
    classification = 'best';
  } else if (winDrop <= 2.5) {
    classification = 'excellent';
  } else if (winDrop <= 5.5) {
    classification = 'good';
  } else if (missedMate || (winBefore >= 72 && winAfter <= 56 && winDrop >= 12)) {
    classification = 'miss';
  } else if (winDrop <= 11.5 && !blunderedIntoMate) {
    classification = 'inaccuracy';
  } else if (winDrop <= 21 && !blunderedIntoMate) {
    classification = 'mistake';
  } else {
    classification = 'blunder';
  }

  // 4. Craft natural-language coach commentary tailored to mover (You vs Bot)
  const subject = isPlayerMove ? 'You' : moverLabel;
  const possessive = isPlayerMove ? 'your' : `${moverLabel}'s`;
  const verbPlayed = isPlayerMove ? 'played' : 'played';
  const meta = CLASSIFICATIONS[classification];

  let title = `${moveSan} is ${classification === 'inaccuracy' ? 'an' : 'a'} ${meta.label.toLowerCase()} move`;
  let body = '';

  if (isMate) {
    title = `Checkmate with ${moveSan}!`;
    body = isPlayerMove
      ? `Clinical finish! You delivered checkmate and won the game.`
      : `${moverLabel} found checkmate with ${moveSan}.`;
  } else if (classification === 'book') {
    title = `${moveSan} is a book move`;
    body = `Standard theory in the ${openingAfter.name}${openingAfter.eco ? ` (${openingAfter.eco})` : ''}. Solid development and center control.`;
  } else if (classification === 'brilliant') {
    title = `${moveSan} is Brilliant!`;
    body = `${subject} found a stunning sacrifice! Leaving the ${hanging.pieceName} on ${hanging.square} en prise leads to a decisive advantage (${formatEval(evalAfterWhite)}).`;
  } else if (classification === 'great') {
    title = `${moveSan} is a Great move!`;
    body = `${subject} found the only move in a sharp position! Other moves would have dropped the evaluation significantly.`;
  } else if (classification === 'best') {
    title = `${moveSan} is the Best move`;
    if (forkTargets.length >= 2) {
      body = `Sharp tactic! ${moveSan} simultaneously attacks the ${forkTargets[0].name} on ${forkTargets[0].sq} and ${forkTargets[1].name} on ${forkTargets[1].sq}.`;
    } else if (flags & (FLAG_CASTLE_K | FLAG_CASTLE_Q)) {
      body = `Smart king safety! Castling tucks the king away and activates the rook.`;
    } else if (flags & FLAG_PROMOTION) {
      body = `Powerful promotion! Converting the pawn decisively boosts ${possessive} position.`;
    } else if (gaveCheck) {
      body = `Strong forcing check! ${subject} kept the initiative with the engine's #1 choice.`;
    } else if (isCapture(move)) {
      const capName = PIECE_NAMES[moveCapturedType(move)] || 'piece';
      body = `Accurate capture of the ${capName}, keeping the strongest continuation (${formatEval(evalAfterWhite)}).`;
    } else {
      body = `${subject} matched the engine's top recommendation (${formatEval(evalAfterWhite)}).`;
    }
  } else if (classification === 'excellent') {
    title = `${moveSan} is Excellent`;
    body = `Very close to the top engine move ${bestMoveSan}. ${subject} kept almost the entire evaluation (${formatEval(evalAfterWhite)}).`;
  } else if (classification === 'good') {
    title = `${moveSan} is a Good move`;
    body = `Playable and solid, though ${bestMoveSan} was slightly stronger according to the engine.`;
  } else if (classification === 'inaccuracy') {
    title = `${moveSan} is an Inaccuracy`;
    body = `${subject} lost a small edge here. ${bestMoveSan} was more accurate${bestLineSan.length > 1 ? ` (line: ${bestLineSan.slice(0, 3).join(' ')})` : ''}.`;
  } else if (classification === 'miss') {
    title = missedMate ? `${subject} missed Checkmate!` : `${moveSan} is a Missed Win`;
    if (missedMate) {
      body = `${subject} had a forced checkmate with ${bestMoveSan}! Click "Show Best" to see the winning tactic.`;
    } else {
      body = `${subject} missed a big opportunity! ${bestMoveSan} would have seized a commanding advantage.`;
    }
  } else if (classification === 'mistake') {
    title = `${moveSan} is a Mistake`;
    if (hanging) {
      body = `${subject} put the ${hanging.pieceName} in danger on ${hanging.square}. ${bestMoveSan} was much better.`;
    } else {
      body = `This gives the opponent counterplay (eval shifted to ${formatEval(evalAfterWhite)}). Better was ${bestMoveSan}.`;
    }
  } else {
    // Blunder
    title = `${moveSan} is a Blunder!`;
    if (blunderedIntoMate) {
      body = `Ouch! ${moveSan} allows a forced checkmate. ${bestMoveSan} was needed to stay in the game.`;
    } else if (hanging) {
      body = `${subject} ${verbPlayed} ${moveSan}, ${hanging.undefended ? 'leaving' : 'putting'} the ${hanging.pieceName} on ${hanging.square} hanging! ${isPlayerMove ? `Better was ${bestMoveSan}.` : `Look closely — you can punish this!`}`;
    } else if (afterPvSan.length > 0 && !isPlayerMove) {
      body = `${moverLabel} blundered! You can capitalize now — look for ${afterPvSan[0]}!`;
    } else {
      body = `Major evaluation drop to ${formatEval(evalAfterWhite)}. The engine strongly preferred ${bestMoveSan}.`;
    }
  }

  return {
    moveUci,
    moveSan,
    classification,
    symbol: meta.symbol,
    label: meta.label,
    color: meta.color,
    bg: meta.bg,
    evalBeforeWhite,
    evalAfterWhite,
    evalFormatted: formatEval(evalAfterWhite),
    winDrop: Math.round(winDrop * 10) / 10,
    cpLoss,
    accuracy,
    bestMoveUci,
    bestMoveSan,
    bestLineSan,
    refutationUci: afterBestUci,
    refutationSan: afterPvSan[0] || null,
    opening: openingAfter,
    title,
    body,
    isPlayerMove,
    moverLabel,
    searchDepth: beforeSearch.depth,
    searchNodes: beforeSearch.nodes
  };
}
