/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Web Worker that sorts the files of a large analysis off the UI thread: it returns the order (file
// indexes, ascending) for one column. Text is compared ignoring case and accents, with numbers in their
// natural order ("file 2" before "file 10"); ties keep the original order.
const NUM = /\d+/g;
const MARKS = /[̀-ͯ]/g;
const norm = (s) => s.normalize('NFD').replace(MARKS, '').toLowerCase().replace(NUM, (d) => d.padStart(20, '0'));

self.onmessage = (e) => {
  const { id, numbers, texts, texts2 } = e.data;
  const n = numbers ? numbers.length : texts.length;
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  if (numbers) {
    order.sort((a, b) => numbers[a] - numbers[b] || a - b);
  } else {
    const keys = new Array(n);
    for (let i = 0; i < n; i++) keys[i] = texts2 ? norm(texts[i]) + '\u0001' + norm(texts2[i]) : norm(texts[i]);
    order.sort((a, b) => (keys[a] < keys[b] ? -1 : keys[a] > keys[b] ? 1 : a - b));
  }
  self.postMessage({ id, order }, [order.buffer]);
};
