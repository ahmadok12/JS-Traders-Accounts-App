import { describe, expect, it } from "vitest";
import { describeInputs, evalQty, evaluate, resolveVars, type CalcVariable } from "../../apps/admin-erp/src/sales/calc/formula";

const BRANCH: CalcVariable[] = [
  { key: "L", label: "Farm length", type: "number", default: 430 },
  { key: "N", label: "Lines", type: "number", default: 4 },
  { key: "ROOM", label: "Feed room", type: "choice", options: ["Side", "Centre"], default: "Side" },
  { key: "PIPES", label: "Pipes", formula: "ceil(L/10)" },
  { key: "MOTORS", label: "Motors", formula: "ROOM=='Centre' ? 2 : 1" },
  { key: "P8", label: "Points", formula: "ceil(L/8)" },
];

describe("calculator formulas", () => {
  it("does arithmetic with precedence and functions", () => {
    expect(evaluate("2+3*4", {})).toBe(14);
    expect(evaluate("(2+3)*4", {})).toBe(20);
    expect(evaluate("ceil(430/8)", {})).toBe(54);
    expect(evaluate("ceil(440/8)", {})).toBe(55);   // exact division is not pushed up
    expect(evaluate("max(1, 2, 3) - min(4, 5)", {})).toBe(-1);
    expect(evaluate("-L + 10", { L: 4 })).toBe(6);
  });
  it("compares text without caring about case, and branches", () => {
    expect(evaluate("ROOM=='Centre' ? 2 : 1", { ROOM: "Centre" })).toBe(2);
    expect(evaluate("ROOM=='centre' ? 2 : 1", { ROOM: "Centre" })).toBe(2);
    expect(evaluate("ROOM=='Centre' ? 2 : 1", { ROOM: "Side" })).toBe(1);
    expect(evaluate("ROOM==\"Side\" && N>3 ? N : 0", { ROOM: "Side", N: 4 })).toBe(4);
  });
  it("gives readable errors", () => {
    expect(() => evaluate("L*", { L: 1 })).toThrow(/ends too early/);
    expect(() => evaluate("X*2", {})).toThrow(/Unknown name "X"/);
    expect(() => evaluate("foo(2)", {})).toThrow(/Unknown function/);
    expect(() => evaluate("L/0", { L: 1 })).toThrow(/Division by zero/);
    expect(() => evaluate("2 3", {})).toThrow(/Unexpected/);
    expect(() => evaluate("alert(1)", {})).toThrow();
  });
  it("never returns a negative quantity", () => {
    expect(evalQty("N-10", { N: 4 })).toBe(0);
  });
  it("works out Ahmad's Branch Feeding Line (430 ft, 4 lines, centre feed room)", () => {
    const { vars, errors } = resolveVars(BRANCH, { L: "430", N: "4", ROOM: "Centre" });
    expect(errors).toEqual({});
    expect(vars).toMatchObject({ PIPES: 43, MOTORS: 2, P8: 54 });
    const q = (f: string) => evalQty(f, vars);
    expect(q("PIPES*N")).toBe(172);          // feed pipe collar
    expect(q("PIPES*4*N")).toBe(688);        // feed pans
    expect(q("MOTORS*N")).toBe(8);           // motors / shafts / sensors
    expect(q("ROOM=='Side' ? N : 0")).toBe(0);
    expect(q("ROOM=='Centre' ? N : 0")).toBe(4);
    expect(q("L*N")).toBe(1720);             // augar ft
    expect(q("P8*N")).toBe(216);             // adjust / hanger / pulley / U clump 8mm
    expect(q("L*N+100")).toBe(1820);         // 5mm wire
    expect(q("1")).toBe(1);                  // winch handle
  });
  it("flags bad inputs", () => {
    const { errors } = resolveVars(BRANCH, { L: "", N: "abc", ROOM: "Side" });
    expect(Object.keys(errors).sort()).toEqual(["L", "N"]);
  });
  it("works out the Drinking Line (430 ft, 5 lines)", () => {
    const { vars } = resolveVars([
      { key: "L", label: "", type: "number", default: 430 }, { key: "N", label: "", type: "number", default: 5 },
      { key: "PIPES", label: "", formula: "ceil(L/10)" }, { key: "P8", label: "", formula: "ceil(L/8)" },
    ], {});
    const q = (f: string) => evalQty(f, vars);
    expect(q("PIPES*N")).toBe(215);              // water lines (15 nipples) / support pipes
    expect(q("PIPES*N*15")).toBe(3225);          // drip cups
    expect(q("PIPES*N*4")).toBe(860);            // hangers
    expect(q("ceil(1.25*L/400*N)")).toBe(7);     // glue 6.72 → 7
    expect(q("ceil(PIPES*N*0.5)")).toBe(108);    // joints 107.5 → 108
    expect(q("P8*N")).toBe(270);                 // pulley / thimmel / adjust / U clump 6mm
    expect(q("ceil(L*N/300)")).toBe(8);          // rope rolls 7.17 → 8
    expect(q("8*N")).toBe(40);                   // regulator pipe ft
    expect(q("L*N+50")).toBe(2200);              // galvanised / shocker wire
  });
  it("works out the Main Feeding Line (single / double floor, 65 / 78 ft)", () => {
    const defs: CalcVariable[] = [
      { key: "N", label: "Lines", type: "number", default: 1 },
      { key: "FLOOR", label: "Floor", type: "choice", options: ["Single", "Double"], default: "Single" },
      { key: "SIZE", label: "Main line size (ft)", type: "choice", options: ["65", "78"], default: "65" },
    ];
    const single = resolveVars(defs, {}).vars;
    const dbl = resolveVars(defs, { N: "2", FLOOR: "Double", SIZE: "78" }).vars;
    expect(evalQty("SIZE*N", single)).toBe(65);
    expect(evalQty("SIZE*N", dbl)).toBe(156);
    expect(evalQty("(FLOOR=='Double' ? 5 : 4)*N", single)).toBe(4);
    expect(evalQty("(FLOOR=='Double' ? 5 : 4)*N", dbl)).toBe(10);
    expect(evalQty("(FLOOR=='Double' ? 4 : 3)*N", dbl)).toBe(8);
    expect(evalQty("FLOOR=='Single' ? N : 0", dbl)).toBe(0);
    expect(evalQty("FLOOR=='Double' ? N : 0", dbl)).toBe(2);
  });
  it("summarises the inputs in words", () => {
    const defs: CalcVariable[] = [
      { key: "L", label: "Farm length (ft)", short: "Length", unit: "ft", type: "number" },
      { key: "W", label: "Farm width (ft)", short: "Width", unit: "ft", type: "number" },
      { key: "N", label: "No. of branch feed lines", short: "Lines", type: "number" },
      { key: "ROOM", label: "Feed room", type: "choice" },
      { key: "PIPES", label: "Pipes", formula: "ceil(L/10)" },
    ];
    expect(describeInputs(defs, { L: 430, W: 50, N: 4, ROOM: "Centre" })).toBe("Length 430 ft · Width 50 ft · Lines 4 · Feed room Centre");
    expect(describeInputs(null, { L: 430 })).toBe("L 430");
  });
});
