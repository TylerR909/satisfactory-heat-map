/**
 * Unreal Engine–style RandomStream (FRandomStream) used by Satisfactory node randomization.
 *
 * TypeScript port of Konsl/satisfactory-world-generator `src/random_stream.rs` (MIT).
 * Copyright (c) 2026 Konsl — see third_party/konsl-satisfactory-world-generator.md
 */

/** LCG state held as unsigned 32-bit. */
export class RandomStream {
  private state: number;

  /** @param seed Signed i32 world seed (bit-cast to u32). */
  constructor(seed: number) {
    this.state = seed | 0; // force i32
    // cast_unsigned: reinterpret bits as u32
    this.state = this.state >>> 0;
  }

  private mutateSeed(): void {
    // wrapping_mul / wrapping_add on u32
    this.state = Math.imul(this.state, 196314165) + 907633515;
    this.state = this.state >>> 0;
  }

  /** Uniform float in [0, 1) using f32 bit trick (matches UE / Konsl). */
  frand(): number {
    this.mutateSeed();
    const bits = (0x3f800000 | (this.state >>> 9)) >>> 0;
    // f32 from bits, then subtract 1.0
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setUint32(0, bits, true);
    return view.getFloat32(0, true) - 1.0;
  }

  /** Uniform float in [start, end) — matches Rust Range half-open semantics for cast-to-index use. */
  frandRange(start: number, end: number): number {
    return start + (end - start) * this.frand();
  }
}

/**
 * Fisher–Yates as implemented in Konsl `shuffle` (not classic FY from end).
 * Port of `randomization.rs` shuffle.
 */
export function shuffle<T>(rng: RandomStream, pool: T[]): void {
  if (pool.length < 2) return;
  for (let i = 0; i < pool.length - 1; i++) {
    const swapIndex = i + (rng.frandRange(0, pool.length - i) | 0);
    const a = pool[i];
    const b = pool[swapIndex];
    if (a === undefined || b === undefined) continue;
    pool[i] = b;
    pool[swapIndex] = a;
  }
}
