import { describe, expect, it } from "vitest";
import { buildRows, findHeaderRow, guessMapping, parseAmount, parseCsv, parseDate } from "../../apps/admin-erp/src/banking/statementParse";

const csv = `Meezan Bank Limited
Account Statement,,,,,
Transaction Date,Value Date,Narration,Cheque No,Withdrawal,Deposit,Balance
01/10/2026,01/10/2026,"Opening, balance",,,,"1,000.00"
05/10/2026,05/10/2026,CLEARING CHQ 12345,12345,,"100,000.00","101,000.00"
06-Oct-2026,06-Oct-2026,SMS CHARGES,,300.00,,"100,700.00"
,,Total,,300.00,"100,000.00",
`;

describe("statement parsing", () => {
  it("reads a bank CSV with title rows, quoted commas and split debit/credit", () => {
    const g = parseCsv(csv);
    const h = findHeaderRow(g);
    expect(h).toBe(2);
    const m = guessMapping(g[h]);
    expect(m).toMatchObject({ date: 0, value_date: 1, description: 2, cheque_no: 3, debit: 4, credit: 5, balance: 6 });
    const { rows } = buildRows(g, h, m, "auto");
    expect(rows.map((r) => [r.date, r.amount, r.balance])).toEqual([["2026-10-05", 100000, 101000], ["2026-10-06", -300, 100700]]);
  });
  it("parses amounts and dates", () => {
    expect(parseAmount("(1,234.50)")).toBe(-1234.5);
    expect(parseAmount("2,000 Dr")).toBe(-2000);
    expect(parseAmount("-")).toBeNull();
    expect(parseDate("03/04/2026", "auto")).toBe("2026-04-03");
    expect(parseDate("03/04/2026", "MDY")).toBe("2026-03-04");
    expect(parseDate("2026-10-31", "auto")).toBe("2026-10-31");
    expect(parseDate("7-Oct-26", "auto")).toBe("2026-10-07");
  });
});
