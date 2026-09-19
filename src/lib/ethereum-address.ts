const ETHEREUM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const KECCAK_RATE_BYTES = 136;
const LANE_MASK = BigInt('0xffffffffffffffff');

const ROUND_CONSTANTS = [
  '0x0000000000000001', '0x0000000000008082', '0x800000000000808a', '0x8000000080008000',
  '0x000000000000808b', '0x0000000080000001', '0x8000000080008081', '0x8000000000008009',
  '0x000000000000008a', '0x0000000000000088', '0x0000000080008009', '0x000000008000000a',
  '0x000000008000808b', '0x800000000000008b', '0x8000000000008089', '0x8000000000008003',
  '0x8000000000008002', '0x8000000000000080', '0x000000000000800a', '0x800000008000000a',
  '0x8000000080008081', '0x8000000000008080', '0x0000000080000001', '0x8000000080008008',
].map((value) => BigInt(value));

const ROTATION_OFFSETS = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];

function rotateLeft(value: bigint, offset: number) {
  if (offset === 0) return value;
  return ((value << BigInt(offset)) | (value >> BigInt(64 - offset))) & LANE_MASK;
}

function permuteKeccakState(state: bigint[]) {
  for (const roundConstant of ROUND_CONSTANTS) {
    const columns = Array.from({ length: 5 }, (_, x) => state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20]);
    const deltas = Array.from({ length: 5 }, (_, x) => columns[(x + 4) % 5] ^ rotateLeft(columns[(x + 1) % 5], 1));

    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) state[x + (5 * y)] ^= deltas[x];
    }

    const rotated = new Array<bigint>(25);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        rotated[y + (5 * ((2 * x + 3 * y) % 5))] = rotateLeft(state[x + (5 * y)], ROTATION_OFFSETS[x][y]);
      }
    }

    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        state[x + (5 * y)] = rotated[x + (5 * y)] ^ ((~rotated[((x + 1) % 5) + (5 * y)]) & rotated[((x + 2) % 5) + (5 * y)]);
      }
    }
    state[0] ^= roundConstant;
  }
}

function keccak256Ascii(value: string) {
  const paddedLength = KECCAK_RATE_BYTES * Math.ceil((value.length + 1) / KECCAK_RATE_BYTES);
  const bytes = new Uint8Array(paddedLength);
  for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index);
  bytes[value.length] = 0x01;
  bytes[bytes.length - 1] |= 0x80;

  const state = Array<bigint>(25).fill(BigInt(0));
  for (let blockOffset = 0; blockOffset < bytes.length; blockOffset += KECCAK_RATE_BYTES) {
    for (let lane = 0; lane < KECCAK_RATE_BYTES / 8; lane += 1) {
      let laneValue = BigInt(0);
      for (let byte = 0; byte < 8; byte += 1) laneValue |= BigInt(bytes[blockOffset + (lane * 8) + byte]) << BigInt(byte * 8);
      state[lane] ^= laneValue;
    }
    permuteKeccakState(state);
  }

  let hash = '';
  for (let lane = 0; lane < 4; lane += 1) {
    for (let byte = 0; byte < 8; byte += 1) hash += Number((state[lane] >> BigInt(byte * 8)) & BigInt(0xff)).toString(16).padStart(2, '0');
  }
  return hash;
}

/**
 * Validates a 20-byte Ethereum address. All-lowercase and all-uppercase forms
 * are accepted; mixed-case input must satisfy the EIP-55 checksum.
 */
export function isEthereumAddress(value: string) {
  if (!ETHEREUM_ADDRESS_PATTERN.test(value)) return false;

  const address = value.slice(2);
  if (address === address.toLowerCase() || address === address.toUpperCase()) return true;

  const checksumHash = keccak256Ascii(address.toLowerCase());
  return Array.from(address).every((character, index) => {
    if (!/[a-fA-F]/.test(character)) return true;
    const shouldBeUppercase = Number.parseInt(checksumHash[index], 16) >= 8;
    return character === (shouldBeUppercase ? character.toUpperCase() : character.toLowerCase());
  });
}
