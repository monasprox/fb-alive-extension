/**
 * [FB-QA] utils/random.js
 * Shared randomness utilities — seeded fresh per session, never persisted.
 * Used by both content.js (scroll timing) and popup.js (preview display).
 *
 * Safety note: All randomness is purely client-side Math.random().
 * No crypto, no fingerprinting, no external RNG.
 */

const FBQARandom = (() => {
  'use strict';

  /**
   * Returns a random integer in [min, max] inclusive.
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  function randomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Returns a random float in [min, max).
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  function randomFloat(min, max) {
    return Math.random() * (max - min) + min;
  }

  /**
   * Applies ±pct jitter to value. Simulates human timing imprecision.
   * e.g. jitter(1000, 0.2) → value between 800–1200
   * @param {number} value  Base value to jitter
   * @param {number} pct    Fraction to jitter by (default 0.2 = ±20%)
   * @returns {number}
   */
  function jitter(value, pct = 0.2) {
    const delta = value * pct;
    return value + randomFloat(-delta, delta);
  }

  /**
   * Promise-based sleep. Useful for sequencing async scroll actions.
   * @param {number} ms  Milliseconds to wait
   * @returns {Promise<void>}
   */
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Randomly pick one item from an array.
   * @param {Array} arr
   * @returns {*}
   */
  function pick(arr) {
    return arr[randomInt(0, arr.length - 1)];
  }

  /**
   * Returns true with probability p (0..1).
   * @param {number} p
   * @returns {boolean}
   */
  function chance(p) {
    return Math.random() < p;
  }

  return { randomInt, randomFloat, jitter, sleep, pick, chance };
})();

// Make available as a global for both content scripts and popup
// (content scripts share scope via chrome content script injection)
if (typeof module !== 'undefined') module.exports = FBQARandom;
