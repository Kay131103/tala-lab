/* ============================================================
 *  The 35 talas of the Carnatic system:
 *  7 tala families (angas) × 5 jaathis (laghu length).
 *
 *  Angas: L = laghu (clap + finger counts), D = drutham (wave, 2 aksharas),
 *         A = anudhrutham (1 akshara).
 *  Jaathi: tisra 3, chaturashra 4, khanda 5, misra 7, sankeerna 9.
 * ============================================================ */

export const JAATHIS = [
  { key: "tisra", name: "Tisra", count: 3 },
  { key: "chaturashra", name: "Chaturashra", count: 4 },
  { key: "khanda", name: "Khanda", count: 5 },
  { key: "misra", name: "Misra", count: 7 },
  { key: "sankeerna", name: "Sankeerna", count: 9 },
];

export const FAMILIES = [
  { key: "dhruva", name: "Dhruva", angas: ["L", "D", "L", "L"] },
  { key: "mathya", name: "Mathya", angas: ["L", "D", "L"] },
  { key: "rupaka", name: "Rupaka", angas: ["D", "L"] },
  { key: "jhampa", name: "Jhampa", angas: ["L", "A", "D"] },
  { key: "triputa", name: "Triputa", angas: ["L", "D", "D"] },
  { key: "ata", name: "Ata", angas: ["L", "L", "D", "D"] },
  { key: "eka", name: "Eka", angas: ["L"] },
];

/* all 35 talas, each expanded into its akshara sequence */
export function buildTala(familyKey, jaathiKey) {
  const family = FAMILIES.find((f) => f.key === familyKey);
  const jaathi = JAATHIS.find((j) => j.key === jaathiKey);
  const aksharas = [];
  let count = 0; // finger-count position inside the current laghu

  for (const anga of family.angas) {
    const len = anga === "L" ? jaathi.count : anga === "D" ? 2 : 1;
    for (let i = 0; i < len; i++) {
      aksharas.push({
        anga,
        indexInAnga: i,
        angaStart: i === 0,
        // gestures: laghu starts with a clap then finger counts;
        // drutham = a wave (both aksharas); anudhrutham = a tap
        gesture:
          anga === "L" ? (i === 0 ? "clap" : "count") : anga === "D" ? "wave" : "tap",
        countNumber: anga === "L" ? i : (i === 0 ? 1 : 2),
        angaLen: len,
      });
    }
  }

  const angaBlocks = [];
  let cursor = 0;
  for (const anga of family.angas) {
    const len = anga === "L" ? jaathi.count : anga === "D" ? 2 : 1;
    angaBlocks.push({ anga, start: cursor, len });
    cursor += len;
  }

  const talaName = `${jaathi.name} ${family.name}`;
  return {
    name: talaName,
    family: family.name,
    jaathi: jaathi.name,
    aksharas,
    angaBlocks,
    total: aksharas.length,
  };
}

/* the 35-tala list (name only) for display */
export const ALL_TALAS = [];
for (const f of FAMILIES) {
  for (const j of JAATHIS) {
    ALL_TALAS.push({ key: f.key + ":" + j.key, name: `${j.name} ${f.name}` });
  }
}
