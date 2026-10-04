import { afterEach, describe, expect, it, vi } from "vitest";
import { readOneDriveTable } from "./sources/onedrive";
import { readGoogleSheet } from "./sources/googleSheets";

function mockFetchSequence(responses: { status: number; body: unknown }[]) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
      text: async () => JSON.stringify(r.body),
    });
  }
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readOneDriveTable", () => {
  it("combines the header row and data rows into {headers, rows}", async () => {
    const fetchSpy = mockFetchSequence([
      { status: 200, body: { values: [["Name", "Email", "Phone"]] } },
      {
        status: 200,
        body: {
          value: [{ values: [["Acme Corp", "a@acme.com", "9876543210"]] }, { values: [["Beta LLC", "b@beta.com", "9876543211"]] }],
        },
      },
    ]);
    const result = await readOneDriveTable("token-abc", "/ABS/Leads.xlsx", "Table1");
    expect(result).toEqual({
      headers: ["Name", "Email", "Phone"],
      rows: [
        ["Acme Corp", "a@acme.com", "9876543210"],
        ["Beta LLC", "b@beta.com", "9876543211"],
      ],
    });
    const [headerUrl] = fetchSpy.mock.calls[0];
    expect(headerUrl).toContain("/workbook/tables/Table1/headerRowRange");
    const [rowsUrl] = fetchSpy.mock.calls[1];
    expect(rowsUrl).toContain("/workbook/tables/Table1/rows");
  });

  it("throws when the header request fails", async () => {
    mockFetchSequence([
      { status: 404, body: { error: "not found" } },
      { status: 200, body: { value: [] } },
    ]);
    await expect(readOneDriveTable("token-abc", "/missing.xlsx", "Table1")).rejects.toThrow(/404/);
  });

  it("treats missing cell values as empty strings rather than throwing", async () => {
    mockFetchSequence([
      { status: 200, body: { values: [["Name", "Email"]] } },
      { status: 200, body: { value: [{ values: [["Acme Corp", null]] }] } },
    ]);
    const result = await readOneDriveTable("token-abc", "/Leads.xlsx", "Table1");
    expect(result.rows).toEqual([["Acme Corp", ""]]);
  });
});

describe("readGoogleSheet", () => {
  it("treats the first row as headers and maps the rest positionally", async () => {
    const fetchSpy = mockFetchSequence([
      {
        status: 200,
        body: { values: [["Name", "Email", "Phone"], ["Acme Corp", "a@acme.com", "9876543210"], ["Beta LLC", "b@beta.com", "9876543211"]] },
      },
    ]);
    const result = await readGoogleSheet("token-abc", "sheet-id-123", "Sheet1!A1:C");
    expect(result).toEqual({
      headers: ["Name", "Email", "Phone"],
      rows: [
        ["Acme Corp", "a@acme.com", "9876543210"],
        ["Beta LLC", "b@beta.com", "9876543211"],
      ],
    });
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://sheets.googleapis.com/v4/spreadsheets/sheet-id-123/values/Sheet1!A1%3AC");
  });

  it("pads a short row with empty strings instead of losing column alignment", async () => {
    mockFetchSequence([{ status: 200, body: { values: [["Name", "Email", "Phone"], ["Acme Corp"]] } }]);
    const result = await readGoogleSheet("token-abc", "sheet-id-123", "Sheet1!A1:C");
    expect(result.rows).toEqual([["Acme Corp", "", ""]]);
  });

  it("throws on a failed request", async () => {
    mockFetchSequence([{ status: 403, body: { error: "insufficient permissions" } }]);
    await expect(readGoogleSheet("token-abc", "sheet-id-123", "Sheet1!A1:C")).rejects.toThrow(/403/);
  });

  it("returns empty headers/rows for an empty sheet instead of throwing", async () => {
    mockFetchSequence([{ status: 200, body: {} }]);
    const result = await readGoogleSheet("token-abc", "sheet-id-123", "Sheet1!A1:C");
    expect(result).toEqual({ headers: [], rows: [] });
  });
});
