import { ChessBoard } from '../chess/board.js';
import { ChessEngine } from './search.js';
import { chooseBotMove } from './elo.js';
import { analyzePlayedMove, formatEval } from './coach.js';
import { moveToUCI } from '../chess/constants.js';

const engine = new ChessEngine();

self.onmessage = (event) => {
  const { id, type, payload } = event.data;

  try {
    if (type === 'SET_WEIGHTS') {
      engine.setWeights(payload.weights);
      self.postMessage({ id, ok: true, result: { weights: engine.weights } });
      return;
    }

    if (type === 'BOT_MOVE') {
      const board = new ChessBoard(payload.fen);
      if (payload.positionHashHistory) {
        board.positionHashHistory = payload.positionHashHistory.slice();
      }
      const chosen = chooseBotMove(board, payload.uciHistory || [], payload.elo, engine);
      self.postMessage({
        id,
        ok: true,
        result: {
          uci: chosen.uci,
          fromBook: chosen.fromBook,
          depth: chosen.searchInfo?.depth || 0,
          nodes: chosen.searchInfo?.nodes || 0,
          timeMs: chosen.searchInfo?.timeMs || 0
        }
      });
      return;
    }

    if (type === 'ANALYZE_MOVE') {
      const boardBefore = new ChessBoard(payload.fenBefore);
      const move = boardBefore.uciToMove(payload.moveUci);
      if (!move) {
        self.postMessage({ id, ok: false, error: `Invalid move ${payload.moveUci}` });
        return;
      }
      const analysis = analyzePlayedMove({
        boardBefore,
        move,
        uciHistoryBefore: payload.uciHistoryBefore || [],
        moverLabel: payload.moverLabel,
        isPlayerMove: payload.isPlayerMove,
        engine,
        depth: payload.depth || 5,
        timeMs: payload.timeMs || 420
      });
      self.postMessage({ id, ok: true, result: analysis });
      return;
    }

    if (type === 'HINT') {
      const board = new ChessBoard(payload.fen);
      const res = engine.search(board, {
        maxDepth: payload.depth || 5,
        maxTimeMs: payload.timeMs || 550,
        multiPV: 3
      });
      const whiteScore = board.turn === 1 ? res.score : -res.score;
      const topMoves = res.candidates.slice(0, 3).map((c) => {
        const whiteCp = board.turn === 1 ? c.score : -c.score;
        return {
          uci: c.uci,
          san: board.moveToSAN(c.move),
          evalWhite: whiteCp,
          evalFormatted: formatEval(whiteCp)
        };
      });

      self.postMessage({
        id,
        ok: true,
        result: {
          bestMoveUci: res.bestMove ? moveToUCI(res.bestMove) : null,
          bestMoveSan: res.bestMove ? board.moveToSAN(res.bestMove) : null,
          evalWhite: whiteScore,
          evalFormatted: formatEval(whiteScore),
          depth: res.depth,
          nodes: res.nodes,
          timeMs: res.timeMs,
          topMoves
        }
      });
      return;
    }

    self.postMessage({ id, ok: false, error: `Unknown message type: ${type}` });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.message || String(err) });
  }
};
