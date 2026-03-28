/**
 * useSoundEffects — Web Audio API による高品質効果音生成
 *
 * 外部ファイル不要。すべての音をプログラムで合成します。
 * GameScreen でマウントして state 変化を監視し自動再生。
 */
import { useEffect, useRef } from 'react'
import { useGameStore } from '@/store/gameStore'
import type { ActionType } from '@/game/types'

// ──────────────────────────────────────────────────────────────────────────────
// AudioContext singleton
// ──────────────────────────────────────────────────────────────────────────────
let _ctx: AudioContext | null = null

function getCtx(): AudioContext {
  if (!_ctx) _ctx = new AudioContext()
  if (_ctx.state === 'suspended') _ctx.resume()
  return _ctx
}

// ──────────────────────────────────────────────────────────────────────────────
// Low-level primitives
// ──────────────────────────────────────────────────────────────────────────────

/** ホワイトノイズバッファを生成して返す */
function makeNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.ceil(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  return buf
}

interface EnvParams {
  attack: number   // 秒
  decay: number    // 秒
  sustain: number  // 0–1
  release: number  // 秒
  peak: number     // ピーク音量
}

/** GainNode にADSRエンベロープを設定して返す */
function applyAdsr(
  gain: GainNode,
  t0: number,
  env: EnvParams,
): number {
  const { attack, decay, sustain, release, peak } = env
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(peak, t0 + attack)
  gain.gain.exponentialRampToValueAtTime(Math.max(peak * sustain, 0.0001), t0 + attack + decay)
  gain.gain.setValueAtTime(peak * sustain, t0 + attack + decay)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay + release)
  return t0 + attack + decay + release
}

/** オシレーター + ADSR。接続先 dst を受け取る */
function oscAdsr(
  ctx: AudioContext,
  freq: number,
  type: OscillatorType,
  env: EnvParams,
  dst: AudioNode,
  delay = 0,
) {
  const t0 = ctx.currentTime + delay
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  const end = applyAdsr(gain, t0, env)
  osc.connect(gain)
  gain.connect(dst)
  osc.start(t0)
  osc.stop(end + 0.05)
}

/** ノイズ + フィルター + ADSR */
function noiseAdsr(
  ctx: AudioContext,
  filterType: BiquadFilterType,
  filterFreq: number,
  filterQ: number,
  env: EnvParams,
  dst: AudioNode,
  delay = 0,
  filterFreqEnd?: number,
) {
  const t0 = ctx.currentTime + delay
  const duration = env.attack + env.decay + env.release + 0.05
  const src = ctx.createBufferSource()
  src.buffer = makeNoiseBuffer(ctx, duration)

  const filt = ctx.createBiquadFilter()
  filt.type = filterType
  filt.frequency.setValueAtTime(filterFreq, t0)
  if (filterFreqEnd !== undefined) {
    filt.frequency.exponentialRampToValueAtTime(
      Math.max(filterFreqEnd, 20),
      t0 + env.attack + env.decay + env.release,
    )
  }
  filt.Q.value = filterQ

  const gain = ctx.createGain()
  applyAdsr(gain, t0, env)

  src.connect(filt)
  filt.connect(gain)
  gain.connect(dst)
  src.start(t0)
  src.stop(t0 + duration)
}

// ──────────────────────────────────────────────────────────────────────────────
// ミキサー: マスターゲイン（音量調整 + 軽いコンプ感）
// ──────────────────────────────────────────────────────────────────────────────
function getMaster(ctx: AudioContext): GainNode {
  const master = ctx.createGain()
  master.gain.value = 0.82
  master.connect(ctx.destination)
  return master
}

// ──────────────────────────────────────────────────────────────────────────────
// 効果音
// ──────────────────────────────────────────────────────────────────────────────

/**
 * CHECK — テーブルを軽くノックする鈍い打撃音
 * ローパスフィルターで高域をカット → 木質感のある低いコツン
 */
export function playCheck() {
  const ctx = getCtx()
  const dst = getMaster(ctx)

  // ボディ：インパルス的な低域ノイズ（ローパスで木質感）
  noiseAdsr(ctx, 'lowpass', 320, 1.2,
    { attack: 0.002, decay: 0.055, sustain: 0.0, release: 0.08, peak: 0.55 },
    dst)

  // サブトーン：深みを加える低い正弦波
  oscAdsr(ctx, 140, 'sine',
    { attack: 0.003, decay: 0.04, sustain: 0.0, release: 0.07, peak: 0.22 },
    dst)

  // クリック感：極短い高域バースト
  noiseAdsr(ctx, 'highpass', 3200, 0.8,
    { attack: 0.001, decay: 0.012, sustain: 0.0, release: 0.01, peak: 0.18 },
    dst)
}

/**
 * CALL — チップ1枚をベットエリアに置くクリック音
 * 短いアタック、素早い減衰、セラミックチップのカチッ感
 */
export function playCall() {
  const ctx = getCtx()
  const dst = getMaster(ctx)

  // チップのクリック感：バンドパスノイズ
  noiseAdsr(ctx, 'bandpass', 2200, 4.5,
    { attack: 0.001, decay: 0.028, sustain: 0.0, release: 0.035, peak: 0.50 },
    dst)

  // チップの響き：中域の金属音
  oscAdsr(ctx, 1380, 'sine',
    { attack: 0.001, decay: 0.045, sustain: 0.0, release: 0.06, peak: 0.30 },
    dst)

  // テーブルに当たる低域成分
  noiseAdsr(ctx, 'lowpass', 480, 1.0,
    { attack: 0.002, decay: 0.018, sustain: 0.0, release: 0.02, peak: 0.22 },
    dst)
}

/**
 * BET — チップ数枚をスタックして置く音
 * call より少し長く、重なり感のある連続クリック
 */
export function playBet() {
  const ctx = getCtx()
  const dst = getMaster(ctx)

  const count = 3
  for (let i = 0; i < count; i++) {
    const d = i * 0.055
    // 各チップのクリック（わずかに音程を変えてリアル感）
    noiseAdsr(ctx, 'bandpass', 2000 - i * 120, 4.0,
      { attack: 0.001, decay: 0.030, sustain: 0.0, release: 0.040, peak: 0.42 - i * 0.04 },
      dst, d)
    oscAdsr(ctx, 1250 - i * 80, 'sine',
      { attack: 0.001, decay: 0.040, sustain: 0.0, release: 0.055, peak: 0.22 },
      dst, d)
  }
  // 最後のチップが着地する低域サポート
  noiseAdsr(ctx, 'lowpass', 420, 1.2,
    { attack: 0.002, decay: 0.025, sustain: 0.0, release: 0.03, peak: 0.28 },
    dst, (count - 1) * 0.055)
}

/**
 * RAISE — チップを勢いよくプッシュする音
 * bet より枚数が多く、スライドさせるような連続音 + フィナーレのアクセント
 */
export function playRaise() {
  const ctx = getCtx()
  const dst = getMaster(ctx)

  const count = 5
  for (let i = 0; i < count; i++) {
    const d = i * 0.048
    noiseAdsr(ctx, 'bandpass', 2400 - i * 150, 3.8,
      { attack: 0.001, decay: 0.028, sustain: 0.0, release: 0.038, peak: 0.45 },
      dst, d)
    oscAdsr(ctx, 1500 - i * 90, 'sine',
      { attack: 0.001, decay: 0.038, sustain: 0.0, release: 0.055, peak: 0.24 },
      dst, d)
  }

  // チップが着地する低域
  noiseAdsr(ctx, 'lowpass', 380, 1.5,
    { attack: 0.003, decay: 0.040, sustain: 0.0, release: 0.05, peak: 0.32 },
    dst, count * 0.048)

  // 高域アクセント：プッシュの勢いを表現
  oscAdsr(ctx, 1800, 'sine',
    { attack: 0.005, decay: 0.060, sustain: 0.0, release: 0.08, peak: 0.18 },
    dst, count * 0.048 + 0.01)
}

/**
 * ALL-IN — 全チップが一気に流れ込む音
 * 急加速する連続チップ音 + 最後に重厚な着地インパクト
 */
export function playAllIn() {
  const ctx = getCtx()
  const dst = getMaster(ctx)

  // チップの滝：間隔が徐々に短くなる（加速感）
  const intervals = [0, 0.07, 0.13, 0.18, 0.22, 0.255, 0.285, 0.310, 0.330]
  intervals.forEach((d, i) => {
    const decay = Math.max(0.018, 0.038 - i * 0.002)
    noiseAdsr(ctx, 'bandpass', 1800 + (i % 3) * 200, 3.5,
      { attack: 0.001, decay, sustain: 0.0, release: decay * 1.2, peak: 0.40 + (i / intervals.length) * 0.15 },
      dst, d)
  })

  // 流れ込む間のシャーっという連続摩擦音
  noiseAdsr(ctx, 'bandpass', 1400, 2.0,
    { attack: 0.02, decay: 0.22, sustain: 0.08, release: 0.12, peak: 0.28 },
    dst, 0.02)

  // 最後の着地インパクト：重低音
  noiseAdsr(ctx, 'lowpass', 280, 2.0,
    { attack: 0.002, decay: 0.06, sustain: 0.0, release: 0.10, peak: 0.55 },
    dst, 0.35)
  oscAdsr(ctx, 95, 'sine',
    { attack: 0.003, decay: 0.08, sustain: 0.0, release: 0.15, peak: 0.45 },
    dst, 0.35)
  // サブハーモニック
  oscAdsr(ctx, 48, 'sine',
    { attack: 0.005, decay: 0.12, sustain: 0.0, release: 0.18, peak: 0.28 },
    dst, 0.36)
}

/**
 * FOLD — 紙をテーブルに投げ置く音
 * 高域から低域にフィルターが落ちるブロードノイズ
 */
export function playFold() {
  const ctx = getCtx()
  const dst = getMaster(ctx)

  // 紙の摩擦音（高域→低域）
  noiseAdsr(ctx, 'bandpass', 1800, 1.8,
    { attack: 0.003, decay: 0.10, sustain: 0.0, release: 0.09, peak: 0.35 },
    dst, 0, 600)

  // テーブルに着く鈍い音
  noiseAdsr(ctx, 'lowpass', 350, 1.0,
    { attack: 0.005, decay: 0.055, sustain: 0.0, release: 0.06, peak: 0.28 },
    dst, 0.06)
  oscAdsr(ctx, 180, 'sine',
    { attack: 0.004, decay: 0.045, sustain: 0.0, release: 0.06, peak: 0.15 },
    dst, 0.06)
}

/**
 * カード配布 — 紙の摩擦音（シュッ）
 * ハイパスフィルターで高域主体、短くシャープに
 */
export function playDeal() {
  const ctx = getCtx()
  const dst = getMaster(ctx)

  // シュッという紙の摩擦音
  noiseAdsr(ctx, 'highpass', 3800, 0.6,
    { attack: 0.001, decay: 0.018, sustain: 0.0, release: 0.025, peak: 0.48 },
    dst)

  // 中域の摩擦感（厚み）
  noiseAdsr(ctx, 'bandpass', 2200, 2.5,
    { attack: 0.001, decay: 0.022, sustain: 0.0, release: 0.028, peak: 0.22 },
    dst, 0.002)

  // カードが滑る感じの低域テール
  noiseAdsr(ctx, 'lowpass', 600, 1.0,
    { attack: 0.002, decay: 0.035, sustain: 0.0, release: 0.04, peak: 0.12 },
    dst, 0.008)
}

/**
 * チップ集計 — チップがポットに引き寄せられる音
 */
export function playChipCollect() {
  const ctx = getCtx()
  const dst = getMaster(ctx)

  // 高→低に周波数が落ちるスイープノイズ
  noiseAdsr(ctx, 'bandpass', 2200, 2.2,
    { attack: 0.01, decay: 0.18, sustain: 0.0, release: 0.08, peak: 0.30 },
    dst, 0, 450)

  // 終着点のコツン
  noiseAdsr(ctx, 'bandpass', 1600, 3.5,
    { attack: 0.001, decay: 0.025, sustain: 0.0, release: 0.03, peak: 0.35 },
    dst, 0.22)
  oscAdsr(ctx, 980, 'sine',
    { attack: 0.001, decay: 0.035, sustain: 0.0, release: 0.04, peak: 0.18 },
    dst, 0.22)
}

/**
 * 勝利 — 明るいコイン音
 * 金属的な倍音列 + 上昇するアルペジオ
 */
export function playWin() {
  const ctx = getCtx()
  const dst = getMaster(ctx)

  // コイン音：高い金属倍音
  const coinFreqs = [1318, 1760, 2093, 2637]
  coinFreqs.forEach((freq, i) => {
    oscAdsr(ctx, freq, 'sine',
      { attack: 0.001, decay: 0.055, sustain: 0.12, release: 0.35, peak: 0.30 - i * 0.02 },
      dst, i * 0.085)
    // 奇数倍音でベル感を追加
    oscAdsr(ctx, freq * 2.756, 'sine',
      { attack: 0.001, decay: 0.030, sustain: 0.0, release: 0.12, peak: 0.08 },
      dst, i * 0.085)
  })

  // 着地ノイズ（コインがテーブルに当たる）
  coinFreqs.forEach((_, i) => {
    noiseAdsr(ctx, 'bandpass', 4500, 6.0,
      { attack: 0.001, decay: 0.012, sustain: 0.0, release: 0.015, peak: 0.20 },
      dst, i * 0.085)
  })

  // フィナーレ：キラキラ高音
  oscAdsr(ctx, 3136, 'sine',
    { attack: 0.005, decay: 0.08, sustain: 0.15, release: 0.5, peak: 0.22 },
    dst, 0.38)
}

/**
 * 自分のターン通知 — 短く明確な2音
 */
export function playYourTurn() {
  const ctx = getCtx()
  const dst = getMaster(ctx)

  oscAdsr(ctx, 880, 'sine',
    { attack: 0.005, decay: 0.04, sustain: 0.0, release: 0.06, peak: 0.30 },
    dst)
  oscAdsr(ctx, 1108, 'sine',
    { attack: 0.005, decay: 0.04, sustain: 0.0, release: 0.08, peak: 0.28 },
    dst, 0.10)
}

// ──────────────────────────────────────────────────────────────────────────────
// アクション種別 → 再生関数
// ──────────────────────────────────────────────────────────────────────────────

function playForAction(action: ActionType) {
  switch (action) {
    case 'fold':   playFold();  break
    case 'check':  playCheck(); break
    case 'call':   playCall();  break
    case 'raise':  playRaise(); break
    case 'all-in': playAllIn(); break
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Hook: GameStore の変化を監視して自動再生
// ──────────────────────────────────────────────────────────────────────────────

export function useSoundEffects() {
  const actionHistory  = useGameStore((s) => s.actionHistory)
  const phase          = useGameStore((s) => s.phase)
  const winners        = useGameStore((s) => s.winners)
  const communityCards = useGameStore((s) => s.communityCards)
  const players        = useGameStore((s) => s.players)

  // ── アクション音: actionHistory の末尾が変わったら鳴らす ──
  const prevActionLen = useRef(0)
  useEffect(() => {
    const len = actionHistory.length
    if (len > prevActionLen.current) {
      const latest = actionHistory[len - 1]
      if (latest) playForAction(latest.action)
    }
    prevActionLen.current = len
  }, [actionHistory])

  // ── カード配布: 手札が配られた（preflop 開始）──
  const prevHandNumbers = useRef<number[]>([])
  useEffect(() => {
    if (phase !== 'preflop') return
    const holeCount = players.filter((p) => p.holeCards.length === 2).length
    const currentHandNums = players.map((p) => p.holeCards.length)
    const prev = prevHandNumbers.current
    const justDealt = holeCount > 0 && prev.every((n) => n === 0)
    if (justDealt || prev.length !== currentHandNums.length) {
      // プレイヤー数分だけカード配布音を連続再生
      const playerCount = players.length
      for (let i = 0; i < playerCount * 2; i++) {
        setTimeout(() => playDeal(), i * 90)
      }
    }
    prevHandNumbers.current = currentHandNums
  }, [phase, players])

  // ── コミュニティカード: flop/turn/river で枚数が増えた ──
  const prevCommunityLen = useRef(0)
  useEffect(() => {
    if (communityCards.length > prevCommunityLen.current && communityCards.length > 0) {
      const added = communityCards.length - prevCommunityLen.current
      for (let i = 0; i < added; i++) {
        setTimeout(() => playDeal(), i * 110)
      }
    }
    prevCommunityLen.current = communityCards.length
  }, [communityCards.length])

  // ── チップ移動: showdown フェーズ開始 ──
  const prevPhase = useRef(phase)
  useEffect(() => {
    if (phase === 'showdown' && prevPhase.current !== 'showdown') {
      playChipCollect()
    }
    prevPhase.current = phase
  }, [phase])

  // ── 勝利: winners が確定したとき ──
  const prevWinnersLen = useRef(0)
  useEffect(() => {
    if (winners.length > 0 && prevWinnersLen.current === 0) {
      const human = players.find((p) => p.isHuman)
      const humanWon = human && winners.some((w) => w.winners.includes(human.id))
      setTimeout(() => {
        if (humanWon) {
          playWin()
        } else {
          playChipCollect()
        }
      }, 380)
    }
    prevWinnersLen.current = winners.length
  }, [winners, players])

  // ── 自分のターン: isTurn が true になった ──
  const humanIsTurn = players.find((p) => p.isHuman)?.isTurn ?? false
  const prevIsTurn = useRef(false)
  useEffect(() => {
    if (humanIsTurn && !prevIsTurn.current) {
      playYourTurn()
    }
    prevIsTurn.current = humanIsTurn
  }, [humanIsTurn])
}
