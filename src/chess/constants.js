export const WHITE = 1;
export const BLACK = -1;

export const EMPTY = 0;
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

export const WP = 1;
export const WN = 2;
export const WB = 3;
export const WR = 4;
export const WQ = 5;
export const WK = 6;

export const BP = -1;
export const BN = -2;
export const BB = -3;
export const BR = -4;
export const BQ = -5;
export const BK = -6;

// Castling rights bitmask
export const CASTLE_WK = 1;
export const CASTLE_WQ = 2;
export const CASTLE_BK = 4;
export const CASTLE_BQ = 8;

// Move flags
export const FLAG_NONE = 0;
export const FLAG_CAPTURE = 1;
export const FLAG_DOUBLE_PAWN = 2;
export const FLAG_EN_PASSANT = 4;
export const FLAG_CASTLE_K = 8;
export const FLAG_CASTLE_Q = 16;
export const FLAG_PROMOTION = 32;

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

export const PIECE_CHARS = {
  [WP]: 'P', [WN]: 'N', [WB]: 'B', [WR]: 'R', [WQ]: 'Q', [WK]: 'K',
  [BP]: 'p', [BN]: 'n', [BB]: 'b', [BR]: 'r', [BQ]: 'q', [BK]: 'k'
};

export const CHAR_TO_PIECE = {
  P: WP, N: WN, B: WB, R: WR, Q: WQ, K: WK,
  p: BP, n: BN, b: BB, r: BR, q: BQ, k: BK
};

export const PIECE_NAMES = {
  [PAWN]: 'pawn',
  [KNIGHT]: 'knight',
  [BISHOP]: 'bishop',
  [ROOK]: 'rook',
  [QUEEN]: 'queen',
  [KING]: 'king'
};

export const PIECE_VALUES = [0, 100, 320, 330, 500, 900, 20000];

// Compact 32-bit move encoding:
// bits 0..5:   from (0..63)
// bits 6..11:  to (0..63)
// bits 12..17: flags (6 bits)
// bits 18..20: promo piece type (0..6)
// bits 21..23: captured piece type (0..6)
export function encodeMove(from, to, flags = 0, promo = 0, capturedType = 0) {
  return (
    (from & 63) |
    ((to & 63) << 6) |
    ((flags & 63) << 12) |
    ((promo & 7) << 18) |
    ((capturedType & 7) << 21)
  );
}

export function moveFrom(m) {
  return m & 63;
}

export function moveTo(m) {
  return (m >> 6) & 63;
}

export function moveFlags(m) {
  return (m >> 12) & 63;
}

export function movePromo(m) {
  return (m >> 18) & 7;
}

export function moveCapturedType(m) {
  return (m >> 21) & 7;
}

export function isCapture(m) {
  return ((m >> 12) & (FLAG_CAPTURE | FLAG_EN_PASSANT)) !== 0;
}

export function isPromotion(m) {
  return ((m >> 12) & FLAG_PROMOTION) !== 0;
}

export function sqToAlgebraic(sq) {
  const rank = sq >> 3;
  const file = sq & 7;
  return FILES[file] + RANKS[rank];
}

export function algebraicToSq(str) {
  if (!str || str.length < 2) return -1;
  const file = str.charCodeAt(0) - 97;
  const rank = 8 - (str.charCodeAt(1) - 48);
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return -1;
  return (rank << 3) | file;
}

export function moveToUCI(m) {
  const base = sqToAlgebraic(moveFrom(m)) + sqToAlgebraic(moveTo(m));
  const promo = movePromo(m);
  if (!promo) return base;
  const map = { [QUEEN]: 'q', [ROOK]: 'r', [BISHOP]: 'b', [KNIGHT]: 'n' };
  return base + (map[promo] || 'q');
}

export function pieceIndex(piece) {
  // Map piece (-6..-1, 1..6) to 0..11 for Zobrist indexing
  return piece > 0 ? piece - 1 : 6 + (-piece - 1);
}
