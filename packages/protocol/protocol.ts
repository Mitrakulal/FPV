/**
 * Wire protocol shared by the phone transmitter, the server and the sim.
 *
 * TX frame (binary, little endian, 22 bytes):
 *   0  u8   magic 0xF1
 *   1  u8   type 1
 *   2  u16  seq
 *   4  u32  tUs        (sender clock, microseconds, wraps)
 *   8  i16  throttle   -1000 = stick at bottom, +1000 = stick at top
 *  10  i16  yaw        -1000 = left, +1000 = right
 *  12  i16  pitch      -1000 = nose down, +1000 = nose up
 *  14  i16  roll       -1000 = left, +1000 = right
 *  16  u8   flags      bit0 armed, bit1 angle mode, bit2 throttle hold, bit3 failsafe,
 *                      bit4 reset pulse
 *  17  u8   mode       1 or 2
 *  18  u16  aux        switch bits, reserved
 *  20  u16  crc        simple checksum of bytes 0..19
 */

export const PROTO_MAGIC = 0xf1;
export const MSG_TX = 1;
export const FRAME_BYTES = 22;

export const AXIS_MIN = -1000;
export const AXIS_MAX = 1000;

export const FLAG_ARMED = 1 << 0;
export const FLAG_ANGLE = 1 << 1;
export const FLAG_HOLD = 1 << 2;
export const FLAG_FAILSAFE = 1 << 3;
/**
 * One-shot pulse from the phone's R button. The sim resets on the rising edge,
 * so restart works even if an older relay does not forward the JSON reset.
 */
export const FLAG_RESET = 1 << 4;

export interface TxFrame {
  seq: number;
  tUs: number;
  throttle: number;
  yaw: number;
  pitch: number;
  roll: number;
  flags: number;
  mode: number;
  aux: number;
}

export function checksum(bytes: Uint8Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum = (sum + (bytes[i] ?? 0)) & 0xffff;
  return sum;
}

export function encodeTxFrame(f: TxFrame): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(FRAME_BYTES);
  const view = new DataView(buf);
  view.setUint8(0, PROTO_MAGIC);
  view.setUint8(1, MSG_TX);
  view.setUint16(2, f.seq & 0xffff, true);
  view.setUint32(4, f.tUs >>> 0, true);
  view.setInt16(8, f.throttle, true);
  view.setInt16(10, f.yaw, true);
  view.setInt16(12, f.pitch, true);
  view.setInt16(14, f.roll, true);
  view.setUint8(16, f.flags);
  view.setUint8(17, f.mode);
  view.setUint16(18, f.aux & 0xffff, true);
  const bytes = new Uint8Array(buf);
  view.setUint16(20, checksum(bytes, 0, 20), true);
  return bytes;
}

export function decodeTxFrame(data: ArrayBuffer | Uint8Array): TxFrame | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength < FRAME_BYTES) return null;
  if ((bytes[0] ?? 0) !== PROTO_MAGIC || (bytes[1] ?? 0) !== MSG_TX) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, FRAME_BYTES);
  const expected = checksum(bytes, 0, 20);
  if (view.getUint16(20, true) !== expected) return null;

  return {
    seq: view.getUint16(2, true),
    tUs: view.getUint32(4, true),
    throttle: view.getInt16(8, true),
    yaw: view.getInt16(10, true),
    pitch: view.getInt16(12, true),
    roll: view.getInt16(14, true),
    flags: view.getUint8(16),
    mode: view.getUint8(17),
    aux: view.getUint16(18, true),
  };
}

export function isArmed(f: TxFrame): boolean {
  return (f.flags & FLAG_ARMED) !== 0;
}

/** -1..1 -> stick units. */
export function toAxis(value: number): number {
  return Math.max(AXIS_MIN, Math.min(AXIS_MAX, Math.round(value * AXIS_MAX)));
}

/** Stick units -> -1..1. */
export function fromAxis(value: number): number {
  return Math.max(-1, Math.min(1, value / AXIS_MAX));
}

export interface ServerStatus {
  type: 'status';
  tx: boolean;
  txAgeMs: number;
  txHz: number;
  sims: number;
  txs: number;
  t: number;
}
