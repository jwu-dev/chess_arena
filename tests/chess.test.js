import test from 'node:test';
import assert from 'node:assert/strict';
import { ChessBoard } from '../src/chess/board.js';
import { START_FEN } from '../src/chess/constants.js';

test('Perft from starting position (depths 1-4)', () => {
  const board = new ChessBoard(START_FEN);
  assert.equal(board.perft(1), 20);
  assert.equal(board.perft(2), 400);
  assert.equal(board.perft(3), 8902);
  assert.equal(board.perft(4), 197281);
  assert.equal(board.toFEN(), START_FEN);
});

test('Perft on Kiwipete position (castling, promotions, en passant)', () => {
  const kiwipete = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
  const board = new ChessBoard(kiwipete);
  assert.equal(board.perft(1), 48);
  assert.equal(board.perft(2), 2039);
  assert.equal(board.perft(3), 97862);
  assert.equal(board.toFEN(), kiwipete);
});

test('Perft on Position 3 (en passant horizontal pin edge case)', () => {
  const pos3 = '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1';
  const board = new ChessBoard(pos3);
  assert.equal(board.perft(1), 14);
  assert.equal(board.perft(2), 191);
  assert.equal(board.perft(3), 2812);
  assert.equal(board.perft(4), 43238);
});

test('Zobrist hash stays strictly consistent across make/unmake', () => {
  const kiwipete = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
  const board = new ChessBoard(kiwipete);
  const startLo = board.hashLo;
  const startHi = board.hashHi;

  const moves = board.generateLegalMoves();
  for (const m of moves) {
    board.makeMove(m);
    const incLo = board.hashLo;
    const incHi = board.hashHi;
    board.recomputeHash();
    assert.equal(incLo, board.hashLo, 'hashLo mismatch after makeMove');
    assert.equal(incHi, board.hashHi, 'hashHi mismatch after makeMove');
    board.unmakeMove(m);
    assert.equal(board.hashLo, startLo, 'hashLo mismatch after unmakeMove');
    assert.equal(board.hashHi, startHi, 'hashHi mismatch after unmakeMove');
  }
});

test('Game status detection: Fool\'s Mate, Stalemate, Insufficient Material', () => {
  // Fool's mate
  const board = new ChessBoard();
  for (const uci of ['f2f3', 'e7e5', 'g2g4', 'd8h4']) {
    const move = board.uciToMove(uci);
    assert.ok(move, `Expected legal move ${uci}`);
    board.makeMove(move, true);
  }
  const mateStatus = board.getGameStatus();
  assert.equal(mateStatus.over, true);
  assert.equal(mateStatus.reason, 'checkmate');
  assert.equal(mateStatus.result, '0-1');

  // Stalemate
  const stale = new ChessBoard('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  const staleStatus = stale.getGameStatus();
  assert.equal(staleStatus.over, true);
  assert.equal(staleStatus.reason, 'stalemate');
  assert.equal(staleStatus.result, '1/2-1/2');

  // Insufficient material (K+B vs K)
  const insuff = new ChessBoard('7k/8/8/8/8/3B4/8/6K1 w - - 0 1');
  assert.equal(insuff.getGameStatus().reason, 'insufficient-material');
});

test('SAN formatting and parsing', () => {
  const board = new ChessBoard();
  const m1 = board.sanToMove('e4');
  assert.equal(board.moveToSAN(m1), 'e4');
  board.makeMove(m1);

  const m2 = board.sanToMove('e5');
  assert.equal(board.moveToSAN(m2), 'e5');
  board.makeMove(m2);

  const m3 = board.sanToMove('Nf3');
  assert.equal(board.moveToSAN(m3), 'Nf3');
  board.makeMove(m3);
});
