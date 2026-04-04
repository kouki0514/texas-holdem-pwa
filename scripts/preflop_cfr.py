"""
6-Max Texas Hold'em Preflop-Only CFR+ Solver
=============================================
Hands    : 169 canonical hand classes (AA, AKs, AKo, ...)
Positions: UTG / HJ / CO / BTN / SB / BB  (seats 0-5)
Actions  : fold / call / raise
  - 1st raise (open) : 2.5 BB
  - 2nd raise (3-bet): 3x previous raise
  - 3rd raise (4-bet): 2.5x previous raise
  - 4th raise (5-bet): all-in (stack = 100 BB)
  - Max 4 raises; tree terminates after that
Equity   : Monte Carlo approximation precomputed for all 169x169 pairs
Output   : scripts/preflop_strategy.json
           Key  = "{position}_{action_history}_{hand}"
           Value = {"fold": f, "call": c, "raise": r}

Recommended iterations:
  Quick test   :   50,000  (python3 preflop_cfr.py 50000 50)
  Moderate     :  500,000  (python3 preflop_cfr.py 500000 100)
  Full quality : 3,000,000  (python3 preflop_cfr.py 3000000 200)
  (Tree is ~4x larger than 2-raise version due to 4bet/5bet nodes)
"""

import json
import random
import time
import sys
from collections import defaultdict, Counter
from itertools import combinations
from pathlib import Path
from typing import Dict, List, Tuple

# ──────────────────────────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────────────────────────

POSITIONS = ["UTG", "HJ", "CO", "BTN", "SB", "BB"]
N_PLAYERS = 6

BIG_BLIND   = 1.0
SMALL_BLIND = 0.5
STACK       = 100.0  # starting stack in BB (used for 5-bet all-in cap)

# Raise sizing by raise number (1-indexed: raise_count before this raise → new total)
# raise_count==0 → open (2.5 BB)
# raise_count==1 → 3-bet (3x last raise)
# raise_count==2 → 4-bet (2.5x last raise)
# raise_count==3 → 5-bet (all-in, capped at STACK)
OPEN_SIZE    = 2.5
THREBET_MULT = 3.0
FOURBET_MULT = 2.5
MAX_RAISES   = 4  # open / 3-bet / 4-bet / 5-bet

# Preflop antes / blinds indexed by seat (UTG=0 … BB=5)
BLINDS = [0.0, 0.0, 0.0, 0.0, SMALL_BLIND, BIG_BLIND]

# Recommended iterations (see docstring for guidance)
ITERATIONS = 3_000_000

# ──────────────────────────────────────────────────────────────────────────────
# Cards / hands
# ──────────────────────────────────────────────────────────────────────────────

RANKS  = ["2","3","4","5","6","7","8","9","T","J","Q","K","A"]
SUITS  = ["s","h","d","c"]
RANK_VAL: Dict[str, int] = {r: i for i, r in enumerate(RANKS)}  # 2→0, A→12

# Integer-coded deck: card = rank*4 + suit_idx  (0..51)
DECK_INT: List[int] = list(range(52))

def card_rank(c: int) -> int: return c >> 2
def card_suit(c: int) -> int: return c & 3

# ──────────────────────────────────────────────────────────────────────────────
# 169 canonical hand classes
# ──────────────────────────────────────────────────────────────────────────────

_hand_set: set = set()
HANDS: List[str] = []
for i in range(12, -1, -1):          # A down to 2
    for j in range(12, -1, -1):
        r1, r2 = RANKS[i], RANKS[j]
        if i > j:
            h = f"{r1}{r2}o"
        elif i == j:
            h = f"{r1}{r2}"
        else:
            h = f"{r1}{r2}s"         # suited: higher rank first → already i>j above; never hit
        # We want higher rank first always:
        hi, lo = (i, j) if i >= j else (j, i)
        r_hi, r_lo = RANKS[hi], RANKS[lo]
        if hi == lo:
            h = f"{r_hi}{r_lo}"
        elif i >= j:
            h = f"{r_hi}{r_lo}s" if False else f"{r_hi}{r_lo}o"  # placeholder
            # actually redo properly below
            pass

# Redo properly
HANDS = []
_seen: set = set()
for hi in range(12, -1, -1):         # A=12 down to 2=0
    for lo in range(hi, -1, -1):     # lo <= hi
        r_hi, r_lo = RANKS[hi], RANKS[lo]
        if hi == lo:
            h = f"{r_hi}{r_lo}"      # pocket pair
        else:
            h = f"{r_hi}{r_lo}s"     # suited (we'll add offsuit separately)
            h2 = f"{r_hi}{r_lo}o"
            if h2 not in _seen:
                _seen.add(h2)
                HANDS.append(h2)
        if h not in _seen:
            _seen.add(h)
            HANDS.append(h)

# Sort by descending strength (pairs, then by hi rank, then suited/offsuit)
def hand_sort_key(h: str):
    if len(h) == 2:               # pair
        return (0, -RANK_VAL[h[0]], 0)
    suited = h.endswith("s")
    hi_r = RANK_VAL[h[0]]
    lo_r = RANK_VAL[h[1]]
    return (1, -hi_r, -lo_r, 0 if suited else 1)

HANDS.sort(key=hand_sort_key)
assert len(HANDS) == 169, f"Expected 169 hands, got {len(HANDS)}"

HAND_INDEX: Dict[str, int] = {h: i for i, h in enumerate(HANDS)}

# ──────────────────────────────────────────────────────────────────────────────
# Combo table for random hand sampling (weighted by combo count)
# ──────────────────────────────────────────────────────────────────────────────
# pairs=6 combos, suited=4, offsuit=12 → total 1326

_COMBO_TABLE: List[str] = []

def _build_combo_table() -> None:
    global _COMBO_TABLE
    if _COMBO_TABLE:
        return
    for h in HANDS:
        if len(h) == 2:          # pair
            _COMBO_TABLE.extend([h] * 6)
        elif h.endswith("s"):    # suited
            _COMBO_TABLE.extend([h] * 4)
        else:                    # offsuit
            _COMBO_TABLE.extend([h] * 12)
    assert len(_COMBO_TABLE) == 1326

def random_hand() -> str:
    return _COMBO_TABLE[random.randint(0, 1325)]

# ──────────────────────────────────────────────────────────────────────────────
# Fast 7-card hand evaluator (integer score, higher = better)
# ──────────────────────────────────────────────────────────────────────────────

def _hand_score_5(cards5: Tuple[int, ...]) -> int:
    ranks = sorted([card_rank(c) for c in cards5], reverse=True)
    suits = [card_suit(c) for c in cards5]
    flush = len(set(suits)) == 1

    # Straight detection
    unique_r = set(ranks)
    straight = False
    top_straight = ranks[0]
    if len(unique_r) == 5 and ranks[0] - ranks[4] == 4:
        straight = True
    elif unique_r == {12, 0, 1, 2, 3}:   # wheel A-2-3-4-5
        straight = True
        top_straight = 3

    cnt = Counter(ranks)
    freq = sorted(cnt.values(), reverse=True)
    groups = sorted(cnt.keys(), key=lambda r: (cnt[r], r), reverse=True)

    if flush and straight:
        return (8 << 20) | top_straight
    if freq[0] == 4:
        return (7 << 20) | (groups[0] << 4) | groups[1]
    if freq == [3, 2]:
        return (6 << 20) | (groups[0] << 4) | groups[1]
    if flush:
        v = 0
        for i, r in enumerate(reversed(ranks)):
            v |= r << (4 * i)
        return (5 << 20) | v
    if straight:
        return (4 << 20) | top_straight
    if freq[0] == 3:
        k = sorted([groups[1], groups[2]], reverse=True)
        return (3 << 20) | (groups[0] << 8) | (k[0] << 4) | k[1]
    if freq == [2, 2, 1]:
        p1, p2 = sorted([groups[0], groups[1]], reverse=True)
        return (2 << 20) | (p1 << 8) | (p2 << 4) | groups[2]
    if freq[0] == 2:
        k = sorted([groups[1], groups[2], groups[3]], reverse=True)
        return (1 << 20) | (groups[0] << 12) | (k[0] << 8) | (k[1] << 4) | k[2]
    v = 0
    for i, r in enumerate(reversed(ranks)):
        v |= r << (4 * i)
    return v

def best_hand_score(hole: Tuple[int, int], board: Tuple[int, ...]) -> int:
    cards = hole + board
    best = -1
    for combo in combinations(cards, 5):
        s = _hand_score_5(combo)
        if s > best:
            best = s
    return best

# ──────────────────────────────────────────────────────────────────────────────
# Preflop equity precomputation
# ──────────────────────────────────────────────────────────────────────────────

# We precompute equity for all 169x169 hand-class pairs (14,161 ordered pairs)
# using Monte Carlo. This runs once before CFR and avoids per-node equity calls.

_EQUITY: Dict[Tuple[int, int], float] = {}  # (hand_idx1, hand_idx2) → equity of h1

_SUIT_INT = {s: i for i, s in enumerate(SUITS)}

def _sample_int_hand(h: str) -> Tuple[int, int]:
    """Return a random concrete (int, int) pair for the hand class."""
    if len(h) == 2:                  # pair
        r = RANK_VAL[h[0]]
        s1, s2 = random.sample(range(4), 2)
        return (r * 4 + s1, r * 4 + s2)
    elif h.endswith("s"):            # suited
        r1, r2 = RANK_VAL[h[0]], RANK_VAL[h[1]]
        s = random.randint(0, 3)
        return (r1 * 4 + s, r2 * 4 + s)
    else:                            # offsuit
        r1, r2 = RANK_VAL[h[0]], RANK_VAL[h[1]]
        s1 = random.randint(0, 3)
        s2 = random.choice([s for s in range(4) if s != s1])
        return (r1 * 4 + s1, r2 * 4 + s2)

def _mc_equity(h1: str, h2: str, n: int = 500) -> float:
    """Monte Carlo equity of h1 vs h2 (preflop all-in)."""
    wins = ties = valid = 0
    deck = list(range(52))
    for _ in range(n):
        c1 = _sample_int_hand(h1)
        c2 = _sample_int_hand(h2)
        used = set(c1) | set(c2)
        if len(used) < 4:
            continue
        rem = [c for c in deck if c not in used]
        random.shuffle(rem)
        board = tuple(rem[:5])
        s1 = best_hand_score(c1, board)
        s2 = best_hand_score(c2, board)
        valid += 1
        if s1 > s2:
            wins += 1
        elif s1 == s2:
            ties += 1
    return (wins + 0.5 * ties) / valid if valid > 0 else 0.5

def precompute_equities(n_per_pair: int = 200) -> None:
    """Precompute equity table for all 169x169 ordered pairs."""
    total = len(HANDS) * len(HANDS)
    done = 0
    t0 = time.time()
    print(f"Precomputing {len(HANDS)}x{len(HANDS)} = {total:,} equity pairs "
          f"({n_per_pair} samples each)...", flush=True)

    for i, h1 in enumerate(HANDS):
        for j, h2 in enumerate(HANDS):
            if i == j:
                _EQUITY[(i, j)] = 0.5
                _EQUITY[(j, i)] = 0.5
                continue
            if (j, i) in _EQUITY:
                _EQUITY[(i, j)] = 1.0 - _EQUITY[(j, i)]
                continue
            eq = _mc_equity(h1, h2, n_per_pair)
            _EQUITY[(i, j)] = eq
            _EQUITY[(j, i)] = 1.0 - eq
        done += len(HANDS)
        if (i + 1) % 20 == 0 or i == len(HANDS) - 1:
            elapsed = time.time() - t0
            pct = done / total * 100
            print(f"  {done:,}/{total:,} ({pct:.0f}%)  {elapsed:.1f}s", flush=True)

    print(f"Equity table ready ({len(_EQUITY):,} entries)  "
          f"{time.time()-t0:.1f}s", flush=True)

def equity(h1_idx: int, h2_idx: int) -> float:
    return _EQUITY.get((h1_idx, h2_idx), 0.5)

# ──────────────────────────────────────────────────────────────────────────────
# Terminal EV
# ──────────────────────────────────────────────────────────────────────────────

def terminal_ev(
    seat: int,
    active: List[bool],
    contributions: List[float],
    hand_idxs: List[int],
) -> float:
    active_seats = [i for i in range(N_PLAYERS) if active[i]]
    pot = sum(contributions)

    if len(active_seats) == 1:
        won = 1 if active_seats[0] == seat else 0
        return pot * won - contributions[seat]

    n = len(active_seats)
    if n == 2:
        s0, s1 = active_seats
        eq = equity(hand_idxs[s0], hand_idxs[s1])
        if seat == s0:
            return pot * eq - contributions[seat]
        else:
            return pot * (1.0 - eq) - contributions[seat]

    # Multi-way: normalise head-up equities
    eq_map: Dict[int, float] = {}
    for s in active_seats:
        others = [o for o in active_seats if o != s]
        eq_map[s] = sum(equity(hand_idxs[s], hand_idxs[o]) for o in others) / len(others)
    total_eq = sum(eq_map.values()) or 1.0
    for s in active_seats:
        eq_map[s] /= total_eq
    return pot * eq_map.get(seat, 0.0) - contributions[seat]

# ──────────────────────────────────────────────────────────────────────────────
# Infoset key & actions
# ──────────────────────────────────────────────────────────────────────────────

ActionHist = Tuple[str, ...]

def infoset_key(pos: str, hist: ActionHist, hand: str) -> str:
    return f"{pos}_{'_'.join(hist) if hist else 'NONE'}_{hand}"

def next_raise_to(raise_count: int, last_raise_to: float) -> float:
    """Compute the new total bet size for the next raise.
    raise_count = number of raises already made (0=none yet → open).
    Returns the new 'last_raise_to' value (capped at STACK for all-in)."""
    if raise_count == 0:
        return OPEN_SIZE
    elif raise_count == 1:
        return min(last_raise_to * THREBET_MULT, STACK)
    elif raise_count == 2:
        return min(last_raise_to * FOURBET_MULT, STACK)
    else:
        # 5-bet and beyond → all-in
        return STACK

def legal_actions(raise_count: int, to_call: float) -> List[str]:
    if to_call > 1e-9:
        if raise_count < MAX_RAISES:
            return ["fold", "call", "raise"]
        return ["fold", "call"]
    else:
        # no bet to call → check or open-raise
        return ["check", "raise"]

# ──────────────────────────────────────────────────────────────────────────────
# CFR+ tables
# ──────────────────────────────────────────────────────────────────────────────

regret_sum:   Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
strategy_sum: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))

def current_strategy(ikey: str, actions: List[str]) -> Dict[str, float]:
    regs = regret_sum[ikey]
    pos = {a: max(0.0, regs.get(a, 0.0)) for a in actions}
    total = sum(pos.values())
    if total > 0.0:
        return {a: pos[a] / total for a in actions}
    u = 1.0 / len(actions)
    return {a: u for a in actions}

# ──────────────────────────────────────────────────────────────────────────────
# CFR+ traversal (chance-sampling / external sampling style)
# ──────────────────────────────────────────────────────────────────────────────

def cfr_traverse(
    acting_order: List[int],
    act_ptr: int,
    hist: ActionHist,
    contributions: List[float],
    active: List[bool],
    last_raise_to: float,
    raise_count: int,
    hand_idxs: List[int],
    traverser: int,
    t: int,
) -> float:
    # --- Terminal: only 1 (or 0) player remains ---
    active_seats = [i for i in range(N_PLAYERS) if active[i]]
    if len(active_seats) <= 1:
        return terminal_ev(traverser, active, contributions, hand_idxs)

    # --- Skip folded players ---
    while act_ptr < len(acting_order) and not active[acting_order[act_ptr]]:
        act_ptr += 1

    # --- All remaining have called → showdown ---
    if act_ptr >= len(acting_order):
        return terminal_ev(traverser, active, contributions, hand_idxs)

    # Check if everyone active has matched last_raise_to (and we've done at least one pass)
    all_called = all(abs(contributions[i] - last_raise_to) < 1e-9 for i in active_seats)
    if all_called and act_ptr > 0:
        return terminal_ev(traverser, active, contributions, hand_idxs)

    seat = acting_order[act_ptr]
    pos  = POSITIONS[seat]
    hand = HANDS[hand_idxs[seat]]
    to_call = last_raise_to - contributions[seat]
    actions = legal_actions(raise_count, to_call)
    ikey = infoset_key(pos, hist, hand)
    strat = current_strategy(ikey, actions)

    # ── Traverser node: compute all action EVs ──
    if seat == traverser:
        ev_map: Dict[str, float] = {}
        for a in actions:
            new_cont  = contributions[:]
            new_act   = active[:]
            new_rto   = last_raise_to
            new_rc    = raise_count
            new_hist  = hist + (f"{pos}_{a}",)

            if a == "fold":
                new_act[seat] = False
            elif a in ("call", "check"):
                new_cont[seat] = last_raise_to
            elif a == "raise":
                new_rto = next_raise_to(raise_count, last_raise_to)
                new_cont[seat] = new_rto
                new_rc = raise_count + 1

            ev_map[a] = cfr_traverse(
                acting_order, act_ptr + 1, new_hist,
                new_cont, new_act, new_rto, new_rc,
                hand_idxs, traverser, t,
            )

        node_ev = sum(strat[a] * ev_map[a] for a in actions)

        # CFR+ update
        for a in actions:
            regret_sum[ikey][a] = max(0.0, regret_sum[ikey][a] + ev_map[a] - node_ev)
            strategy_sum[ikey][a] += t * strat[a]

        return node_ev

    # ── Opponent node: sample one action ──
    else:
        # Update strategy sum (opponent's contribution)
        for a in actions:
            strategy_sum[ikey][a] += strat.get(a, 0.0)

        # Sample
        r = random.random()
        cumul = 0.0
        chosen = actions[-1]
        for a in actions:
            cumul += strat.get(a, 0.0)
            if r < cumul:
                chosen = a
                break

        new_cont  = contributions[:]
        new_act   = active[:]
        new_rto   = last_raise_to
        new_rc    = raise_count
        new_hist  = hist + (f"{pos}_{chosen}",)

        if chosen == "fold":
            new_act[seat] = False
        elif chosen in ("call", "check"):
            new_cont[seat] = last_raise_to
        elif chosen == "raise":
            new_rto = next_raise_to(raise_count, last_raise_to)
            new_cont[seat] = new_rto
            new_rc = raise_count + 1

        return cfr_traverse(
            acting_order, act_ptr + 1, new_hist,
            new_cont, new_act, new_rto, new_rc,
            hand_idxs, traverser, t,
        )

# ──────────────────────────────────────────────────────────────────────────────
# Main CFR+ loop
# ──────────────────────────────────────────────────────────────────────────────

def run_cfr(iterations: int) -> None:
    _build_combo_table()
    acting_order = list(range(N_PLAYERS))  # UTG(0)→HJ(1)→…→BB(5)

    t0 = time.time()
    for t in range(1, iterations + 1):
        hand_idxs = [HAND_INDEX[random_hand()] for _ in range(N_PLAYERS)]
        contributions = list(BLINDS)
        active = [True] * N_PLAYERS
        traverser = random.randint(0, N_PLAYERS - 1)

        cfr_traverse(
            acting_order, 0, (),
            contributions, active,
            BIG_BLIND,   # last_raise_to = BB (players must call/raise from here)
            0,           # raise_count
            hand_idxs, traverser, t,
        )

        if t % 100_000 == 0:
            elapsed = time.time() - t0
            rate = t / elapsed
            eta = (iterations - t) / rate
            print(f"  iter {t:>8,} / {iterations:,}  "
                  f"{elapsed:.0f}s elapsed  ETA {eta:.0f}s  "
                  f"{len(regret_sum):,} infosets", flush=True)

    print(f"CFR+ done in {time.time()-t0:.1f}s — {len(regret_sum):,} infosets", flush=True)

# ──────────────────────────────────────────────────────────────────────────────
# Strategy export
# ──────────────────────────────────────────────────────────────────────────────

def export_strategy(output_path: str) -> None:
    result: Dict[str, Dict[str, float]] = {}

    for ikey, ss in strategy_sum.items():
        total = sum(ss.values())
        if total <= 0:
            continue
        strat: Dict[str, float] = {a: v / total for a, v in ss.items()}

        # "check" → "call" for uniform output keys
        if "check" in strat:
            strat["call"] = strat.pop("check") + strat.get("call", 0.0)

        # Ensure all three keys present
        for k in ("fold", "call", "raise"):
            strat.setdefault(k, 0.0)

        # Final normalise
        s = sum(strat.values())
        if s <= 0:
            continue
        result[ikey] = {k: round(strat[k] / s, 4) for k in ("fold", "call", "raise")}

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"Wrote {len(result):,} entries → {output_path}")

# ──────────────────────────────────────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    iters       = int(sys.argv[1])       if len(sys.argv) > 1 else ITERATIONS
    eq_samples  = int(sys.argv[2])       if len(sys.argv) > 2 else 200
    out_path    = str(Path(__file__).parent / "preflop_strategy.json")

    print("6-Max Preflop CFR+ Solver")
    print(f"  Iterations     : {iters:,}")
    print(f"  Equity samples : {eq_samples} per pair")
    print(f"  Output         : {out_path}")
    print()

    precompute_equities(eq_samples)
    print()

    print("Running CFR+...")
    run_cfr(iters)
    print()

    print("Exporting strategy...")
    export_strategy(out_path)
