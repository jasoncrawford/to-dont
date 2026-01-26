// Fractional indexing for CRDT-friendly ordering
// Generates string-based positions that can be compared lexicographically

const BASE_CHARS = 'abcdefghijklmnopqrstuvwxyz';
const FIRST_CHAR = BASE_CHARS[0]; // 'a'
const LAST_CHAR = BASE_CHARS[BASE_CHARS.length - 1]; // 'z'
const MID_CHAR = BASE_CHARS[Math.floor(BASE_CHARS.length / 2)]; // 'n'

/**
 * Generate a position string between two positions.
 * If before is null, generates a position before after.
 * If after is null, generates a position after before.
 * If both are null, returns the middle of the alphabet.
 */
export function generateBetween(before: string | null, after: string | null): string {
  if (!before && !after) {
    return MID_CHAR; // Start in the middle
  }

  if (!before) {
    // Generate before 'after'
    return decrementPosition(after!);
  }

  if (!after) {
    // Generate after 'before'
    return incrementPosition(before);
  }

  // Generate between before and after
  return midpoint(before, after);
}

/**
 * Compare two position strings lexicographically.
 * Returns negative if a < b, positive if a > b, 0 if equal.
 */
export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Generate a position before the given position.
 */
function decrementPosition(pos: string): string {
  // If the last character isn't 'a', we can decrement it
  const lastChar = pos[pos.length - 1];
  const charIndex = BASE_CHARS.indexOf(lastChar);

  if (charIndex > 1) {
    // Decrement last char, pick midpoint
    const midIndex = Math.floor(charIndex / 2);
    return pos.slice(0, -1) + BASE_CHARS[midIndex];
  } else if (charIndex === 1) {
    // Last char is 'b', go to 'an' (midpoint between a and b)
    return pos.slice(0, -1) + FIRST_CHAR + MID_CHAR;
  } else {
    // Last char is 'a', need to go deeper
    // 'a' -> 'an' (inserting 'n' makes it 'an' which is less than 'a' followed by anything? No wait...)
    // Actually 'a' < 'aa' < 'ab' ... so to go before 'a' we need a different approach
    // For simplicity, prepend 'a' and add middle: 'a' becomes 'an' as a preceding position
    // But 'an' > 'a', so that doesn't work.
    // Let's use a different strategy: prepend the string with 'A' (uppercase comes before lowercase)
    // Actually, let's keep it simple and consistent: use 'a' followed by more chars
    // The trick is: 'a' followed by nothing vs 'a' followed by 'a' - we're in string land
    // 'a' < 'aa' because comparing char by char, at position 1, '' < 'a'
    // So to go BEFORE 'a', we can't with just lowercase letters.
    // Solution: pad with a special prefix character that sorts before 'a'
    // OR: use a sentinel approach where we don't allow just 'a'
    //
    // Simplest solution: If we hit the boundary, add 'a' + middle char
    // This gives us 'an' which is > 'a', so we need to handle the edge case
    // by extending the original position
    //
    // Alternative: Use a prefix like '0' for positions before 'a'
    return '0' + MID_CHAR;
  }
}

/**
 * Generate a position after the given position.
 */
function incrementPosition(pos: string): string {
  const lastChar = pos[pos.length - 1];
  const charIndex = BASE_CHARS.indexOf(lastChar);

  if (charIndex < BASE_CHARS.length - 2) {
    // Increment last char to midpoint between current and end
    const midIndex = charIndex + Math.ceil((BASE_CHARS.length - 1 - charIndex) / 2);
    return pos.slice(0, -1) + BASE_CHARS[midIndex];
  } else if (charIndex === BASE_CHARS.length - 2) {
    // Last char is 'y', go to 'z'
    return pos.slice(0, -1) + LAST_CHAR;
  } else {
    // Last char is 'z', need to extend
    return pos + MID_CHAR;
  }
}

/**
 * Generate a midpoint position between two positions.
 */
function midpoint(before: string, after: string): string {
  // Pad strings to same length for comparison
  const maxLen = Math.max(before.length, after.length);
  const beforePadded = before.padEnd(maxLen, FIRST_CHAR);
  const afterPadded = after.padEnd(maxLen, FIRST_CHAR);

  // Find first differing character
  let diffIndex = 0;
  while (diffIndex < maxLen && beforePadded[diffIndex] === afterPadded[diffIndex]) {
    diffIndex++;
  }

  if (diffIndex === maxLen) {
    // Strings are equal (shouldn't happen in practice)
    return before + MID_CHAR;
  }

  const beforeChar = beforePadded[diffIndex];
  const afterChar = afterPadded[diffIndex];
  const beforeIdx = BASE_CHARS.indexOf(beforeChar);
  const afterIdx = BASE_CHARS.indexOf(afterChar);

  // Handle special prefix characters
  if (beforeIdx === -1 || afterIdx === -1) {
    // One of the chars is a special char like '0'
    if (beforeChar < 'a') {
      // before uses special prefix, after uses normal
      // Generate something between '0...' and 'a...'
      return FIRST_CHAR + MID_CHAR; // 'an'
    }
    // Fallback: just append
    return before + MID_CHAR;
  }

  if (afterIdx - beforeIdx > 1) {
    // There's room between them
    const midIdx = beforeIdx + Math.floor((afterIdx - beforeIdx) / 2);
    return before.slice(0, diffIndex) + BASE_CHARS[midIdx];
  } else {
    // Adjacent characters, need to go deeper
    // Take before's prefix up to and including diffIndex, then add middle
    const prefix = before.slice(0, diffIndex + 1);

    // If after has more characters, use those to find midpoint
    if (after.length > diffIndex + 1) {
      const afterRest = after.slice(diffIndex + 1);
      const restFirstChar = afterRest[0];
      const restIdx = BASE_CHARS.indexOf(restFirstChar);
      if (restIdx > 1) {
        const midRestIdx = Math.floor(restIdx / 2);
        return prefix + BASE_CHARS[midRestIdx];
      }
    }

    // Otherwise, append a character in the middle of the remaining space
    // We have 'before[diffIndex]' and 'after[diffIndex]' which are adjacent
    // So we go with before + midChar
    return prefix + MID_CHAR;
  }
}

/**
 * Generate an initial set of positions for an array of items.
 * Spreads them evenly across the alphabet.
 */
export function generateInitialPositions(count: number): string[] {
  if (count === 0) return [];
  if (count === 1) return [MID_CHAR];

  const positions: string[] = [];
  // Use positions from 'c' to 'x' to leave room at edges
  const startIdx = 2; // 'c'
  const endIdx = 23; // 'x'
  const step = (endIdx - startIdx) / (count - 1);

  for (let i = 0; i < count; i++) {
    const charIdx = Math.round(startIdx + step * i);
    positions.push(BASE_CHARS[charIdx]);
  }

  return positions;
}

/**
 * Validate that a position string is well-formed.
 */
export function isValidPosition(pos: string): boolean {
  if (!pos || typeof pos !== 'string') return false;
  // Allow alphanumeric (including '0' prefix for before-first positions)
  return /^[0-9a-z]+$/.test(pos);
}
