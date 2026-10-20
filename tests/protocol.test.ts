import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FRAME_BYTES,
  FLAG_ARMED,
  decodeTxFrame,
  encodeTxFrame,
  type TxFrame,
} from '../packages/protocol/protocol.ts';

const base: TxFrame = {
  seq: 1234,
  tUs: 0xdeadbeef,
  throttle: -777,
  yaw: 250,
  pitch: -1000,
  roll: 1000,
  flags: FLAG_ARMED,
  mode: 2,
  aux: 0,
};

test('frame size is stable', () => {
  assert.equal(FRAME_BYTES, 22);
  assert.equal(encodeTxFrame(base).byteLength, FRAME_BYTES);
});

test('round trip preserves every field', () => {
  const decoded = decodeTxFrame(encodeTxFrame(base));
  assert.deepEqual(decoded, base);
});

test('rejects a corrupted checksum', () => {
  const bytes = encodeTxFrame(base);
  bytes[8] = (bytes[8]! ^ 0x10) & 0xff;
  assert.equal(decodeTxFrame(bytes), null);
});

test('rejects foreign packets', () => {
  const junk = new Uint8Array(FRAME_BYTES);
  assert.equal(decodeTxFrame(junk), null);
  assert.equal(decodeTxFrame(new Uint8Array(4)), null);
});

test('extreme axis values survive', () => {
  for (const v of [-1000, 0, 1000]) {
    const decoded = decodeTxFrame(
      encodeTxFrame({ ...base, throttle: v, yaw: v, pitch: v, roll: v }),
    );
    assert.equal(decoded?.throttle, v);
    assert.equal(decoded?.yaw, v);
  }
});
