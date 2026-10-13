// THE DEFENCE-ROW PRECEDENCE LADDER.
//
// defStream() in waivers.js returns flags that are NOT mutually exclusive:
// `allLocked` can be true alongside `empty` or `unresolved`, and `gap` can be
// null under several of them. Which one wins is the entire semantics of the
// row, and in the original that precedence existed ONLY as the order of an
// if/else-if chain inside a 95-line template-string function (ui.js:274-369).
//
// It is lifted here, away from the copy, because the order is load-bearing in
// a way that is invisible when it is tangled with markup:
//
//   ui.js:276-279 records that putting `empty` before `allLocked` reads
//   `d.best.name` off a null and blanks the whole page on a Monday evening.
//
// `requires` is not decoration. Each kind declares which fields its copy is
// about to dereference, and `defVerdict` asserts them. A future reordering
// that reintroduces the Monday-evening crash now throws a named error in a
// unit test instead of rendering a blank page in production.

/** The ladder, in order. First match wins. */
const LADDER = [
  { kind: "no-projections", when: (d) => d.noProjections, requires: ["slot"] },
  { kind: "all-locked",     when: (d) => d.allLocked,     requires: ["slot"] },
  { kind: "empty",          when: (d) => d.empty,         requires: ["slot", "best"] },
  { kind: "unresolved",     when: (d) => d.unresolved,    requires: ["slot"] },
  { kind: "unprojected",    when: (d) => d.unprojected,   requires: ["slot", "current"] },
  { kind: "current-locked", when: (d) => !!d.current?.locked, requires: ["slot", "current"] },
  { kind: "marginal",       when: (d) => d.marginal,      requires: ["slot", "current", "best"] },
  { kind: "actionable",     when: (d) => d.actionable,    requires: ["slot", "current", "best"] },
  { kind: "tie",            when: (d) => d.gap === 0,     requires: ["slot", "current", "best"] },
  { kind: "hold",           when: () => true,             requires: ["slot", "current", "best"] },
];

export const DEF_KINDS = LADDER.map((r) => r.kind);

/** Kinds where the row is reporting work to do rather than a checked-and-quiet
 *  seat. Mirrors `d.counts` from defStream(), which drives both the styling
 *  and wireTally() - one field, read in one place.
 *
 *  MARGINAL IS NOT IN HERE. waivers.js:353 defines marginal as gap < DEF_FLOOR
 *  and :357 sets counts only when gap >= DEF_FLOOR, so the two are mutually
 *  exclusive by construction: a sub-precision edge is rendered and styled and
 *  deliberately not counted as work. Listing it here was a wrong claim in the
 *  file meant to be the authority on this ladder (audit 2026-10-13); nothing
 *  consumed it yet, which is why no test caught it. */
export const DEF_ACTIONABLE_KINDS = new Set(["empty", "actionable"]);

/**
 * Classify a defStream() result. Returns null when there is no row at all,
 * matching the original's `if (!d) return ""`.
 *
 * @returns {{kind:string, counts:boolean, gap:(number|null), slot:string,
 *            current:(object|null), best:(object|null)}|null}
 */
export function defVerdict(d) {
  if (!d) return null;

  const hit = LADDER.find((r) => r.when(d));

  for (const field of hit.requires) {
    const v = field === "slot" ? d.slot : d[field];
    if (v === undefined || v === null) {
      throw new Error(
        `defVerdict: kind "${hit.kind}" requires "${field}" but it is ${v}. ` +
        `This is the ui.js:276-279 failure - a branch reached with a field its ` +
        `copy dereferences. Check the ladder order, not the copy.`
      );
    }
  }

  return {
    kind: hit.kind,
    counts: !!d.counts,
    gap: d.gap ?? null,
    slot: d.slot,
    current: d.current ?? null,
    best: d.best ?? null,
  };
}
