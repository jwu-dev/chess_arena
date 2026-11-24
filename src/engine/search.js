import {
  WHITE, BLACK, EMPTY, PAWN, KING,
  PIECE_VALUES, moveFrom, moveTo, movePromo, moveCapturedType, isCapture, moveToUCI
} from '../chess/constants.js';
import { evaluate, DEFAULT_EVAL_WEIGHTS } from './evaluate.js';

export const INF = 100000;
export const MATE_SCORE = 50000;
export const MATE_THRESHOLD = 49000;

const TT_EXACT = 0;
const TT_LOWER = 1;
const TT_UPPER = 2;

// 131072 (2^17) transposition table entries (~2.5 MB flat arrays, zero GC)
const TT_SIZE = 1 << 17;
const TT_MASK = TT_SIZE - 1;

export class ChessEngine {
  constructor(weights = DEFAULT_EVAL_WEIGHTS) {
    this.weights = { ...DEFAULT_EVAL_WEIGHTS, ...weights };
    this.ttKeyLo = new Uint32Array(TT_SIZE);
    this.ttKeyHi = new Uint32Array(TT_SIZE);
    this.ttScore = new Int32Array(TT_SIZE);
    this.ttMove = new Int32Array(TT_SIZE);
    this.ttDepth = new Int8Array(TT_SIZE);
    this.ttFlag = new Uint8Array(TT_SIZE);
    this.ttGen = new Uint8Array(TT_SIZE);

    this.generation = 1;
    this.killers = new Int32Array(128 * 2);
    this.history = new Int32Array(2 * 64 * 64);

    this.nodes = 0;
    this.stopTime = 0;
    this.aborted = false;
  }

  setWeights(weights) {
    this.weights = { ...DEFAULT_EVAL_WEIGHTS, ...weights };
    this.clearTT();
  }

  clearTT() {
    this.ttGen.fill(0);
    this.killers.fill(0);
    this.history.fill(0);
  }

  probeTT(board, depth, alpha, beta, ply) {
    const idx = board.hashLo & TT_MASK;
    if (
      this.ttGen[idx] !== 0 &&
      this.ttKeyLo[idx] === board.hashLo &&
      this.ttKeyHi[idx] === board.hashHi
    ) {
      const move = this.ttMove[idx];
      if (this.ttDepth[idx] >= depth) {
        let score = this.ttScore[idx];
        if (score > MATE_THRESHOLD) score -= ply;
        else if (score < -MATE_THRESHOLD) score += ply;

        const flag = this.ttFlag[idx];
        if (flag === TT_EXACT) return { hit: true, score, move };
        if (flag === TT_LOWER && score >= beta) return { hit: true, score, move };
        if (flag === TT_UPPER && score <= alpha) return { hit: true, score, move };
      }
      return { hit: false, score: 0, move };
    }
    return { hit: false, score: 0, move: 0 };
  }

  storeTT(board, depth, score, flag, move, ply) {
    const idx = board.hashLo & TT_MASK;
    // Always replace if deeper or newer generation
    if (
      this.ttGen[idx] === this.generation &&
      this.ttKeyLo[idx] === board.hashLo &&
      this.ttKeyHi[idx] === board.hashHi &&
      this.ttDepth[idx] > depth &&
      flag !== TT_EXACT
    ) {
      return;
    }

    let storedScore = score;
    if (storedScore > MATE_THRESHOLD) storedScore += ply;
    else if (storedScore < -MATE_THRESHOLD) storedScore -= ply;

    this.ttKeyLo[idx] = board.hashLo;
    this.ttKeyHi[idx] = board.hashHi;
    this.ttScore[idx] = storedScore;
    this.ttMove[idx] = move;
    this.ttDepth[idx] = depth;
    this.ttFlag[idx] = flag;
    this.ttGen[idx] = this.generation;
  }

  scoreMove(board, move, ttMove, ply) {
    if (move === ttMove) return 2_000_000;

    if (isCapture(move)) {
      const victim = moveCapturedType(move) || PAWN;
      const attacker = Math.abs(board.squares[moveFrom(move)]) || PAWN;
      return 1_000_000 + PIECE_VALUES[victim] * 10 - PIECE_VALUES[attacker];
    }

    const promo = movePromo(move);
    if (promo) {
      return 900_000 + PIECE_VALUES[promo];
    }

    if (ply < 128) {
      const kIdx = ply * 2;
      if (move === this.killers[kIdx]) return 800_000;
      if (move === this.killers[kIdx + 1]) return 750_000;
    }

    const sideIdx = board.turn === WHITE ? 0 : 1;
    return this.history[sideIdx * 4096 + moveFrom(move) * 64 + moveTo(move)];
  }

  orderMoves(board, moves, ttMove, ply) {
    const scores = new Int32Array(moves.length);
    for (let i = 0; i < moves.length; i++) {
      scores[i] = this.scoreMove(board, moves[i], ttMove, ply);
    }
    // Insertion/selection hybrid (fast for typical 20-45 chess moves)
    for (let i = 1; i < moves.length; i++) {
      const m = moves[i];
      const s = scores[i];
      let j = i - 1;
      while (j >= 0 && scores[j] < s) {
        moves[j + 1] = moves[j];
        scores[j + 1] = scores[j];
        j--;
      }
      moves[j + 1] = m;
      scores[j + 1] = s;
    }
  }

  hasNonPawnMaterial(board, color) {
    const squares = board.squares;
    for (let sq = 0; sq < 64; sq++) {
      const p = squares[sq];
      if (p !== EMPTY && (p > 0 ? WHITE : BLACK) === color) {
        const t = Math.abs(p);
        if (t !== PAWN && t !== KING) return true;
      }
    }
    return false;
  }

  quiesce(board, alpha, beta, ply) {
    if ((this.nodes & 2047) === 0 && performance.now() >= this.stopTime) {
      this.aborted = true;
      return 0;
    }
    this.nodes++;

    if (ply >= 96) return evaluate(board, this.weights);

    const inCheck = board.inCheck(board.turn);
    if (!inCheck) {
      const standPat = evaluate(board, this.weights);
      if (standPat >= beta) return beta;
      if (standPat > alpha) alpha = standPat;

      const moves = board.generateLegalMoves(true);
      if (moves.length === 0) return alpha;
      this.orderMoves(board, moves, 0, ply);

      for (let i = 0; i < moves.length; i++) {
        const m = moves[i];
        // Delta pruning for clearly hopeless captures
        const capVal = PIECE_VALUES[moveCapturedType(m)] || 0;
        const promoVal = movePromo(m) ? 800 : 0;
        if (standPat + capVal + promoVal + 200 < alpha) continue;

        board.makeMove(m);
        const score = -this.quiesce(board, -beta, -alpha, ply + 1);
        board.unmakeMove(m);

        if (this.aborted) return 0;
        if (score >= beta) return beta;
        if (score > alpha) alpha = score;
      }
      return alpha;
    } else {
      // When in check, must search all legal evasions
      const moves = board.generateLegalMoves(false);
      if (moves.length === 0) return -MATE_SCORE + ply;
      this.orderMoves(board, moves, 0, ply);

      for (let i = 0; i < moves.length; i++) {
        board.makeMove(moves[i]);
        const score = -this.quiesce(board, -beta, -alpha, ply + 1);
        board.unmakeMove(moves[i]);

        if (this.aborted) return 0;
        if (score >= beta) return beta;
        if (score > alpha) alpha = score;
      }
      return alpha;
    }
  }

  negamax(board, depth, alpha, beta, ply, allowNull) {
    if ((this.nodes & 2047) === 0 && performance.now() >= this.stopTime) {
      this.aborted = true;
      return 0;
    }

    // Draw checks inside search
    if (ply > 0) {
      if (board.halfmoveClock >= 100 || board.isInsufficientMaterial()) return 0;
      if (board.isRepetitionInSearch(board.getHashKey())) return 0;
    }

    const inCheck = board.inCheck(board.turn);
    if (inCheck && ply < 64) depth++; // Check extension

    if (depth <= 0) {
      return this.quiesce(board, alpha, beta, ply);
    }

    this.nodes++;
    const isPv = beta - alpha > 1;
    const origAlpha = alpha;

    // Transposition Table lookup
    const tt = this.probeTT(board, depth, alpha, beta, ply);
    if (tt.hit && ply > 0 && !isPv) {
      return tt.score;
    }

    // Null-move pruning
    if (
      allowNull &&
      !inCheck &&
      !isPv &&
      depth >= 3 &&
      ply > 0 &&
      this.hasNonPawnMaterial(board, board.turn)
    ) {
      const R = depth >= 6 ? 3 : 2;
      board.makeNullMove();
      const nullScore = -this.negamax(board, depth - 1 - R, -beta, -beta + 1, ply + 1, false);
      board.unmakeNullMove();
      if (this.aborted) return 0;
      if (nullScore >= beta && nullScore < MATE_THRESHOLD) {
        return beta;
      }
    }

    const moves = board.generateLegalMoves(false);
    if (moves.length === 0) {
      return inCheck ? -MATE_SCORE + ply : 0;
    }

    this.orderMoves(board, moves, tt.move, ply);

    let bestMove = moves[0];
    let bestScore = -INF;

    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const quiet = !isCapture(m) && !movePromo(m);

      board.makeMove(m);

      let score;
      if (i === 0) {
        score = -this.negamax(board, depth - 1, -beta, -alpha, ply + 1, true);
      } else {
        // Late Move Reductions (LMR)
        let reduction = 0;
        if (depth >= 3 && i >= 3 && quiet && !inCheck && !board.inCheck(board.turn)) {
          reduction = i >= 10 && depth >= 5 ? 2 : 1;
        }

        // Zero-window scout search
        score = -this.negamax(board, depth - 1 - reduction, -alpha - 1, -alpha, ply + 1, true);

        // Re-search at full depth if reduced search beat alpha
        if (reduction > 0 && score > alpha && !this.aborted) {
          score = -this.negamax(board, depth - 1, -alpha - 1, -alpha, ply + 1, true);
        }
        // Full-window re-search if scout search beat alpha in PV node
        if (score > alpha && score < beta && !this.aborted) {
          score = -this.negamax(board, depth - 1, -beta, -alpha, ply + 1, true);
        }
      }

      board.unmakeMove(m);
      if (this.aborted) return 0;

      if (score > bestScore) {
        bestScore = score;
        bestMove = m;
      }

      if (score > alpha) {
        alpha = score;
        if (alpha >= beta) {
          if (quiet && ply < 128) {
            const kIdx = ply * 2;
            if (this.killers[kIdx] !== m) {
              this.killers[kIdx + 1] = this.killers[kIdx];
              this.killers[kIdx] = m;
            }
            const sideIdx = board.turn === WHITE ? 0 : 1;
            const hIdx = sideIdx * 4096 + moveFrom(m) * 64 + moveTo(m);
            this.history[hIdx] = Math.min(this.history[hIdx] + depth * depth, 500_000);
          }
          break;
        }
      }
    }

    let flag = TT_EXACT;
    if (bestScore <= origAlpha) flag = TT_UPPER;
    else if (bestScore >= beta) flag = TT_LOWER;
    this.storeTT(board, depth, bestScore, flag, bestMove, ply);

    return bestScore;
  }

  extractPV(board, maxLen = 8) {
    const pv = [];
    const seen = new Set();
    const copy = board.clone();

    for (let i = 0; i < maxLen; i++) {
      const key = copy.getHashKey();
      if (seen.has(key)) break;
      seen.add(key);

      const idx = copy.hashLo & TT_MASK;
      if (
        this.ttGen[idx] === 0 ||
        this.ttKeyLo[idx] !== copy.hashLo ||
        this.ttKeyHi[idx] !== copy.hashHi
      ) {
        break;
      }
      const move = this.ttMove[idx];
      if (!move) break;

      const legal = copy.generateLegalMoves();
      if (!legal.includes(move)) break;

      pv.push(move);
      copy.makeMove(move);
    }

    return pv;
  }

  /**
   * Run iterative deepening search and return best move, eval, PV, and ranked candidate moves.
   */
  search(board, { maxDepth = 6, maxTimeMs = 800, multiPV = 1 } = {}) {
    const startTime = performance.now();
    this.stopTime = startTime + maxTimeMs;
    this.nodes = 0;
    this.aborted = false;
    this.generation = (this.generation + 1) & 255 || 1;

    // Decay history table slightly between searches
    for (let i = 0; i < this.history.length; i++) {
      this.history[i] >>= 2;
    }

    const legalMoves = board.generateLegalMoves();
    if (legalMoves.length === 0) {
      return {
        bestMove: 0,
        score: board.inCheck(board.turn) ? -MATE_SCORE : 0,
        depth: 0,
        nodes: 0,
        timeMs: 0,
        pv: [],
        candidates: []
      };
    }

    if (legalMoves.length === 1 && multiPV === 1) {
      const m = legalMoves[0];
      board.makeMove(m);
      const quickScore = -evaluate(board, this.weights);
      board.unmakeMove(m);
      return {
        bestMove: m,
        score: quickScore,
        depth: 1,
        nodes: 1,
        timeMs: Math.max(1, Math.round(performance.now() - startTime)),
        pv: [m],
        candidates: [{ move: m, score: quickScore, uci: moveToUCI(m), pv: [m] }]
      };
    }

    let bestMove = legalMoves[0];
    let bestScore = -INF;
    let completedDepth = 0;
    let ranked = legalMoves.map((m) => ({ move: m, score: -INF, uci: moveToUCI(m), pv: [m] }));

    for (let depth = 1; depth <= maxDepth; depth++) {
      const depthResults = [];
      let alpha = -INF;
      const beta = INF;

      // Order root moves by previous iteration's scores
      if (depth > 1) {
        ranked.sort((a, b) => b.score - a.score);
      } else {
        const tt = this.probeTT(board, 0, -INF, INF, 0);
        const ordered = ranked.map((r) => r.move);
        this.orderMoves(board, ordered, tt.move, 0);
        ranked = ordered.map((m) => ({ move: m, score: -INF, uci: moveToUCI(m), pv: [m] }));
      }

      let iterBestMove = ranked[0].move;
      let iterBestScore = -INF;

      for (let i = 0; i < ranked.length; i++) {
        const m = ranked[i].move;
        board.makeMove(m);

        let score;
        if (multiPV === 1) {
          if (i === 0) {
            score = -this.negamax(board, depth - 1, -beta, -alpha, 1, true);
          } else {
            score = -this.negamax(board, depth - 1, -alpha - 1, -alpha, 1, true);
            if (score > alpha && !this.aborted) {
              score = -this.negamax(board, depth - 1, -beta, -alpha, 1, true);
            }
          }
        } else {
          // Multi-PV mode: full window for first `multiPV` moves, scout against Nth-best afterward
          if (depthResults.length < multiPV) {
            score = -this.negamax(board, depth - 1, -INF, INF, 1, true);
          } else {
            const topScores = depthResults.map((r) => r.score).sort((a, b) => b - a);
            const cutoff = topScores[multiPV - 1];
            score = -this.negamax(board, depth - 1, -cutoff - 1, -cutoff, 1, true);
            if (score > cutoff && !this.aborted) {
              score = -this.negamax(board, depth - 1, -INF, -cutoff, 1, true);
            }
          }
        }

        const childPv = this.aborted ? [] : this.extractPV(board, 6);
        board.unmakeMove(m);

        if (this.aborted) break;

        depthResults.push({
          move: m,
          score,
          uci: moveToUCI(m),
          pv: [m, ...childPv]
        });

        if (score > iterBestScore) {
          iterBestScore = score;
          iterBestMove = m;
        }
        if (multiPV === 1 && score > alpha) {
          alpha = score;
        }
      }

      if (this.aborted && depth > 1) {
        // Keep partial improvements only if the first move finished and beat previous
        break;
      }

      depthResults.sort((a, b) => b.score - a.score);
      ranked = depthResults;
      bestMove = depthResults[0].move;
      bestScore = depthResults[0].score;
      completedDepth = depth;

      this.storeTT(board, depth, bestScore, TT_EXACT, bestMove, 0);

      // Stop early if forced mate is found and we only need 1 PV
      if (multiPV === 1 && Math.abs(bestScore) > MATE_THRESHOLD) break;
      if (performance.now() - startTime > maxTimeMs * 0.65) break;
    }

    const timeMs = Math.max(1, Math.round(performance.now() - startTime));
    return {
      bestMove,
      score: bestScore,
      depth: completedDepth,
      nodes: this.nodes,
      timeMs,
      pv: ranked[0]?.pv || [bestMove],
      candidates: ranked.slice(0, Math.max(multiPV, 5))
    };
  }
}
