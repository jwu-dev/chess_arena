import test from 'node:test';
import assert from 'node:assert/strict';
import { ChessBoard } from '../src/chess/board.js';
import { ChessEngine, MATE_THRESHOLD } from '../src/engine/search.js';
import { chooseBotMove, getEloParameters } from '../src/engine/elo.js';
import { analyzePlayedMove } from '../src/engine/coach.js';
import { lookupOpening } from '../src/engine/openingBook.js';
import { moveToUCI } from '../src/chess/constants.js';

test('Engine finds forced Mate in 1', () => {
  // White to move: Qh7# or Qe8# (back rank mate)
  const board = new ChessBoard('6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1');
  const engine = new ChessEngine();
  const res = engine.search(board, { maxDepth: 4, maxTimeMs: 500 });
  assert.equal(moveToUCI(res.bestMove), 'e1e8');
  assert.ok(res.score > MATE_THRESHOLD, `Expected mate score, got ${res.score}`);
});

test('Engine finds forced Mate in 2', () => {
  // White to move: Qd8+ Rxd8 Rxd8#
  const board = new ChessBoard('3r2k1/5ppp/8/8/8/8/3Q1PPP/3R2K1 w - - 0 1');
  const engine = new ChessEngine();
  const res = engine.search(board, { maxDepth: 5, maxTimeMs: 800 });
  assert.equal(moveToUCI(res.bestMove), 'd2d8');
  assert.ok(res.score > MATE_THRESHOLD, `Expected mate score, got ${res.score}`);
});

test('Engine captures undefended queen', () => {
  const board = new ChessBoard('rnb1kbnr/pppp1ppp/8/4q3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 1');
  const engine = new ChessEngine();
  const res = engine.search(board, { maxDepth: 4, maxTimeMs: 500 });
  assert.equal(moveToUCI(res.bestMove), 'f3e5');
});

test('Opening book recognizes Ruy Lopez and provides continuations', () => {
  const res = lookupOpening(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5']);
  assert.equal(res.name, 'Ruy Lopez');
  assert.equal(res.eco, 'C60');
  assert.ok(res.continuations.length > 0);
});

test('ELO calibration scales depth and noise monotonically', () => {
  const low = getEloParameters(400);
  const mid = getEloParameters(1200);
  const high = getEloParameters(2200);

  assert.ok(low.maxDepth < mid.maxDepth && mid.maxDepth < high.maxDepth);
  assert.ok(low.noiseCp > mid.noiseCp && mid.noiseCp > high.noiseCp);
  assert.equal(high.blunderRate, 0);

  const board = new ChessBoard();
  const engine = new ChessEngine();
  const botPick = chooseBotMove(board, [], 1600, engine);
  assert.ok(botPick.move !== 0 && botPick.uci.length >= 4);
});

test('Coach classifies book move, best mate, and blunder accurately', () => {
  const engine = new ChessEngine();

  // 1. Book move: 1. e4
  const start = new ChessBoard();
  const e4 = start.uciToMove('e2e4');
  const bookAnalysis = analyzePlayedMove({
    boardBefore: start,
    move: e4,
    uciHistoryBefore: [],
    moverLabel: 'You',
    isPlayerMove: true,
    engine,
    depth: 4,
    timeMs: 250
  });
  assert.equal(bookAnalysis.classification, 'book');

  // 2. Blunder: hanging Queen for free to Bc8xg4
  const blunderBoard = new ChessBoard('rnbqkbnr/ppp2ppp/3p4/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 0 3');
  const badMove = blunderBoard.uciToMove('d1g4'); // hangs Queen to Bc8xg4
  assert.ok(badMove !== 0, 'Expected d1g4 to be a legal move');
  const blunderAnalysis = analyzePlayedMove({
    boardBefore: blunderBoard,
    move: badMove,
    uciHistoryBefore: ['e2e4', 'e7e5', 'b1c3', 'd7d6'],
    moverLabel: 'You',
    isPlayerMove: true,
    engine,
    depth: 4,
    timeMs: 350
  });
  assert.equal(blunderAnalysis.classification, 'blunder');
  assert.ok(blunderAnalysis.bestMoveSan && blunderAnalysis.bestMoveSan !== 'Qg4');
  assert.ok(blunderAnalysis.body.toLowerCase().includes('queen'));
});

test('Full 10-ply game simulation with live Coach feedback on both sides', () => {
  const board = new ChessBoard();
  const engine = new ChessEngine();
  const uciHistory = [];

  for (let ply = 0; ply < 10; ply++) {
    const elo = ply % 2 === 0 ? 1400 : 1000;
    const pick = chooseBotMove(board, uciHistory, elo, engine);
    assert.ok(pick.move !== 0, `Bot failed to find move at ply ${ply}`);

    const analysis = analyzePlayedMove({
      boardBefore: board,
      move: pick.move,
      uciHistoryBefore: uciHistory,
      moverLabel: ply % 2 === 0 ? 'You' : 'Sven (1000)',
      isPlayerMove: ply % 2 === 0,
      engine,
      depth: 3,
      timeMs: 120
    });

    assert.ok(analysis.classification, 'Missing classification');
    assert.ok(analysis.title.length > 0, 'Missing coach title');
    assert.ok(analysis.body.length > 0, 'Missing coach body');
    assert.ok(analysis.accuracy >= 0 && analysis.accuracy <= 100, 'Accuracy out of bounds');

    board.makeMove(pick.move, true);
    uciHistory.push(pick.uci);
    if (board.getGameStatus().over) break;
  }
});
