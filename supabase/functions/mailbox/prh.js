// PRH "Email ASN" (advance ship notice) reader: plain JavaScript so the shipments function (Deno) and the tests (Node)
// share it. Returns {vendor_name, po_ref, order_ref, carrier, tracking[], ship_date, lines[{isbn, title, qty, unit_price}]}.
const cellText = (h) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
export function parsePrhAsn(html) {
  if (!/EMAIL ASN/i.test(html)) return null;
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => cellText(c[1])));
  const field = (label) => { for (const r of rows) { const i = r.findIndex((c) => c.toUpperCase() === label); if (i >= 0) return r.slice(i + 1).find((c) => c) ?? null; } return null; };
  const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(field("SHIP DATE:") ?? "");
  const lines = [];
  let cur = null;
  for (const r of rows) {
    const cells = r.filter((c) => c);
    const isbn = cells.find((c) => /^97[89]\d{10}$/.test(c));
    if (isbn && cur && !cur.isbn) { cur.isbn = isbn; cur.po = (cells.find((c) => /^PO:/.test(c)) ?? "").slice(3) || cur.po; continue; }
    if (cells.length >= 4 && /^[A-Z0-9-]{4,}$/i.test(cells[0]) && /^\d+$/.test(cells[cells.length - 3] ?? "") && /^\d+\.\d{2}$/.test(cells[cells.length - 2] ?? "")) {
      cur = { isbn: "", title: cells[1], qty: +cells[cells.length - 3], unit_price: +cells[cells.length - 2], po: cells[0] };
      lines.push(cur);
    }
  }
  const tracking = [...new Set([...html.matchAll(/Tracking:\s*([A-Z0-9]{8,40})/gi)].map((m) => m[1].toUpperCase()))];
  return {
    vendor_name: "Penguin Random House", po_ref: lines[0]?.po ?? null, order_ref: field("RH DELIVERY:"),
    carrier: (field("SHIPPER:") ?? "").replace(/^[A-Z]+:/, "").trim(), tracking,
    ship_date: d ? `${d[3]}-${d[1]}-${d[2]}` : null, lines: lines.filter((l) => l.isbn),
  };
}
