import {
  WHITE, BLACK, EMPTY, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING
} from '../chess/constants.js';

// Tapered PeSTO-inspired piece values (middlegame & endgame)
const MG_VALUE = [0, 82, 337, 365, 477, 1025, 0];
const EG_VALUE = [0, 94, 281, 297, 512, 936, 0];

// Game phase weights per piece type
const PHASE_WEIGHT = [0, 0, 1, 1, 2, 4, 0];

// Piece-square tables from White's perspective (sq 0 = a8, sq 63 = h1)
const MG_PAWN_PST = [
    0,   0,   0,   0,   0,   0,   0,   0,
   98, 134,  61,  95,  68, 126,  34, -11,
   -6,   7,  26,  31,  65,  56,  25, -20,
  -14,  13,   6,  21,  23,  12,  17, -23,
  -27,  -2,  -5,  12,  17,   6,  10, -25,
  -26,  -4,  -4, -10,   3,   3,  33, -12,
  -35,  -1, -20, -23, -15,  24,  38, -22,
    0,   0,   0,   0,   0,   0,   0,   0
];

const EG_PAWN_PST = [
    0,   0,   0,   0,   0,   0,   0,   0,
  178, 173, 158, 134, 147, 132, 165, 187,
   94, 100,  85,  67,  56,  53,  82,  84,
   32,  24,  13,   5,  -2,   4,  17,  17,
   13,   9,  -3,  -7,  -7,  -8,   3,  -1,
    4,   7,  -6,   1,   0,  -5,  -1,  -8,
   13,   8,   8,  10,  13,   0,   2,  -7,
    0,   0,   0,   0,   0,   0,   0,   0
];

const MG_KNIGHT_PST = [
 -167, -89, -34, -49,  61, -97, -15, -107,
  -73, -41,  72,  36,  23,  62,   7,  -17,
  -47,  60,  37,  65,  84, 129,  73,   44,
   -9,  17,  19,  53,  37,  69,  18,   22,
  -13,   4,  16,  13,  28,  19,  21,   -8,
  -23,  -9,  12,  10,  19,  17,  25,  -16,
  -29, -53, -12,  -3,  -1,  18, -14,  -19,
 -105, -21, -58, -33, -17, -28, -19,  -23
];

const EG_KNIGHT_PST = [
  -58, -38, -13, -28, -31, -27, -63, -99,
  -25,  -8, -25,  -2,  -9, -25, -24, -52,
  -24, -20,  10,   9,  -1,  -9, -19, -41,
  -17,   3,  22,  22,  22,  11,   8, -18,
  -18,  -6,  16,  25,  16,  17,   4, -18,
  -23,  -3,  -1,  15,  10,  -3, -20, -22,
  -42, -20, -10,  -5,  -2, -20, -23, -44,
  -29, -51, -23, -15, -22, -18, -50, -64
];

const MG_BISHOP_PST = [
  -29,   4, -82, -37, -25, -42,   7,  -8,
  -26,  16, -18, -13,  30,  59,  18, -47,
  -16,  37,  43,  40,  35,  50,  37,  -2,
   -4,   5,  19,  50,  37,  37,   7,  -2,
   -6,  13,  13,  26,  34,  12,  10,   4,
    0,  15,  15,  15,  14,  27,  18,  10,
    4,  15,  16,   0,   7,  21,  33,   1,
  -33,  -3, -14, -21, -13, -12, -39, -21
];

const EG_BISHOP_PST = [
  -14, -21, -11,  -8, -7,  -9, -17, -24,
   -8,  -4,   7, -12, -3, -13,  -4, -14,
    2,  -8,   0,  -1, -2,   6,   0,   4,
   -3,   9,  12,   9, 14,  10,   3,   2,
   -6,   3,  13,  19,  7,  10,  -3,  -9,
  -12,  -3,   8,  10, 13,   3,  -7, -15,
  -14, -18,  -7,  -1,  4,  -9, -15, -27,
  -23,  -9, -23,  -5, -9, -16,  -5, -17
];

const MG_ROOK_PST = [
   32,  42,  32,  51, 63,  9,  31,  43,
   27,  32,  58,  62, 80, 67,  26,  44,
   -5,  19,  26,  36, 17, 45,  61,  16,
  -24, -11,   7,  26, 24, 35,  -8, -20,
  -36, -26, -12,  -1,  9, -7,   6, -23,
  -45, -25, -16, -17,  3,  0,  -5, -33,
  -44, -16, -20,  -9, -1, 11,  -6, -71,
  -19, -13,   1,  17, 16,  7, -37, -26
];

const EG_ROOK_PST = [
   13, 10, 18, 15, 12,  12,   8,   5,
   11, 13, 13, 11, -3,   3,   8,   3,
    7,  7,  7,  5,  4,  -3,  -5,  -3,
    4,  3, 13,  1,  2,   1,  -1,   2,
    3,  5,  8,  4, -5,  -6,  -8, -11,
   -4,  0, -5, -1, -7, -12,  -8, -16,
   -6, -6,  0,  2, -9,  -9, -11,  -3,
   -9,  2,  3, -1, -5, -13,   4, -20
];

const MG_QUEEN_PST = [
  -28,   0,  29,  12,  59,  44,  43,  45,
  -24, -39,  -5,   1, -16,  57,  28,  54,
  -13, -17,   7,   8,  29,  56,  47,  57,
  -27, -27, -16, -16,  -1,  17,  -2,   1,
   -9, -26,  -9, -10,  -2,  -4,   3,  -3,
  -14,   2, -11,  -2,  -5,   2,  14,   5,
  -35,  -8,  11,   2,   8,  15,  -3,   1,
   -1, -18,  -9,  10, -15, -25, -31, -50
];

const EG_QUEEN_PST = [
   -9,  22,  22,  27,  27,  19,  10,  20,
  -17,  20,  32,  41,  58,  25,  30,   0,
  -20,   6,   9,  49,  47,  35,  19,   9,
    3,  22,  24,  45,  57,  40,  57,  36,
  -18,  28,  19,  47,  31,  34,  39,  23,
  -16, -27,  15,   6,   9,  17,  10,   5,
  -22, -23, -30, -16, -16, -23, -36, -32,
  -33, -28, -22, -43,  -5, -32, -20, -41
];

const MG_KING_PST = [
  -65,  23,  16, -15, -56, -34,   2,  13,
   29,  -1, -20,  -7,  -8,  -4, -38, -29,
   -9,  24,   2, -16, -20,   6,  22, -22,
  -17, -20, -12, -27, -30, -25, -14, -36,
  -49,  -1, -27, -39, -46, -44, -33, -51,
  -14, -14, -22, -46, -44, -30, -15, -27,
    1,   7,  -8, -64, -43, -16,   9,   8,
  -15,  36,  12, -54,   8, -28,  24,  14
];

const EG_KING_PST = [
  -74, -35, -18, -18, -11,  15,   4, -17,
  -12,  17,  14,  17,  17,  38,  23,  11,
   10,  17,  23,  15,  20,  45,  44,  13,
   -8,  22,  24,  27,  26,  33,  26,   3,
  -18,  -4,  21,  24,  27,  23,   9, -11,
  -19,  -3,  11,  21,  23,  16,   7,  -9,
  -27, -11,   4,  13,  14,   4,  -5, -17,
  -53, -34, -21, -11, -28, -14, -24, -43
];

const MG_PST = [null, MG_PAWN_PST, MG_KNIGHT_PST, MG_BISHOP_PST, MG_ROOK_PST, MG_QUEEN_PST, MG_KING_PST];
const EG_PST = [null, EG_PAWN_PST, EG_KNIGHT_PST, EG_BISHOP_PST, EG_ROOK_PST, EG_QUEEN_PST, EG_KING_PST];

// Mirror square vertically for Black (rank -> 7 - rank)
const FLIP_SQ = new Uint8Array(64);
for (let sq = 0; sq < 64; sq++) {
  FLIP_SQ[sq] = ((7 - (sq >> 3)) << 3) | (sq & 7);
}

// Passed pawn bonus by rank advancement (0..7)
const PASSED_PAWN_MG = [0, 5, 10, 20, 35, 60, 100, 0];
const PASSED_PAWN_EG = [0, 10, 20, 40, 75, 120, 185, 0];

// Tunable engine evaluation weights (users can tweak these in the Engine Inspector!)
export const DEFAULT_EVAL_WEIGHTS = {
  bishopPair: 35,
  passedPawnScale: 1.0,
  pawnStructureScale: 1.0,
  rookFileBonus: 20,
  kingSafetyScale: 1.0,
  aggression: 0 // -30 to +30 centipawn bias toward active/attacking play
};

/**
 * Evaluate board from side-to-move's perspective in centipawns.
 */
export function evaluate(board, weights = DEFAULT_EVAL_WEIGHTS) {
  const squares = board.squares;
  let mgWhite = 0;
  let egWhite = 0;
  let mgBlack = 0;
  let egBlack = 0;
  let phase = 0;

  let whiteBishops = 0;
  let blackBishops = 0;

  const whitePawnFiles = new Uint8Array(8);
  const blackPawnFiles = new Uint8Array(8);
  const whitePawnMinRank = new Uint8Array(8).fill(8); // closest to rank 0 (promotion)
  const blackPawnMaxRank = new Uint8Array(8).fill(0); // closest to rank 7 (promotion)

  const whitePawns = [];
  const blackPawns = [];
  const whiteRooks = [];
  const blackRooks = [];

  for (let sq = 0; sq < 64; sq++) {
    const p = squares[sq];
    if (p === EMPTY) continue;

    const type = Math.abs(p);
    phase += PHASE_WEIGHT[type];

    if (p > 0) {
      mgWhite += MG_VALUE[type] + MG_PST[type][sq];
      egWhite += EG_VALUE[type] + EG_PST[type][sq];
      if (type === PAWN) {
        const f = sq & 7;
        const r = sq >> 3;
        whitePawnFiles[f]++;
        if (r < whitePawnMinRank[f]) whitePawnMinRank[f] = r;
        whitePawns.push(sq);
      } else if (type === BISHOP) {
        whiteBishops++;
      } else if (type === ROOK) {
        whiteRooks.push(sq);
      }
    } else {
      const msq = FLIP_SQ[sq];
      mgBlack += MG_VALUE[type] + MG_PST[type][msq];
      egBlack += EG_VALUE[type] + EG_PST[type][msq];
      if (type === PAWN) {
        const f = sq & 7;
        const r = sq >> 3;
        blackPawnFiles[f]++;
        if (r > blackPawnMaxRank[f]) blackPawnMaxRank[f] = r;
        blackPawns.push(sq);
      } else if (type === BISHOP) {
        blackBishops++;
      } else if (type === ROOK) {
        blackRooks.push(sq);
      }
    }
  }

  // Bishop pair
  if (whiteBishops >= 2) {
    mgWhite += weights.bishopPair;
    egWhite += weights.bishopPair + 10;
  }
  if (blackBishops >= 2) {
    mgBlack += weights.bishopPair;
    egBlack += weights.bishopPair + 10;
  }

  // Pawn structure: doubled, isolated, passed
  const psScale = weights.pawnStructureScale;
  const ppScale = weights.passedPawnScale;

  for (let f = 0; f < 8; f++) {
    if (whitePawnFiles[f] > 1) {
      const pen = (whitePawnFiles[f] - 1) * 14 * psScale;
      mgWhite -= pen;
      egWhite -= pen * 1.2;
    }
    if (blackPawnFiles[f] > 1) {
      const pen = (blackPawnFiles[f] - 1) * 14 * psScale;
      mgBlack -= pen;
      egBlack -= pen * 1.2;
    }
    if (whitePawnFiles[f] > 0) {
      const hasLeft = f > 0 && whitePawnFiles[f - 1] > 0;
      const hasRight = f < 7 && whitePawnFiles[f + 1] > 0;
      if (!hasLeft && !hasRight) {
        mgWhite -= 12 * psScale;
        egWhite -= 16 * psScale;
      }
    }
    if (blackPawnFiles[f] > 0) {
      const hasLeft = f > 0 && blackPawnFiles[f - 1] > 0;
      const hasRight = f < 7 && blackPawnFiles[f + 1] > 0;
      if (!hasLeft && !hasRight) {
        mgBlack -= 12 * psScale;
        egBlack -= 16 * psScale;
      }
    }
  }

  // Passed pawns
  for (let i = 0; i < whitePawns.length; i++) {
    const sq = whitePawns[i];
    const f = sq & 7;
    const r = sq >> 3;
    let passed = true;
    for (let df = -1; df <= 1; df++) {
      const nf = f + df;
      if (nf >= 0 && nf <= 7 && blackPawnFiles[nf] > 0) {
        // Any black pawn ahead of white pawn (smaller rank index) blocks passed status
        for (let j = 0; j < blackPawns.length; j++) {
          const bsq = blackPawns[j];
          if ((bsq & 7) === nf && (bsq >> 3) < r) {
            passed = false;
            break;
          }
        }
        if (!passed) break;
      }
    }
    if (passed) {
      const adv = 7 - r;
      mgWhite += PASSED_PAWN_MG[adv] * ppScale;
      egWhite += PASSED_PAWN_EG[adv] * ppScale;
    }
  }

  for (let i = 0; i < blackPawns.length; i++) {
    const sq = blackPawns[i];
    const f = sq & 7;
    const r = sq >> 3;
    let passed = true;
    for (let df = -1; df <= 1; df++) {
      const nf = f + df;
      if (nf >= 0 && nf <= 7 && whitePawnFiles[nf] > 0) {
        for (let j = 0; j < whitePawns.length; j++) {
          const wsq = whitePawns[j];
          if ((wsq & 7) === nf && (wsq >> 3) > r) {
            passed = false;
            break;
          }
        }
        if (!passed) break;
      }
    }
    if (passed) {
      const adv = r;
      mgBlack += PASSED_PAWN_MG[adv] * ppScale;
      egBlack += PASSED_PAWN_EG[adv] * ppScale;
    }
  }

  // Rooks on open / semi-open files
  const rfBonus = weights.rookFileBonus;
  for (let i = 0; i < whiteRooks.length; i++) {
    const f = whiteRooks[i] & 7;
    if (whitePawnFiles[f] === 0) {
      const b = blackPawnFiles[f] === 0 ? rfBonus : rfBonus * 0.55;
      mgWhite += b;
      egWhite += b * 0.6;
    }
  }
  for (let i = 0; i < blackRooks.length; i++) {
    const f = blackRooks[i] & 7;
    if (blackPawnFiles[f] === 0) {
      const b = whitePawnFiles[f] === 0 ? rfBonus : rfBonus * 0.55;
      mgBlack += b;
      egBlack += b * 0.6;
    }
  }

  // King pawn shield in middlegame
  const ksScale = weights.kingSafetyScale;
  if (phase > 6 && ksScale > 0) {
    const wkRank = board.whiteKingSq >> 3;
    const wkFile = board.whiteKingSq & 7;
    if (wkRank >= 6) {
      let shield = 0;
      for (let df = -1; df <= 1; df++) {
        const nf = wkFile + df;
        if (nf >= 0 && nf <= 7) {
          if (squares[(6 << 3) | nf] === PAWN) shield += 14;
          else if (squares[(5 << 3) | nf] === PAWN) shield += 7;
        }
      }
      mgWhite += shield * ksScale;
    }

    const bkRank = board.blackKingSq >> 3;
    const bkFile = board.blackKingSq & 7;
    if (bkRank <= 1) {
      let shield = 0;
      for (let df = -1; df <= 1; df++) {
        const nf = bkFile + df;
        if (nf >= 0 && nf <= 7) {
          if (squares[(1 << 3) | nf] === -PAWN) shield += 14;
          else if (squares[(2 << 3) | nf] === -PAWN) shield += 7;
        }
      }
      mgBlack += shield * ksScale;
    }
  }

  // Endgame mop-up: encourage driving losing king to edge and bringing winning king close
  const egDiff = egWhite - egBlack;
  if (phase <= 6 && Math.abs(egDiff) > 250) {
    const wkR = board.whiteKingSq >> 3;
    const wkF = board.whiteKingSq & 7;
    const bkR = board.blackKingSq >> 3;
    const bkF = board.blackKingSq & 7;
    const kingDist = Math.abs(wkR - bkR) + Math.abs(wkF - bkF);

    if (egDiff > 250) {
      const bkCenterDist = Math.abs(bkR - 3.5) + Math.abs(bkF - 3.5);
      egWhite += bkCenterDist * 10 + (14 - kingDist) * 4;
    } else {
      const wkCenterDist = Math.abs(wkR - 3.5) + Math.abs(wkF - 3.5);
      egBlack += wkCenterDist * 10 + (14 - kingDist) * 4;
    }
  }

  // Tapered interpolation
  const mgPhase = Math.min(phase, 24);
  const egPhase = 24 - mgPhase;
  let scoreWhite = Math.round(((mgWhite - mgBlack) * mgPhase + (egWhite - egBlack) * egPhase) / 24);

  // Small tempo bonus for side to move
  const tempo = 10 + (weights.aggression || 0) * 0.3;
  scoreWhite += board.turn === WHITE ? tempo : -tempo;

  return Math.round(board.turn === WHITE ? scoreWhite : -scoreWhite);
}
