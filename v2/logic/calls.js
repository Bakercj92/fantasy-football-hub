// PAIRING A SET DIFF INTO SENTENCES.
//
// The engine deliberately reports lineup changes as a SET diff - who enters,
// who leaves - because per-slot swaps turn one decision into four (see the
// decision-band note in project memory). The pairing into "start X over Y" is
// invented in the view, by INDEX, at ui.js:689-691, and the lists can be
// different lengths. A pair with a null on either side is normal: an entry
// into an empty seat, or a forced sit with nobody to replace him.

export function pairCalls(c) {
  const entering = c?.entering || [];
  const leaving = c?.leaving || [];
  const len = Math.max(entering.length, leaving.length);
  const pairs = [];
  for (let i = 0; i < len; i++) {
    const inP = entering[i] || null;
    const outP = leaving[i] || null;
    pairs.push({
      in: inP,
      out: outP,
      // A ruled-out player still carries a projection, because that is what
      // he would score if he played. He will not, so the call ignores the
      // threshold. (ui.js:693, 701-705)
      forced: !!outP && outP.startable === false,
      delta: (inP?.pts ?? 0) - (outP?.pts ?? 0),
    });
  }
  return pairs;
}
