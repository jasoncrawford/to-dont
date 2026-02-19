// Fractional Indexing for CRDT-friendly ordering
// Generates string-based positions that can be compared lexicographically

const BASE_CHARS = 'abcdefghijklmnopqrstuvwxyz';
const MID_CHAR = 'n';

export function generatePositionBetween(before, after) {
  if (!before && !after) return MID_CHAR;
  if (!before) return decrementPosition(after);
  if (!after) return incrementPosition(before);
  return midpointPosition(before, after);
}

function decrementPosition(pos) {
  const lastChar = pos[pos.length - 1];
  const charIndex = BASE_CHARS.indexOf(lastChar);
  if (charIndex > 1) {
    const midIndex = Math.floor(charIndex / 2);
    return pos.slice(0, -1) + BASE_CHARS[midIndex];
  } else if (charIndex === 1) {
    return pos.slice(0, -1) + 'a' + MID_CHAR;
  }
  return '0' + MID_CHAR;
}

function incrementPosition(pos) {
  const lastChar = pos[pos.length - 1];
  const charIndex = BASE_CHARS.indexOf(lastChar);
  if (charIndex < BASE_CHARS.length - 2) {
    const midIndex = charIndex + Math.ceil((BASE_CHARS.length - 1 - charIndex) / 2);
    return pos.slice(0, -1) + BASE_CHARS[midIndex];
  } else if (charIndex === BASE_CHARS.length - 2) {
    return pos.slice(0, -1) + 'z';
  }
  return pos + MID_CHAR;
}

function midpointPosition(before, after) {
  const maxLen = Math.max(before.length, after.length);
  const beforePadded = before.padEnd(maxLen, 'a');
  const afterPadded = after.padEnd(maxLen, 'a');

  let diffIndex = 0;
  while (diffIndex < maxLen && beforePadded[diffIndex] === afterPadded[diffIndex]) {
    diffIndex++;
  }

  if (diffIndex === maxLen) return before + MID_CHAR;

  const beforeChar = beforePadded[diffIndex];
  const afterChar = afterPadded[diffIndex];
  const beforeIdx = BASE_CHARS.indexOf(beforeChar);
  const afterIdx = BASE_CHARS.indexOf(afterChar);

  if (beforeIdx === -1 || afterIdx === -1) {
    if (beforeChar < 'a') return 'a' + MID_CHAR;
    return before + MID_CHAR;
  }

  if (afterIdx - beforeIdx > 1) {
    const midIdx = beforeIdx + Math.floor((afterIdx - beforeIdx) / 2);
    return before.slice(0, diffIndex) + BASE_CHARS[midIdx];
  }

  // Adjacent characters (diff === 1) at diffIndex.
  // prefix is before's string up to and including the differing char.
  // Any string starting with prefix is guaranteed < after, so we just
  // need a suffix that makes the result > before.
  const prefix = before.slice(0, diffIndex + 1);

  if (after.length > diffIndex + 1) {
    const restFirstChar = after[diffIndex + 1];
    const restIdx = BASE_CHARS.indexOf(restFirstChar);
    if (restIdx > 1) {
      const midRestIdx = Math.floor(restIdx / 2);
      const candidate = prefix + BASE_CHARS[midRestIdx];
      if (candidate > before) {
        return candidate;
      }
    }
  }

  // before extends past the diff point — need suffix > before's remaining chars
  if (before.length > diffIndex + 1) {
    return prefix + incrementPosition(before.slice(diffIndex + 1));
  }

  return prefix + MID_CHAR;
}

function posToNumber(pos) {
  let result = 0;
  for (let i = 0; i < pos.length; i++) {
    const idx = BASE_CHARS.indexOf(pos[i]);
    result += idx / Math.pow(26, i + 1);
  }
  return result;
}

function numberToPos(num, maxLen) {
  let result = '';
  for (let i = 0; i < maxLen; i++) {
    num *= 26;
    const idx = Math.floor(num);
    result += BASE_CHARS[Math.min(idx, 25)];
    num -= idx;
    if (num < 1e-10) break;
  }
  return result || 'a';
}

export function generateInitialPositions(count) {
  if (count === 0) return [];
  if (count === 1) return [MID_CHAR];

  const startIdx = 2; // 'c'
  const endIdx = 23; // 'x'
  const singleCharSlots = endIdx - startIdx + 1; // 22

  if (count <= singleCharSlots) {
    const positions = [];
    const step = (endIdx - startIdx) / (count - 1);
    for (let i = 0; i < count; i++) {
      const charIdx = Math.round(startIdx + step * i);
      positions.push(BASE_CHARS[charIdx]);
    }
    return positions;
  }

  const startVal = posToNumber(BASE_CHARS[startIdx]);
  const endVal = posToNumber(BASE_CHARS[endIdx]);
  const maxLen = Math.max(2, Math.ceil(Math.log(count * 2) / Math.log(26)) + 1);
  const step = (endVal - startVal) / (count - 1);

  const positions = [];
  for (let i = 0; i < count; i++) {
    const val = startVal + step * i;
    positions.push(numberToPos(val, maxLen));
  }
  return positions;
}

// Window global for backward compat (tests use window.FractionalIndex)
window.FractionalIndex = {
  generatePositionBetween,
  generateInitialPositions,
};
